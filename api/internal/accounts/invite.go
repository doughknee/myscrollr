package accounts

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/gofiber/fiber/v2"
)

// =============================================================================
// Invite — Super User onboarding flow
// =============================================================================

// CompleteInviteRequest is the request body for POST /invite/complete.
type CompleteInviteRequest struct {
	Email     string `json:"email"`
	Token     string `json:"token"`
	Password  string `json:"password"`
	Birthday  string `json:"birthday"`
	Gender    string `json:"gender"`
	Username  string `json:"username"`
	FirstName string `json:"first_name"`
	LastName  string `json:"last_name"`
}

// superUserRoleID is the Logto role ID that gates super-user onboarding.
// Read lazily from LOGTO_SUPER_USER_ROLE_ID so the value isn't baked into
// the binary. Mirrors how the other role IDs (LOGTO_ULTIMATE_ROLE_ID,
// LOGTO_PRO_ROLE_ID, LOGTO_UPLINK_ROLE_ID) are loaded in logto_admin.go.
//
// Returns the empty string when unset — callers treat that as "no user
// can pass the gate" so missing config fails closed.
func superUserRoleID() string {
	return os.Getenv("LOGTO_SUPER_USER_ROLE_ID")
}

// warnIfSuperUserRoleUnset emits a one-time startup-ish warning when the
// env var is missing. Not fatal — the super-user invite flow may not be
// needed in every environment (e.g. local dev).
var superUserRoleWarnOnce = func() func() {
	var done bool
	return func() {
		if done {
			return
		}
		done = true
		if superUserRoleID() == "" {
			log.Println("[Invite] Warning: LOGTO_SUPER_USER_ROLE_ID is not set; super-user invite flow is disabled")
		}
	}
}()

var usernameRegex = regexp.MustCompile(`^[a-z0-9_]{3,24}$`)

