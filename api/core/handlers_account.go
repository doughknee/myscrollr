package core

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/mail"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/gofiber/fiber/v2"
)

// ─────────────────────────────────────────────────────────────────────
//  Per-user password-reset rate limit
//
//  Mirrors the supportRateMap pattern from support.go. Cap one reset
//  request per user per hour. Resend is paid-per-send and these emails
//  are user-triggered — without a cap, a malicious or buggy client
//  could rack up bills and spam an inbox. The window starts on every
//  successful send (recorded inside the handler after the email goes
//  out) so a transient Resend failure doesn't trap the user.
// ─────────────────────────────────────────────────────────────────────

const passwordResetRateLimitWindow = time.Hour

var (
	passwordResetRateMu  sync.Mutex
	passwordResetRateMap = make(map[string]time.Time)
)

// allowedByPasswordResetLimit returns whether the user may request a
// new password-reset email. If they may not, retryAfter is the
// remaining time on the cooldown window for the Retry-After header.
func allowedByPasswordResetLimit(userID string) (allowed bool, retryAfter time.Duration) {
	passwordResetRateMu.Lock()
	defer passwordResetRateMu.Unlock()

	if last, ok := passwordResetRateMap[userID]; ok {
		elapsed := time.Since(last)
		if elapsed < passwordResetRateLimitWindow {
			return false, passwordResetRateLimitWindow - elapsed
		}
	}
	return true, 0
}

// recordPasswordResetSent marks the user's most recent reset email,
// starting the cooldown window. Called only after the Resend API
// accepts the message.
func recordPasswordResetSent(userID string) {
	passwordResetRateMu.Lock()
	defer passwordResetRateMu.Unlock()
	passwordResetRateMap[userID] = time.Now()
}

// ─────────────────────────────────────────────────────────────────────
//  Account self-service handlers
//
//  These endpoints let an authenticated user update their own display
//  name and primary email, and request a password-reset email. Username
//  changes are explicitly rejected — usernames are immutable per
//  product policy (also enforced read-only in Logto admin config).
//
//  All Logto Management API mutations go through the cached M2M token
//  (getM2MToken()). On success, the per-user overview cache is
//  invalidated so the next /users/me/overview reflects the change
//  immediately instead of waiting up to 30s for the singleflight
//  cache to expire.
// ─────────────────────────────────────────────────────────────────────

// UpdateProfileRequest is the body for PUT /users/me/profile.
//
// All fields are optional pointers so we can distinguish "absent" from
// "explicitly empty". Username is accepted in the schema only so we
// can return a clear 403 instead of a generic validation error if a
// client tries to send it; the field is never honored.
type UpdateProfileRequest struct {
	Name     *string `json:"name,omitempty"`
	Email    *string `json:"email,omitempty"`
	Username *string `json:"username,omitempty"`
}

// UpdateProfileResponse echoes the fields that were applied.
type UpdateProfileResponse struct {
	Status string `json:"status"`
	Name   string `json:"name,omitempty"`
	Email  string `json:"email,omitempty"`
}

