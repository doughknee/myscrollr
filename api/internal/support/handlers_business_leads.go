package support

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"log"
	"net/http"
	"net/mail"
	"os"
	"strings"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/gofiber/fiber/v2"
)

// BusinessLeadRequest is the JSON body shape for POST /business-leads.
// Anonymous endpoint — fields come straight from the marketing form
// on myscrollr.com/business with no JWT identity attached.
type BusinessLeadRequest struct {
	Name    string `json:"name"`
	Email   string `json:"email"`
	Company string `json:"company"`
	UseCase string `json:"use_case"`
	Message string `json:"message"`
}

// businessLeadRateLimitKey scopes anonymous business-lead submissions
// per source IP. Window: 1 hour.
func businessLeadRateLimitKey(ip string) string {
	return "business_leads:public:" + ip + ":hour"
}

const (
	businessLeadMaxPerHour = 5
	businessLeadRateWindow = time.Hour

	businessLeadNameMax    = 120
	businessLeadEmailMax   = 254
	businessLeadCompanyMax = 200
	businessLeadMessageMin = 10
	businessLeadMessageMax = 5000

	// companySubjectMax caps how much of the (200-char) Company string
	// we splice into email subject lines. 80 keeps subjects readable
	// in most mail clients without truncating mid-word on legitimate
	// names like "Goldman Sachs Asset Management & Co." (38 chars).
	companySubjectMax = 80

	// businessLeadSideEffectsTimeout bounds the detached context used
	// for the post-rate-limit DB insert AND both Resend dispatches.
	// Two Resend calls at 15s apiece + a fast Postgres write leaves
	// headroom; 45s avoids the worst-case 30s cliff.
	businessLeadSideEffectsTimeout = 45 * time.Second
)

// allowedBusinessUseCases mirrors the dropdown options on the marketing
// form. The map value is the human-friendly label that appears in the
// internal notification email and the auto-reply subject — keeping it
// here means the email copy stays in sync if we add/rename a use case.
var allowedBusinessUseCases = map[string]string{
	"sports-bars": "Sports bar / restaurant",
	"brokerages":  "Brokerage / financial advisor",
	"fantasy":     "Fantasy sports platform",
	"sportsbooks": "Sportsbook / betting affiliate",
	"crypto":      "Crypto exchange",
	"news":        "News aggregator / publisher",
	"other":       "Other",
}