// HandleCompleteInvite verifies an invite token, updates the user's password,
// profile, username, and display name in Logto, then returns success.
//
// POST /invite/complete (no auth middleware — user isn't logged in yet)
func HandleCompleteInvite(c *fiber.Ctx) error {
	var req CompleteInviteRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(platform.ErrorResponse{Error: "Invalid request body"})
	}

	// Validate required fields
	if req.Email == "" || req.Token == "" || req.Password == "" || req.Birthday == "" || req.Gender == "" || req.Username == "" || req.FirstName == "" || req.LastName == "" {
		return c.Status(fiber.StatusBadRequest).JSON(platform.ErrorResponse{Error: "All fields are required"})
	}
	if len(req.Password) < 8 {
		return c.Status(fiber.StatusBadRequest).JSON(platform.ErrorResponse{Error: "Password must be at least 8 characters"})
	}
	if !usernameRegex.MatchString(req.Username) {
		return c.Status(fiber.StatusBadRequest).JSON(platform.ErrorResponse{Error: "Username must be 3-24 characters, lowercase letters, digits, or underscores"})
	}

	m2mToken, err := getM2MToken()
	if err != nil {
		log.Printf("[Invite] Failed to get M2M token: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(platform.ErrorResponse{Error: "Internal server error"})
	}

	cfg := getM2MConfig()

	// Server-side one-time token check. This is the ONLY authorization
	// gate that proves the caller actually received the emailed invite
	// link for this address. The token is NOT consumed here — we want
	// it to stay active so the frontend can call signIn() with it
	// immediately after account setup and have Logto's magic-link flow
	// consume it as part of authentication. That gives a seamless
	// "submit form → land on /account already signed in" UX, with no
	// password re-entry.
	if err := findActiveOneTimeToken(cfg.Endpoint, m2mToken, req.Email, req.Token); err != nil {
		log.Printf("[Invite] Token verification failed for %s: %v", platform.MaskEmail(req.Email), err)
		return c.Status(fiber.StatusBadRequest).JSON(platform.ErrorResponse{
			Error: "Invite link is invalid or has expired",
		})
	}

	userID, _, err := findUserByEmail(cfg.Endpoint, m2mToken, req.Email)
	if err != nil {
		log.Printf("[Invite] User lookup failed for %s: %v", platform.MaskEmail(req.Email), err)
		return c.Status(fiber.StatusNotFound).JSON(platform.ErrorResponse{Error: "Invite not found"})
	}

	roleID := superUserRoleID()
	if roleID == "" {
		superUserRoleWarnOnce()
		return c.Status(fiber.StatusForbidden).JSON(platform.ErrorResponse{Error: "Not authorized"})
	}
	hasSuperUser, err := userHasRole(cfg.Endpoint, m2mToken, userID, roleID)
	if err != nil {
		log.Printf("[Invite] Role check failed for %s: %v", platform.MaskEmail(req.Email), err)
		return c.Status(fiber.StatusInternalServerError).JSON(platform.ErrorResponse{Error: "Internal server error"})
	}
	if !hasSuperUser {
		return c.Status(fiber.StatusForbidden).JSON(platform.ErrorResponse{Error: "Not authorized"})
	}

	available, err := checkUsernameAvailable(cfg.Endpoint, m2mToken, req.Username)
	if err != nil {
		log.Printf("[Invite] Username check failed for %s: %v", req.Username, err)
		return c.Status(fiber.StatusInternalServerError).JSON(platform.ErrorResponse{Error: "Internal server error"})
	}
	if !available {
		return c.Status(fiber.StatusConflict).JSON(platform.ErrorResponse{Error: "Username was taken, please choose another"})
	}

	if err := updateUserPassword(cfg.Endpoint, m2mToken, userID, req.Password); err != nil {
		log.Printf("[Invite] Password update failed for %s: %v", platform.MaskEmail(req.Email), err)
		return c.Status(fiber.StatusInternalServerError).JSON(platform.ErrorResponse{Error: "Failed to set password"})
	}

	if err := updateUserProfile(cfg.Endpoint, m2mToken, userID, req.Gender, req.Birthday, req.FirstName, req.LastName); err != nil {
		log.Printf("[Invite] Profile update failed for %s: %v", platform.MaskEmail(req.Email), err)
		return c.Status(fiber.StatusInternalServerError).JSON(platform.ErrorResponse{Error: "Failed to update profile"})
	}

	displayName := req.FirstName + " " + req.LastName
	if err := updateUserIdentity(cfg.Endpoint, m2mToken, userID, req.Username, displayName); err != nil {
		if err.Error() == "username_taken" {
			return c.Status(fiber.StatusConflict).JSON(platform.ErrorResponse{Error: "Username was taken, please choose another"})
		}
		log.Printf("[Invite] Identity update failed for %s: %v", platform.MaskEmail(req.Email), err)
		return c.Status(fiber.StatusInternalServerError).JSON(platform.ErrorResponse{Error: "Failed to set username"})
	}

	log.Printf("[Invite] Completed invite for %s (user: %s, username: %s)", platform.MaskEmail(req.Email), userID, req.Username)

	return c.JSON(fiber.Map{
		"success":  true,
		"username": req.Username,
	})
}

