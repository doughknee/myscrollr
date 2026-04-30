package core

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"log"
	"os"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
)

// =============================================================================
// Support approval URLs — partner-facing Send / Edit / Skip handlers
// =============================================================================
//
// Each support draft generates three single-use, HMAC-signed URLs the
// partner clicks from email. Tokens are tiny custom JWTs (header-less)
// signed with HMAC-SHA256 — no JWT library dependency for what is a
// 4-field claim set. Single-use enforcement lives in the DB
// (markDraftDecided's `WHERE status = 'pending'`).

// SupportApprovalToken is the signed claim set carried in the URL.
// Field names are 1-letter to keep the encoded URL short.
type SupportApprovalToken struct {
	DraftID int64  `json:"d"`
	Action  string `json:"a"` // "send" | "edit" | "skip"
	Exp     int64  `json:"e"` // unix seconds
	JTI     string `json:"j"` // unique nonce — useful for log correlation, not enforced
}

// supportApprovalSecret returns the HMAC key used to sign approval
// tokens. Falls back to LOGTO_M2M_APP_SECRET so dev environments work
// without an extra env var, but production should set
// SUPPORT_APPROVAL_HMAC_SECRET to a high-entropy random value.
func supportApprovalSecret() []byte {
	s := os.Getenv("SUPPORT_APPROVAL_HMAC_SECRET")
	if s == "" {
		s = os.Getenv("LOGTO_M2M_APP_SECRET")
	}
	return []byte(s)
}

// signApprovalToken produces a base64url-encoded payload + signature
// joined by ".". Format: <base64(json claims)>.<base64(hmac)>
func signApprovalToken(t SupportApprovalToken) (string, error) {
	if len(supportApprovalSecret()) == 0 {
		return "", fmt.Errorf("SUPPORT_APPROVAL_HMAC_SECRET not configured")
	}
	body, err := json.Marshal(t)
	if err != nil {
		return "", err
	}
	encoded := base64.RawURLEncoding.EncodeToString(body)
	mac := hmac.New(sha256.New, supportApprovalSecret())
	mac.Write([]byte(encoded))
	sig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return encoded + "." + sig, nil
}

// verifyApprovalToken parses + validates a token. Returns parsed
// claims on success. Errors are intentionally generic so we don't
// leak which step failed.
func verifyApprovalToken(raw string) (*SupportApprovalToken, error) {
	parts := strings.SplitN(raw, ".", 2)
	if len(parts) != 2 {
		return nil, fmt.Errorf("malformed token")
	}
	mac := hmac.New(sha256.New, supportApprovalSecret())
	mac.Write([]byte(parts[0]))
	expected := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(parts[1]), []byte(expected)) {
		return nil, fmt.Errorf("invalid signature")
	}
	body, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return nil, fmt.Errorf("decode body: %w", err)
	}
	var t SupportApprovalToken
	if err := json.Unmarshal(body, &t); err != nil {
		return nil, fmt.Errorf("parse claims: %w", err)
	}
	if t.Exp > 0 && time.Now().Unix() > t.Exp {
		return nil, fmt.Errorf("token expired")
	}
	return &t, nil
}

// buildApprovalURLs returns the three URLs to embed in the partner
// notification email. All three share the same expiry; one click on
// any of them flips the draft's status, invalidating the other two
// (single-use is enforced at the DB layer).
func buildApprovalURLs(draftID int64) (sendURL, editURL, skipURL string, err error) {
	base := os.Getenv("APPROVAL_BASE_URL")
	if base == "" {
		base = "https://api.myscrollr.com"
	}
	exp := time.Now().Add(24 * time.Hour).Unix()
	mk := func(action string) (string, error) {
		t, e := signApprovalToken(SupportApprovalToken{
			DraftID: draftID,
			Action:  action,
			Exp:     exp,
			JTI:     fmt.Sprintf("%d-%d", draftID, time.Now().UnixNano()),
		})
		if e != nil {
			return "", e
		}
		return base + "/support/" + action + "?token=" + t, nil
	}
	if sendURL, err = mk("send"); err != nil {
		return
	}
	if editURL, err = mk("edit"); err != nil {
		return
	}
	if skipURL, err = mk("skip"); err != nil {
		return
	}
	return
}

// HandleSupportSend (GET /support/send?token=...) — partner approves the AI's draft as-is.
func HandleSupportSend(c *fiber.Ctx) error {
	return handleApprovalAction(c, "send")
}

// HandleSupportSkip (GET /support/skip?token=...) — partner skips, no email sent.
func HandleSupportSkip(c *fiber.Ctx) error {
	return handleApprovalAction(c, "skip")
}