// HandleSubmitBusinessLead accepts anonymous business-inquiry
// submissions from myscrollr.com/business. Per-IP rate-limited via
// Redis (5/hour) on top of the global IP limiter. Persists every
// accepted submission to `business_leads` as the source of truth,
// then best-effort dispatches two Resend emails:
//
//  1. Internal notification to BUSINESS_LEADS_TO_EMAIL (defaults
//     enterprise@myscrollr.com) so sales sees the lead.
//  2. Auto-reply to the lead's address so they get a confirmation
//     beyond the on-screen success state.
//
// Email-send failures are LOGGED but do NOT change the 200 response —
// the DB row is the durable record, and sales can backfill by scanning
// the table for rows with `notified_at IS NULL`.
func HandleSubmitBusinessLead(c *fiber.Ctx) error {
	platform.SetCORSHeaders(c)

	var req BusinessLeadRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(platform.ErrorResponse{
			Status: "error",
			Error:  "Invalid request body",
		})
	}

	// ── Normalise ─────────────────────────────────────────────────
	req.Name = strings.TrimSpace(req.Name)
	req.Email = strings.TrimSpace(req.Email)
	req.Company = strings.TrimSpace(req.Company)
	req.UseCase = strings.TrimSpace(strings.ToLower(req.UseCase))
	req.Message = strings.TrimSpace(req.Message)

	// ── Validate ──────────────────────────────────────────────────
	if req.Name == "" || len(req.Name) > businessLeadNameMax {
		return c.Status(fiber.StatusBadRequest).JSON(platform.ErrorResponse{
			Status: "error",
			Error:  "Name required (max 120 chars)",
		})
	}
	if len(req.Email) == 0 || len(req.Email) > businessLeadEmailMax {
		return c.Status(fiber.StatusBadRequest).JSON(platform.ErrorResponse{
			Status: "error",
			Error:  "Valid email required",
		})
	}
	// net/mail.ParseAddress catches the obvious garbage that
	// `strings.Contains("@")` lets through ("a@b", "foo @ bar", names
	// without local parts, etc.). It accepts RFC 5322 forms including
	// the "Name <addr>" variant, so we narrow to the bare address by
	// reading parsed.Address and requiring it equals the trimmed input.
	parsedEmail, err := mail.ParseAddress(req.Email)
	if err != nil || parsedEmail.Address != req.Email {
		return c.Status(fiber.StatusBadRequest).JSON(platform.ErrorResponse{
			Status: "error",
			Error:  "Valid email required",
		})
	}
	if req.Company == "" || len(req.Company) > businessLeadCompanyMax {
		return c.Status(fiber.StatusBadRequest).JSON(platform.ErrorResponse{
			Status: "error",
			Error:  "Company required (max 200 chars)",
		})
	}
	useCaseLabel, ok := allowedBusinessUseCases[req.UseCase]
	if !ok {
		return c.Status(fiber.StatusBadRequest).JSON(platform.ErrorResponse{
			Status: "error",
			Error:  "Invalid use case",
		})
	}
	if len(req.Message) < businessLeadMessageMin || len(req.Message) > businessLeadMessageMax {
		return c.Status(fiber.StatusBadRequest).JSON(platform.ErrorResponse{
			Status: "error",
			Error:  fmt.Sprintf("Message must be %d-%d characters", businessLeadMessageMin, businessLeadMessageMax),
		})
	}

	// ── Rate limit ────────────────────────────────────────────────
	// Soft-fail on Redis errors: accepting a lead is more valuable
	// than losing one to a transient infra glitch. The outer Fiber IP
	// limiter still caps total request rate.
	ip := c.IP()
	if platform.Rdb != nil && ip != "" {
		key := businessLeadRateLimitKey(ip)
		count, err := platform.Rdb.Incr(c.Context(), key).Result()
		if err == nil {
			if count == 1 {
				if expErr := platform.Rdb.Expire(c.Context(), key, businessLeadRateWindow).Err(); expErr != nil {
					// If TTL set fails, the key has no expiry and will
					// permanently block submissions from this IP until
					// manually cleared. Log loudly so we notice.
					log.Printf("[BusinessLeads] Redis EXPIRE failed for key=%s (key has no TTL): %v",
						key, expErr)
				}
			}
			if count > businessLeadMaxPerHour {
				return c.Status(fiber.StatusTooManyRequests).JSON(platform.ErrorResponse{
					Status: "error",
					Error:  "Too many submissions; please try again in an hour",
				})
			}
		} else {
			log.Printf("[BusinessLeads] Redis INCR failed (continuing): %v", err)
		}
	}

	ipRedacted := redactIP(ip)
	userAgent := c.Get("User-Agent")
	if len(userAgent) > 500 {
		userAgent = userAgent[:500]
	}

	// ── Persist + side effects under a detached context ───────────
	// `bg` outlives the request scope so a fast client disconnect
	// doesn't cancel the durable INSERT or the post-insert Resend
	// dispatches. The user already submitted the form — finish what
	// we promised them. 45s budget covers a fast Postgres write plus
	// both 15s Resend timeouts with headroom.
	bg, cancel := context.WithTimeout(context.Background(), businessLeadSideEffectsTimeout)
	defer cancel()

	// ── Persist (must succeed) ────────────────────────────────────
	// DBPool is the durable record. Email dispatches that come next
	// are best-effort and don't roll back this row.
	var leadID int64
	if err := platform.DBPool.QueryRow(bg, `
		INSERT INTO business_leads
		  (name, email, company, use_case, message, ip_redacted, user_agent)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id
	`, req.Name, req.Email, req.Company, req.UseCase, req.Message, ipRedacted, userAgent).
		Scan(&leadID); err != nil {
		log.Printf("[BusinessLeads] DB insert failed for email=%s company=%s: %v",
			redactEmail(req.Email), req.Company, err)
		return c.Status(fiber.StatusInternalServerError).JSON(platform.ErrorResponse{
			Status: "error",
			Error:  "Failed to save submission; please try again",
		})
	}

	log.Printf("[BusinessLeads] Lead #%d captured ip=%s email=%s company=%q use_case=%s",
		leadID, ipRedacted, redactEmail(req.Email), req.Company, req.UseCase)

	if err := sendBusinessLeadNotification(bg, leadID, req, useCaseLabel, ipRedacted); err != nil {
		log.Printf("[BusinessLeads] Notification email failed for lead #%d: %v", leadID, err)
	} else {
		if _, err := platform.DBPool.Exec(bg,
			"UPDATE business_leads SET notified_at = now() WHERE id = $1", leadID); err != nil {
			log.Printf("[BusinessLeads] notified_at update failed for lead #%d: %v", leadID, err)
		}
	}

	if err := sendBusinessLeadAutoReply(bg, req, useCaseLabel); err != nil {
		log.Printf("[BusinessLeads] Auto-reply failed for lead #%d to %s: %v",
			leadID, redactEmail(req.Email), err)
	} else {
		if _, err := platform.DBPool.Exec(bg,
			"UPDATE business_leads SET auto_replied_at = now() WHERE id = $1", leadID); err != nil {
			log.Printf("[BusinessLeads] auto_replied_at update failed for lead #%d: %v", leadID, err)
		}
	}

	return c.JSON(fiber.Map{
		"status":  "ok",
		"message": "Lead received",
	})
}