// HandleCheckUsernameAvailable checks if a username is available.
// GET /invite/username-available?email=X&username=Y (no auth — verified via email+role)
func HandleCheckUsernameAvailable(c *fiber.Ctx) error {
	email := c.Query("email")
	username := c.Query("username")

	if email == "" || username == "" {
		return c.Status(fiber.StatusBadRequest).JSON(platform.ErrorResponse{Error: "email and username are required"})
	}

	if !usernameRegex.MatchString(username) {
		return c.JSON(fiber.Map{
			"available": false,
			"reason":    "invalid",
		})
	}

	m2mToken, err := getM2MToken()
	if err != nil {
		log.Printf("[Invite] Username check: M2M token failed: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(platform.ErrorResponse{Error: "Internal server error"})
	}

	cfg := getM2MConfig()

	userID, _, err := findUserByEmail(cfg.Endpoint, m2mToken, email)
	if err != nil {
		return c.Status(fiber.StatusForbidden).JSON(platform.ErrorResponse{Error: "Not authorized"})
	}

	roleID := superUserRoleID()
	if roleID == "" {
		superUserRoleWarnOnce()
		return c.Status(fiber.StatusForbidden).JSON(platform.ErrorResponse{Error: "Not authorized"})
	}
	hasSuperUser, err := userHasRole(cfg.Endpoint, m2mToken, userID, roleID)
	if err != nil || !hasSuperUser {
		return c.Status(fiber.StatusForbidden).JSON(platform.ErrorResponse{Error: "Not authorized"})
	}

	available, err := checkUsernameAvailable(cfg.Endpoint, m2mToken, username)
	if err != nil {
		log.Printf("[Invite] Username availability check failed: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(platform.ErrorResponse{Error: "Internal server error"})
	}

	if !available {
		return c.JSON(fiber.Map{
			"available": false,
			"reason":    "taken",
		})
	}

	return c.JSON(fiber.Map{
		"available": true,
	})
}

// ── Logto Management API helpers ────────────────────────────────────

// findActiveOneTimeToken validates a Logto one-time token against the
// given email WITHOUT consuming it. The token stays active so the
// frontend can immediately call signIn({extraParams:{one_time_token}})
// and have Logto consume it during the magic-link sign-in flow. This
// is the key piece that lets the invite UX skip the "type your
// password again" step after account setup.
//
// We use GET /api/one-time-tokens?email=...&status=active to list
// candidate tokens, then check that our specific token value is among
// the active ones and not expired.
//
// Returns nil when the token is active, valid, and bound to this
// email; a non-nil error otherwise.
func findActiveOneTimeToken(endpoint, m2mToken, email, ott string) error {
	listURL := fmt.Sprintf(
		"%s/api/one-time-tokens?email=%s&status=active&page_size=20",
		endpoint, url.QueryEscape(email),
	)
	req, err := http.NewRequest("GET", listURL, nil)
	if err != nil {
		return fmt.Errorf("create list request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+m2mToken)

	client := &http.Client{Timeout: platform.LogtoM2MTokenTimeout}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("list request failed: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("list returned %d: %s", resp.StatusCode, string(body))
	}

	var tokens []struct {
		ID        string `json:"id"`
		Email     string `json:"email"`
		Token     string `json:"token"`
		Status    string `json:"status"`
		ExpiresAt int64  `json:"expiresAt"`
	}
	if err := json.Unmarshal(body, &tokens); err != nil {
		return fmt.Errorf("parse list response: %w", err)
	}

	now := time.Now().UnixMilli()
	for _, t := range tokens {
		if t.Token != ott {
			continue
		}
		// Logto returned this filtered to status=active, but defense-
		// in-depth: re-check status and expiry ourselves in case the
		// filter is loose or the list is paginated stale.
		if t.Status != "active" {
			return fmt.Errorf("token status is %s, not active", t.Status)
		}
		if t.ExpiresAt > 0 && t.ExpiresAt < now {
			return fmt.Errorf("token expired at %d (now %d)", t.ExpiresAt, now)
		}
		if !strings.EqualFold(t.Email, email) {
			return fmt.Errorf("token bound to different email")
		}
		return nil
	}
	return fmt.Errorf("token not found among active tokens for this email")
}

// findUserByEmail searches for a user by primary email and returns (userID, username, error).
func findUserByEmail(endpoint, token, email string) (string, string, error) {
	searchURL := fmt.Sprintf("%s/api/users?search.primaryEmail=%s", endpoint, url.QueryEscape(email))
	req, err := http.NewRequest("GET", searchURL, nil)
	if err != nil {
		return "", "", fmt.Errorf("create search request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)

	client := &http.Client{Timeout: platform.LogtoM2MTokenTimeout}
	resp, err := client.Do(req)
	if err != nil {
		return "", "", fmt.Errorf("search request failed: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return "", "", fmt.Errorf("search returned %d: %s", resp.StatusCode, string(body))
	}

	var users []struct {
		ID       string  `json:"id"`
		Username *string `json:"username"`
	}
	if err := json.Unmarshal(body, &users); err != nil {
		return "", "", fmt.Errorf("parse search response: %w", err)
	}
	if len(users) == 0 {
		return "", "", fmt.Errorf("no user found with email %s", email)
	}

	username := ""
	if users[0].Username != nil {
		username = *users[0].Username
	}
	return users[0].ID, username, nil
}

// userHasRole checks whether a Logto user has a specific role.
func userHasRole(endpoint, token, userID, roleID string) (bool, error) {
	reqURL := fmt.Sprintf("%s/api/users/%s/roles", endpoint, userID)
	req, err := http.NewRequest("GET", reqURL, nil)
	if err != nil {
		return false, fmt.Errorf("create roles request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)

	client := &http.Client{Timeout: platform.LogtoM2MTokenTimeout}
	resp, err := client.Do(req)
	if err != nil {
		return false, fmt.Errorf("roles request failed: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return false, fmt.Errorf("roles returned %d: %s", resp.StatusCode, string(body))
	}

	var roles []struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(body, &roles); err != nil {
		return false, fmt.Errorf("parse roles response: %w", err)
	}

	for _, r := range roles {
		if r.ID == roleID {
			return true, nil
		}
	}
	return false, nil
}

// checkUsernameAvailable checks if a username is available in Logto.
// Logto search is partial match, so we verify exact match in results.
func checkUsernameAvailable(endpoint, token, username string) (bool, error) {
	searchURL := fmt.Sprintf("%s/api/users?search.username=%s", endpoint, url.QueryEscape(username))
	req, err := http.NewRequest("GET", searchURL, nil)
	if err != nil {
		return false, fmt.Errorf("create username search request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)

	client := &http.Client{Timeout: platform.LogtoM2MTokenTimeout}
	resp, err := client.Do(req)
	if err != nil {
		return false, fmt.Errorf("username search request failed: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return false, fmt.Errorf("username search returned %d: %s", resp.StatusCode, string(body))
	}

	var users []struct {
		Username *string `json:"username"`
	}
	if err := json.Unmarshal(body, &users); err != nil {
		return false, fmt.Errorf("parse username search response: %w", err)
	}

	for _, u := range users {
		if u.Username != nil && *u.Username == username {
			return false, nil // taken
		}
	}
	return true, nil // available
}

// updateUserPassword updates a user's password via Logto Management API.
func updateUserPassword(endpoint, token, userID, password string) error {
	payload, _ := json.Marshal(map[string]string{
		"password": password,
	})

	req, err := http.NewRequest("PATCH", fmt.Sprintf("%s/api/users/%s/password", endpoint, userID), bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("create password update request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: platform.LogtoM2MTokenTimeout}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("password update request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("password update returned %d: %s", resp.StatusCode, string(body))
	}

	return nil
}

// updateUserIdentity sets the username and display name on a Logto user.
// Returns a special error message if Logto rejects the username (422 = taken/invalid).
func updateUserIdentity(endpoint, token, userID, username, name string) error {
	payload, _ := json.Marshal(map[string]string{
		"username": username,
		"name":     name,
	})

	req, err := http.NewRequest("PATCH", fmt.Sprintf("%s/api/users/%s", endpoint, userID), bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("create identity update request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: platform.LogtoM2MTokenTimeout}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("identity update request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusUnprocessableEntity {
		return fmt.Errorf("username_taken")
	}

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("identity update returned %d: %s", resp.StatusCode, string(body))
	}

	return nil
}

// updateUserProfile updates a user's gender, birthdate, and optionally name fields via Logto Management API.
func updateUserProfile(endpoint, token, userID, gender, birthdate, givenName, familyName string) error {
	profileFields := map[string]string{
		"gender":    gender,
		"birthdate": birthdate,
	}
	if givenName != "" {
		profileFields["givenName"] = givenName
	}
	if familyName != "" {
		profileFields["familyName"] = familyName
	}

	payload, _ := json.Marshal(map[string]interface{}{
		"profile": profileFields,
	})

	req, err := http.NewRequest("PATCH", fmt.Sprintf("%s/api/users/%s/profile", endpoint, userID), bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("create profile update request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: platform.LogtoM2MTokenTimeout}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("profile update request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("profile update returned %d: %s", resp.StatusCode, string(body))
	}

	return nil
}