// HandleUpdateProfile updates the user's display name and/or primary
// email via Logto Management API. Username changes are rejected.
func HandleUpdateProfile(c *fiber.Ctx) error {
	userID := GetUserID(c)
	if userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(ErrorResponse{
			Status: "unauthorized",
			Error:  "authentication required",
		})
	}

	var req UpdateProfileRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Status: "error",
			Error:  "invalid request body",
		})
	}

	if req.Username != nil {
		return c.Status(fiber.StatusForbidden).JSON(ErrorResponse{
			Status: "forbidden",
			Error:  "username changes are not permitted",
		})
	}

	if req.Name == nil && req.Email == nil {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Status: "error",
			Error:  "at least one of name or email is required",
		})
	}

	// Validate email: format, length, and control characters. We do
	// this before contacting Logto so a malformed value gets a precise
	// 400 instead of bouncing off the upstream API.
	if req.Email != nil {
		email := strings.TrimSpace(*req.Email)
		if email == "" {
			return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
				Status: "error",
				Error:  "email cannot be empty",
			})
		}
		if len(email) > 254 {
			return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
				Status: "error",
				Error:  "email exceeds maximum length",
			})
		}
		if strings.ContainsAny(email, "\n\r\x00") {
			return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
				Status: "error",
				Error:  "email contains invalid characters",
			})
		}
		if _, err := mail.ParseAddress(email); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
				Status: "error",
				Error:  "invalid email format",
			})
		}
		// Persist the trimmed value for the Logto patch + response echo.
		*req.Email = email
	}

	// Validate name: length cap and control-character rejection.
	if req.Name != nil {
		name := strings.TrimSpace(*req.Name)
		if len(name) > 200 {
			return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
				Status: "error",
				Error:  "name exceeds maximum length",
			})
		}
		if strings.ContainsAny(name, "\n\r\x00") {
			return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
				Status: "error",
				Error:  "name contains invalid characters",
			})
		}
		*req.Name = name
	}

	cfg := getM2MConfig()
	if cfg.Endpoint == "" {
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Status: "error",
			Error:  "Logto not configured",
		})
	}

	token, err := getM2MToken()
	if err != nil {
		log.Printf("[UpdateProfile] m2m token: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Status: "error",
			Error:  "auth backend unavailable",
		})
	}

	if req.Name != nil {
		if err := updateUserName(cfg.Endpoint, token, userID, *req.Name); err != nil {
			log.Printf("[UpdateProfile] name update for %s: %v", userID, err)
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
				Status: "error",
				Error:  "failed to update name",
			})
		}
	}
	if req.Email != nil {
		if err := updateUserEmail(cfg.Endpoint, token, userID, *req.Email); err != nil {
			log.Printf("[UpdateProfile] email update for %s: %v", userID, err)
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
				Status: "error",
				Error:  "failed to update email",
			})
		}
	}

	// Refresh the overview cache so /users/me/overview returns the new
	// values on the very next call.
	ctx, cancel := context.WithTimeout(c.Context(), 2*time.Second)
	defer cancel()
	InvalidateOverviewCache(ctx, userID)

	resp := UpdateProfileResponse{Status: "ok"}
	if req.Name != nil {
		resp.Name = *req.Name
	}
	if req.Email != nil {
		resp.Email = *req.Email
	}
	return c.JSON(resp)
}

// updateUserName patches the user's display name via Logto Management API.
func updateUserName(endpoint, token, userID, name string) error {
	payload, _ := json.Marshal(map[string]string{"name": name})

	req, err := http.NewRequest(
		http.MethodPatch,
		fmt.Sprintf("%s/api/users/%s", endpoint, userID),
		bytes.NewReader(payload),
	)
	if err != nil {
		return fmt.Errorf("build name request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: LogtoM2MTokenTimeout}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("name request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("name update returned %d: %s", resp.StatusCode, string(body))
	}
	return nil
}

// updateUserEmail patches the user's primary email via Logto Management API.
func updateUserEmail(endpoint, token, userID, email string) error {
	payload, _ := json.Marshal(map[string]string{"primaryEmail": email})

	req, err := http.NewRequest(
		http.MethodPatch,
		fmt.Sprintf("%s/api/users/%s", endpoint, userID),
		bytes.NewReader(payload),
	)
	if err != nil {
		return fmt.Errorf("build email request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: LogtoM2MTokenTimeout}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("email request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("email update returned %d: %s", resp.StatusCode, string(body))
	}
	return nil
}

// ─────────────────────────────────────────────────────────────────────
//  Password reset
//
//  We don't ship Logto's hosted "forgot password" flow inside the
//  desktop app — instead, the user clicks a button that emails them
//  a link to the Logto sign-in page where they can use the standard
//  "Forgot password?" affordance. This avoids embedding a second OIDC
//  flow inside the Tauri webview.
//
//  The email goes through Resend. We don't carry any reset token —
//  Logto generates and validates that itself once the user reaches
//  its UI. From our side this is just a notification.
// ─────────────────────────────────────────────────────────────────────

// HandleRequestPasswordReset sends the authenticated user a password-
// reset email. The email contains a CTA pointing at the Logto sign-in
// page so they can use the built-in "Forgot password?" flow.
func HandleRequestPasswordReset(c *fiber.Ctx) error {
	userID := GetUserID(c)
	if userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(ErrorResponse{
			Status: "unauthorized",
			Error:  "authentication required",
		})
	}

	email, _ := c.Locals("user_email").(string)
	if email == "" {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Status: "error",
			Error:  "no email associated with this account",
		})
	}

	if allowed, retryAfter := allowedByPasswordResetLimit(userID); !allowed {
		c.Set("Retry-After", fmt.Sprintf("%d", int(retryAfter.Seconds())))
		return c.Status(fiber.StatusTooManyRequests).JSON(ErrorResponse{
			Status: "error",
			Error:  "Password reset already requested. Please try again later.",
		})
	}

	signInURL := strings.TrimRight(os.Getenv("LOGTO_ENDPOINT"), "/")
	if signInURL == "" {
		signInURL = "https://auth.myscrollr.com"
	}

	if err := sendPasswordResetEmail(email, signInURL); err != nil {
		log.Printf("[PasswordReset] send failed for %s: %v", userID, err)
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Status: "error",
			Error:  "failed to send reset email",
		})
	}

	recordPasswordResetSent(userID)

	log.Printf("[PasswordReset] sent reset email to %s for user %s", email, userID)
	return c.SendStatus(fiber.StatusNoContent)
}