// ══════════════════════════════════════════════════════════════════
//  Resend dispatch
// ══════════════════════════════════════════════════════════════════
//
// Both senders below issue a direct HTTPS POST to Resend rather than
// using their Go SDK. This matches the inline pattern already used by
// sendPasswordResetEmail (handlers_account.go) and the partner
// notification path (support_drafts.go). When a third caller appears,
// extracting a shared `resendSend()` helper becomes worth the churn —
// for now, three near-identical 30-line blocks are cheaper than the
// abstraction.

// resendEndpoint is the Resend Emails API URL. Pulled into a const so
// tests (when we add them) can swap it via a test double if needed.
const resendEndpoint = "https://api.resend.com/emails"

// businessLeadsFrom returns the From address used for both the
// internal notification and the auto-reply. Resolution order:
//
//  1. BUSINESS_LEADS_FROM_EMAIL — explicit override for this pipeline
//  2. RESEND_FROM_EMAIL — shared fallback used by other Resend callers
//  3. A literal default — last resort so misconfigured envs still send
//
// The literal default uses `enterprise@myscrollr.com`. For Resend to
// accept that From, myscrollr.com must be a verified sending domain in
// the Resend dashboard (it already is — see existing support emails).
func businessLeadsFrom() string {
	if v := strings.TrimSpace(os.Getenv("BUSINESS_LEADS_FROM_EMAIL")); v != "" {
		return v
	}
	if v := strings.TrimSpace(os.Getenv("RESEND_FROM_EMAIL")); v != "" {
		return v
	}
	return "Scrollr Business <enterprise@myscrollr.com>"
}

// businessLeadsTo returns the internal notification recipient. Env-
// configurable so non-prod environments can route notifications to a
// test inbox without code changes.
func businessLeadsTo() string {
	if v := strings.TrimSpace(os.Getenv("BUSINESS_LEADS_TO_EMAIL")); v != "" {
		return v
	}
	return "enterprise@myscrollr.com"
}

