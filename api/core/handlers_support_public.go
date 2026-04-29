package core

import (
	"fmt"
	"log"
	"net"
	"os"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
)

// PublicSupportRequest is the body shape for POST /support/ticket/public.
// Anonymous endpoint — requires email since we don't have a JWT identity.
// Diagnostics + attachments are NOT accepted: this endpoint sits outside
// the authenticated rate limiter, so we keep the attack surface narrow.
type PublicSupportRequest struct {
	Email    string `json:"email"`
	Category string `json:"category"`
	Subject  string `json:"subject"`
	Message  string `json:"message"`
	Name     string `json:"name,omitempty"`
}

// publicSupportRateLimitKey produces the Redis key used to cap anonymous
// ticket submissions per source IP. Key TTL = 1 hour.
func publicSupportRateLimitKey(ip string) string {
	return "support:public:" + ip + ":hour"
}

const (
	publicSupportMaxPerHour = 5
	publicSupportRateWindow = time.Hour
)

// allowedPublicCategories restricts what an unauthenticated user can
// file. Account-related issues are intentionally NOT here — those are
// reserved for the authenticated flow where we already know who's
// asking, and so we don't accidentally reset / leak data based on an
// unverified email.
var allowedPublicCategories = map[string]string{
	"bug":      "Bug Report",
	"feedback": "Feedback",
	"billing":  "Billing",
	"feature":  "Feature Request",
}

// HandleSubmitPublicSupportTicket accepts anonymous support requests
// from the marketing site /support contact form. Per-IP rate-limited
// via Redis (5/hour). Validates email format, restricts categories to
// non-account ones, and forwards via the shared forwardToOSTicket
// helper so the upstream contract stays in sync with the authenticated
// handler.
func HandleSubmitPublicSupportTicket(c *fiber.Ctx) error {
	setCORSHeaders(c)

	var req PublicSupportRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Status: "error",
			Error:  "Invalid request body",
		})
	}

	req.Email = strings.TrimSpace(req.Email)
	req.Subject = strings.TrimSpace(req.Subject)
	req.Message = strings.TrimSpace(req.Message)
	req.Name = strings.TrimSpace(req.Name)
	req.Category = strings.TrimSpace(strings.ToLower(req.Category))

	if req.Email == "" || !strings.Contains(req.Email, "@") || len(req.Email) > 254 {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Status: "error",
			Error:  "Valid email required",
		})
	}
	categoryLabel, ok := allowedPublicCategories[req.Category]
	if !ok {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Status: "error",
			Error:  "Invalid category",
		})
	}
	if len(req.Subject) < 3 || len(req.Subject) > 200 {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Status: "error",
			Error:  "Subject must be 3-200 characters",
		})
	}
	if len(req.Message) < 10 || len(req.Message) > 5000 {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Status: "error",
			Error:  "Message must be 10-5000 characters",
		})
	}

	// Per-IP rate limit. Soft-fail on Redis errors — we'd rather accept
	// a ticket than lose one. The IP-based fiber limiter that wraps the
	// route gives us a coarse outer bound; this counter is the per-IP
	// hourly cap on top of that.
	ip := c.IP()
	if Rdb != nil && ip != "" {
		key := publicSupportRateLimitKey(ip)
		count, err := Rdb.Incr(c.Context(), key).Result()
		if err == nil {
			if count == 1 {
				_ = Rdb.Expire(c.Context(), key, publicSupportRateWindow).Err()
			}
			if count > publicSupportMaxPerHour {
				return c.Status(fiber.StatusTooManyRequests).JSON(ErrorResponse{
					Status: "error",
					Error:  "Too many requests; please try again in an hour",
				})
			}
		} else {
			log.Printf("[PublicSupport] Redis INCR failed (continuing): %v", err)
		}
	}

	// Resolve topic ID — reuse the per-category overrides the
	// authenticated handler honors, so anonymous tickets land in the
	// same OS Ticket queues as their authenticated equivalents.
	topicID := os.Getenv("OSTICKET_TOPIC_ID")
	switch req.Category {
	case "feature":
		if id := os.Getenv("OSTICKET_TOPIC_ID_FEATURE"); id != "" {
			topicID = id
		}
	case "feedback":
		if id := os.Getenv("OSTICKET_TOPIC_ID_FEEDBACK"); id != "" {
			topicID = id
		}
	case "billing":
		if id := os.Getenv("OSTICKET_TOPIC_ID_BILLING"); id != "" {
			topicID = id
		}
	}

	// Build OS Ticket payload. Match the same Message format the
	// authenticated handler uses (data: URL with HTML body) so OS
	// Ticket renders both submission types consistently.
	bodyHTML := fmt.Sprintf(
		"<h3>%s</h3><p>%s</p><hr/><p><em>Submitted anonymously from the marketing site (IP %s).</em></p>",
		escapeHTML(categoryLabel),
		escapeHTML(req.Message),
		escapeHTML(redactIP(ip)),
	)

	payload := OSTicketPayload{
		Name:    fallbackName(req.Name, req.Email),
		Email:   req.Email,
		Subject: fmt.Sprintf("[%s] %s", categoryLabel, req.Subject),
		Message: fmt.Sprintf("data:text/html;charset=utf-8,%s", bodyHTML),
	}
	if topicID != "" {
		payload.TopicID = topicID
	}

	if err := forwardToOSTicket(c.Context(), payload); err != nil {
		log.Printf("[PublicSupport] forwardToOSTicket failed for ip=%s email=%s: %v",
			redactIP(ip), redactEmail(req.Email), err)
		return c.Status(fiber.StatusBadGateway).JSON(ErrorResponse{
			Status: "error",
			Error:  "Failed to submit ticket; please try again later",
		})
	}

	log.Printf("[PublicSupport] Ticket created from ip=%s email=%s category=%s",
		redactIP(ip), redactEmail(req.Email), req.Category)

	return c.JSON(fiber.Map{
		"status":  "ok",
		"message": "Ticket submitted",
	})
}

// fallbackName returns the supplied name or, failing that, the local
// part of the email address. OS Ticket requires a non-empty name.
func fallbackName(name, email string) string {
	if name != "" {
		return name
	}
	return strings.SplitN(email, "@", 2)[0]
}

// redactIP keeps the first three octets of an IPv4 / first /64 of an
// IPv6 for log correlation while dropping host bits. Used in log lines
// so an operator can grep for repeated abuse without storing full IPs.
func redactIP(ip string) string {
	if ip == "" {
		return ""
	}
	if parsed := net.ParseIP(ip); parsed != nil {
		if v4 := parsed.To4(); v4 != nil {
			return fmt.Sprintf("%d.%d.%d.x", v4[0], v4[1], v4[2])
		}
		return parsed.Mask(net.CIDRMask(64, 128)).String() + "/64"
	}
	return "x"
}

// redactEmail keeps the first character of the local part and the full
// domain — enough to disambiguate spam patterns in logs without storing
// the full identifier.
func redactEmail(email string) string {
	at := strings.IndexByte(email, '@')
	if at <= 0 {
		return "x"
	}
	return string(email[0]) + "***" + email[at:]
}