// HandleSupportEdit (GET /support/edit?token=...) — returns an HTML
// form pre-filled with the draft body. The partner edits and POSTs to
// /support/edit/submit, which falls into the Send path with the
// edited body.
func HandleSupportEdit(c *fiber.Ctx) error {
	_, draft, err := loadAndVerifyApprovalToken(c, "edit")
	if err != nil {
		return errorHTMLResponse(c, fiber.StatusBadRequest, err.Error())
	}

	tokenRaw := c.Query("token")

	// Build a small HTML editor page. Inline styling — no template
	// engine dependency for a single-purpose form.
	page := fmt.Sprintf(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Edit reply — Ticket %s</title>
<style>
  body { background:#0a0a0a; color:#e2e8f0; font-family:-apple-system,BlinkMacSystemFont,sans-serif; padding:24px; max-width:640px; margin:0 auto; }
  h1 { color:#10b981; font-size:18px; margin:0 0 8px; }
  p.meta { color:#888; font-size:13px; margin:0 0 16px; }
  textarea { width:100%%; height:300px; background:#141414; color:#e2e8f0; border:1px solid #2a2a2a; border-radius:6px; padding:12px; font-family:ui-monospace,monospace; font-size:13px; resize:vertical; box-sizing:border-box; }
  .actions { margin-top:16px; display:flex; gap:8px; }
  button { padding:10px 16px; border:none; border-radius:6px; cursor:pointer; font-weight:600; font-size:14px; }
  .send { background:#10b981; color:white; }
  .cancel { background:#2a2a2a; color:#e2e8f0; }
  .ai-note { background:#0f3a2c; padding:8px 12px; border-radius:4px; font-size:12px; color:#a7f3d0; margin-bottom:12px; }
</style>
</head>
<body>
<h1>Edit reply</h1>
<p class="meta">Ticket <strong>%s</strong> · To <strong>%s</strong> · AI summary: %s</p>
<div class="ai-note">You can edit the HTML below. Plain text is fine too — basic HTML tags will render in the user's email client.</div>
<form method="POST" action="/support/edit/submit">
  <input type="hidden" name="token" value="%s">
  <textarea name="body">%s</textarea>
  <div class="actions">
    <button type="submit" class="send">Send edited reply</button>
    <a href="/support/skip?token=%s" class="cancel" style="text-decoration:none;display:inline-block;line-height:36px;padding:0 16px;">Skip instead</a>
  </div>
</form>
</body>
</html>`,
		html.EscapeString(draft.TicketNumber),
		html.EscapeString(draft.TicketNumber),
		html.EscapeString(draft.UserEmail),
		html.EscapeString(draft.AISummary),
		html.EscapeString(tokenRaw),
		html.EscapeString(draft.DraftBodyHTML),
		html.EscapeString(tokenRaw),
	)

	c.Set("Content-Type", "text/html; charset=utf-8")
	return c.SendString(page)
}

// HandleSupportEditSubmit (POST /support/edit/submit) — partner submits the edited body.
func HandleSupportEditSubmit(c *fiber.Ctx) error {
	_, draft, err := loadAndVerifyApprovalToken(c, "edit")
	if err != nil {
		return errorHTMLResponse(c, fiber.StatusBadRequest, err.Error())
	}

	editedBody := strings.TrimSpace(c.FormValue("body"))
	if editedBody == "" {
		return errorHTMLResponse(c, fiber.StatusBadRequest, "Edit body cannot be empty")
	}

	// Mark as edited and send
	if err := markDraftDecided(c.Context(), draft.ID, "edited", editedBody); err != nil {
		if errors.Is(err, ErrAlreadyDecided) {
			return errorHTMLResponse(c, fiber.StatusConflict, "This draft was already actioned")
		}
		log.Printf("[Approval] markDraftDecided: %v", err)
		return errorHTMLResponse(c, fiber.StatusInternalServerError, "Failed to save decision")
	}

	if err := sendApprovedReply(c.Context(), draft, editedBody); err != nil {
		markDraftFailed(c.Context(), draft.ID)
		log.Printf("[Approval] sendApprovedReply (edited): %v", err)
		return errorHTMLResponse(c, fiber.StatusBadGateway, "Failed to send reply")
	}
	markDraftSent(c.Context(), draft.ID)

	return successHTMLResponse(c, "Edited reply sent — user will see it threaded into ticket "+draft.TicketNumber+".")
}

// handleApprovalAction handles the simple Send and Skip flows that
// don't need a body editor. Both share verification + decision
// transitions; only the Send path actually fires an outbound email.
func handleApprovalAction(c *fiber.Ctx, action string) error {
	_, draft, err := loadAndVerifyApprovalToken(c, action)
	if err != nil {
		return errorHTMLResponse(c, fiber.StatusBadRequest, err.Error())
	}

	switch action {
	case "send":
		if err := markDraftDecided(c.Context(), draft.ID, "approved", ""); err != nil {
			if errors.Is(err, ErrAlreadyDecided) {
				return errorHTMLResponse(c, fiber.StatusConflict, "This draft was already actioned")
			}
			log.Printf("[Approval] markDraftDecided: %v", err)
			return errorHTMLResponse(c, fiber.StatusInternalServerError, "Failed to save decision")
		}
		if err := sendApprovedReply(c.Context(), draft, draft.DraftBodyHTML); err != nil {
			markDraftFailed(c.Context(), draft.ID)
			log.Printf("[Approval] sendApprovedReply: %v", err)
			return errorHTMLResponse(c, fiber.StatusBadGateway, "Failed to send reply")
		}
		markDraftSent(c.Context(), draft.ID)
		return successHTMLResponse(c, "Reply sent. The user will see it threaded into ticket "+draft.TicketNumber+".")
	case "skip":
		if err := markDraftDecided(c.Context(), draft.ID, "skipped", ""); err != nil {
			if errors.Is(err, ErrAlreadyDecided) {
				return errorHTMLResponse(c, fiber.StatusConflict, "This draft was already actioned")
			}
			return errorHTMLResponse(c, fiber.StatusInternalServerError, "Failed to save decision")
		}
		return successHTMLResponse(c, "Skipped. The ticket is open in osTicket; handle it manually.")
	default:
		return errorHTMLResponse(c, fiber.StatusBadRequest, "Unknown action")
	}
}

// loadAndVerifyApprovalToken parses the token from the request, checks
// signature/expiry, asserts the action matches the route, and loads
// the underlying draft. expectedAction may be empty to skip the action
// check.
func loadAndVerifyApprovalToken(c *fiber.Ctx, expectedAction string) (*SupportApprovalToken, *SupportDraft, error) {
	raw := c.Query("token")
	if raw == "" {
		raw = c.FormValue("token")
	}
	if raw == "" {
		return nil, nil, fmt.Errorf("missing token")
	}
	t, err := verifyApprovalToken(raw)
	if err != nil {
		return nil, nil, fmt.Errorf("invalid token: %w", err)
	}
	if expectedAction != "" && t.Action != expectedAction {
		return nil, nil, fmt.Errorf("token action mismatch")
	}
	draft, err := loadSupportDraft(c.Context(), t.DraftID)
	if err != nil {
		return nil, nil, fmt.Errorf("load draft: %w", err)
	}
	if draft == nil {
		return nil, nil, fmt.Errorf("draft not found")
	}
	return t, draft, nil
}

func successHTMLResponse(c *fiber.Ctx, msg string) error {
	c.Set("Content-Type", "text/html; charset=utf-8")
	return c.SendString(fmt.Sprintf(`<!DOCTYPE html>
<html><head><title>OK</title><style>body{background:#0a0a0a;color:#e2e8f0;font-family:-apple-system,sans-serif;padding:48px;text-align:center;}h1{color:#10b981;}p{color:#aaa;}</style></head>
<body><h1>%s</h1></body></html>`, html.EscapeString(msg)))
}

func errorHTMLResponse(c *fiber.Ctx, status int, msg string) error {
	c.Status(status)
	c.Set("Content-Type", "text/html; charset=utf-8")
	return c.SendString(fmt.Sprintf(`<!DOCTYPE html>
<html><head><title>Error</title><style>body{background:#0a0a0a;color:#e2e8f0;font-family:-apple-system,sans-serif;padding:48px;text-align:center;}h1{color:#ef4444;}</style></head>
<body><h1>%s</h1></body></html>`, html.EscapeString(msg)))
}

// sendApprovedReply is the seam used by the approval handlers to send
// the partner-approved reply via Resend. Defined here as a variable so
// support.go's handlers_support_approval.go and Phase 1D's body in
// support_drafts.go can be wired without circular package init order.
// Phase 1D rebinds this to the real implementation.
//
// Default no-op returns an explicit error so a Send click before
// Phase 1D is wired up surfaces clearly in logs rather than silently
// succeeding without an email.
var sendApprovedReply = func(ctx context.Context, draft *SupportDraft, body string) error {
	_ = ctx
	_ = draft
	_ = body
	return fmt.Errorf("sendApprovedReply not wired (Phase 1D not yet applied)")
}