// sendBusinessLeadNotification sends the internal "new lead" email to
// the sales address. Reply-To is set to the lead's email so a sales
// rep hitting "reply" lands directly in the lead's inbox without
// having to copy-paste an address out of the body.
func sendBusinessLeadNotification(
	ctx context.Context,
	leadID int64,
	req BusinessLeadRequest,
	useCaseLabel string,
	ipRedacted string,
) error {
	apiKey := strings.TrimSpace(os.Getenv("RESEND_API_KEY"))
	if apiKey == "" {
		return fmt.Errorf("RESEND_API_KEY not configured")
	}

	subject := fmt.Sprintf("New business lead: %s", truncateForSubject(req.Company))

	htmlBody := fmt.Sprintf(`<!DOCTYPE html>
<html>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0b0d10;color:#e6e6e6;padding:24px;">
  <div style="max-width:600px;margin:0 auto;background:#14181d;border:1px solid #1e252d;border-radius:12px;overflow:hidden;">
    <div style="padding:24px 28px 12px;border-bottom:1px solid #1e252d;">
      <p style="margin:0 0 4px;font-size:11px;color:#10b981;text-transform:uppercase;letter-spacing:1px;font-weight:600;">New business lead · #%d</p>
      <h2 style="margin:0;font-size:20px;color:#fff;font-weight:700;">%s</h2>
    </div>
    <table cellpadding="0" cellspacing="0" border="0" style="width:100%%;padding:20px 28px;">
      <tr><td style="padding:6px 0;font-size:11px;color:#7a7a7a;text-transform:uppercase;letter-spacing:0.5px;width:110px;vertical-align:top;">Name</td><td style="padding:6px 0;font-size:14px;color:#e6e6e6;">%s</td></tr>
      <tr><td style="padding:6px 0;font-size:11px;color:#7a7a7a;text-transform:uppercase;letter-spacing:0.5px;vertical-align:top;">Email</td><td style="padding:6px 0;font-size:14px;color:#10b981;"><a href="mailto:%s" style="color:#10b981;text-decoration:none;">%s</a></td></tr>
      <tr><td style="padding:6px 0;font-size:11px;color:#7a7a7a;text-transform:uppercase;letter-spacing:0.5px;vertical-align:top;">Company</td><td style="padding:6px 0;font-size:14px;color:#e6e6e6;">%s</td></tr>
      <tr><td style="padding:6px 0;font-size:11px;color:#7a7a7a;text-transform:uppercase;letter-spacing:0.5px;vertical-align:top;">Use case</td><td style="padding:6px 0;font-size:14px;color:#e6e6e6;">%s</td></tr>
    </table>
    <div style="padding:8px 28px 24px;">
      <p style="margin:0 0 8px;font-size:11px;color:#7a7a7a;text-transform:uppercase;letter-spacing:0.5px;">Message</p>
      <div style="background:#0b0d10;border:1px solid #1e252d;border-radius:8px;padding:16px;font-size:14px;color:#d0d0d0;line-height:1.55;white-space:pre-wrap;">%s</div>
    </div>
    <div style="padding:14px 28px;background:#0b0d10;border-top:1px solid #1e252d;font-size:11px;color:#5a5a5a;">
      <p style="margin:0;">Reply to this email to respond directly to %s.</p>
      <p style="margin:6px 0 0;">Submitted from myscrollr.com/business · IP %s</p>
    </div>
  </div>
</body>
</html>`,
		leadID,
		html.EscapeString(req.Company),
		html.EscapeString(req.Name),
		html.EscapeString(req.Email),
		html.EscapeString(req.Email),
		html.EscapeString(req.Company),
		html.EscapeString(useCaseLabel),
		html.EscapeString(req.Message),
		html.EscapeString(req.Email),
		html.EscapeString(ipRedacted),
	)

	payload := map[string]any{
		"from":     businessLeadsFrom(),
		"to":       []string{businessLeadsTo()},
		"reply_to": req.Email,
		"subject":  subject,
		"html":     htmlBody,
	}

	return postToResend(ctx, apiKey, payload)
}