// sendPasswordResetEmail dispatches a transactional email via Resend.
// Reuses RESEND_API_KEY and RESEND_FROM_EMAIL env vars; the API key is
// the only required setting — the From address falls back to a sane
// default if unset.
func sendPasswordResetEmail(toEmail, signInURL string) error {
	apiKey := os.Getenv("RESEND_API_KEY")
	if apiKey == "" {
		return fmt.Errorf("RESEND_API_KEY not configured")
	}
	from := os.Getenv("RESEND_FROM_EMAIL")
	if from == "" {
		from = "MyScrollr <noreply@myscrollr.com>"
	}

	subject := "Reset your MyScrollr password"
	html := fmt.Sprintf(`<!DOCTYPE html>
<html>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0b0d10;color:#e6e6e6;padding:24px;">
  <div style="max-width:520px;margin:0 auto;background:#14181d;border:1px solid #1e252d;border-radius:12px;padding:32px;">
    <h2 style="margin:0 0 16px;font-size:20px;color:#fff;">Reset your password</h2>
    <p style="margin:0 0 16px;line-height:1.6;color:#b8b8b8;">We received a request to reset the password on your MyScrollr account.</p>
    <p style="margin:24px 0;text-align:center;">
      <a href="%s/sign-in" style="display:inline-block;padding:12px 28px;background:#10b981;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">Reset password</a>
    </p>
    <p style="margin:0 0 16px;line-height:1.6;color:#b8b8b8;font-size:14px;">On the sign-in page, click <strong style="color:#e6e6e6;">Forgot password?</strong> and follow the instructions sent to your email.</p>
    <p style="margin:0;line-height:1.6;color:#7a7a7a;font-size:12px;">If you didn't request this, you can safely ignore this email — your password won't change.</p>
  </div>
  <p style="text-align:center;margin-top:16px;color:#5a5a5a;font-size:11px;">— The MyScrollr Team</p>
</body>
</html>`, signInURL)

	payload, _ := json.Marshal(map[string]interface{}{
		"from":    from,
		"to":      []string{toEmail},
		"subject": subject,
		"html":    html,
	})

	req, err := http.NewRequest(
		http.MethodPost,
		"https://api.resend.com/emails",
		bytes.NewReader(payload),
	)
	if err != nil {
		return fmt.Errorf("build resend request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("resend request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("resend returned %d: %s", resp.StatusCode, string(body))
	}
	return nil
}