// sendBusinessLeadAutoReply confirms receipt to the lead. Brand voice
// matches the rest of the site: short, direct, no salesy fluff. Tells
// them exactly what happens next so they're not left wondering.
func sendBusinessLeadAutoReply(
	ctx context.Context,
	req BusinessLeadRequest,
	useCaseLabel string,
) error {
	apiKey := strings.TrimSpace(os.Getenv("RESEND_API_KEY"))
	if apiKey == "" {
		return fmt.Errorf("RESEND_API_KEY not configured")
	}

	subject := fmt.Sprintf("Thanks — we got your note about %s", truncateForSubject(req.Company))

	htmlBody := fmt.Sprintf(`<!DOCTYPE html>
<html>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0b0d10;color:#e6e6e6;padding:24px;">
  <div style="max-width:560px;margin:0 auto;background:#14181d;border:1px solid #1e252d;border-radius:12px;padding:32px;">
    <p style="margin:0 0 4px;font-size:11px;color:#10b981;text-transform:uppercase;letter-spacing:1px;font-weight:600;">Scrollr for business</p>
    <h2 style="margin:0 0 20px;font-size:22px;color:#fff;font-weight:700;">Thanks, %s — we got your note.</h2>

    <p style="margin:0 0 20px;line-height:1.6;color:#c8c8c8;font-size:15px;">
      We received your inquiry about deploying Scrollr for <strong style="color:#e6e6e6;">%s</strong> (%s). Here&rsquo;s what happens next:
    </p>

    <ol style="margin:0 0 24px;padding-left:20px;line-height:1.7;color:#c8c8c8;font-size:14px;">
      <li style="margin-bottom:6px;">Within one business day, a real human (probably Brandon) will reply to this thread.</li>
      <li style="margin-bottom:6px;">If it&rsquo;s a fit, we&rsquo;ll schedule a 30-minute scoping call to understand your deployment.</li>
      <li>Within three business days of that call, you&rsquo;ll have a written scope and quote.</li>
    </ol>

    <div style="border-top:1px solid #1e252d;margin:24px 0;padding-top:20px;">
      <p style="margin:0 0 8px;font-size:13px;color:#8a8a8a;line-height:1.6;">
        If you don&rsquo;t hear back within two business days, reply to this email and we&rsquo;ll fix it.
      </p>
      <p style="margin:0;font-size:13px;color:#8a8a8a;line-height:1.6;">
        Want to sign an NDA before our call? Reply with yours, or ask for ours.
      </p>
    </div>

    <p style="margin:0;color:#5a5a5a;font-size:12px;">&mdash; The Scrollr team</p>
  </div>
  <p style="text-align:center;margin-top:16px;color:#3a3a3a;font-size:11px;">
    You received this because you submitted the form at myscrollr.com/business
  </p>
</body>
</html>`,
		html.EscapeString(req.Name),
		html.EscapeString(req.Company),
		html.EscapeString(useCaseLabel),
	)

	payload := map[string]any{
		"from":     businessLeadsFrom(),
		"to":       []string{req.Email},
		"reply_to": businessLeadsTo(),
		"subject":  subject,
		"html":     htmlBody,
	}

	return postToResend(ctx, apiKey, payload)
}

// truncateForSubject trims a user-supplied string down to a length
// that reads cleanly as part of an email subject. The DB allows up
// to 200 characters of Company, but pasting all 200 into the subject
// produces unreadable headers in most mail clients. We chop at a word
// boundary when possible and append an ellipsis so the truncation is
// visible to the recipient.
func truncateForSubject(s string) string {
	if len(s) <= companySubjectMax {
		return s
	}
	cut := s[:companySubjectMax]
	if idx := strings.LastIndexByte(cut, ' '); idx > companySubjectMax/2 {
		cut = cut[:idx]
	}
	return cut + "\u2026"
}

// postToResend is the shared POST helper for the two senders above.
// Returns nil on 2xx, an error containing Resend's response body on
// anything else so logs are actionable. 15s timeout matches the
// existing partner-notification sender — Resend is usually <500ms and
// 15s is enough headroom for a slow upstream without trapping our
// goroutines.
func postToResend(ctx context.Context, apiKey string, payload map[string]any) error {
	bodyBytes, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal resend payload: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, resendEndpoint, bytes.NewReader(bodyBytes))
	if err != nil {
		return fmt.Errorf("build resend request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("resend request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("resend returned %d: %s", resp.StatusCode, string(respBody))
	}
	return nil
}
