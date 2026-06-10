package core

import (
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"
)

// =============================================================================
// Subscription guard — deletionBlockedBySubscription
// =============================================================================

func TestDeletionBlockedBySubscription(t *testing.T) {
	tests := []struct {
		name         string
		stripeStatus string
		lifetime     bool
		want         bool
	}{
		// Live or still-billable subscriptions must be canceled first.
		{"active blocks", "active", false, true},
		{"trialing blocks", "trialing", false, true},
		{"canceling blocks", "canceling", false, true},
		{"past_due blocks", "past_due", false, true},

		// Ended subscriptions don't block.
		{"canceled does not block", "canceled", false, false},
		{"none does not block", "none", false, false},
		// No stripe_customers row at all (scan left zero values).
		{"no billing record does not block", "", false, false},

		// Lifetime members are never blocked — their Stripe row is
		// anonymized at purge time, not deleted.
		{"lifetime with active status does not block", "active", true, false},
		{"lifetime with trialing status does not block", "trialing", true, false},
		{"lifetime with past_due status does not block", "past_due", true, false},
		{"lifetime with no status does not block", "", true, false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := deletionBlockedBySubscription(tc.stripeStatus, tc.lifetime)
			if got != tc.want {
				t.Errorf("deletionBlockedBySubscription(%q, %v) = %v, want %v",
					tc.stripeStatus, tc.lifetime, got, tc.want)
			}
		})
	}
}

// =============================================================================
// Worker safety invariants
// =============================================================================

// TestGDPRPurgeGuards pins the relationship between the grace window and the
// purge worker's safety floor. If someone shrinks the grace window below the
// floor, pending requests would never become eligible; if someone removes
// the floor, a bad purge_at row could trigger an immediate mass-purge.
func TestGDPRPurgeGuards(t *testing.T) {
	if GDPRGraceWindow != 30*24*time.Hour {
		t.Errorf("GDPRGraceWindow = %v, want 30 days — this is a public product promise (account deletion undo period); update the website/legal copy if changing it", GDPRGraceWindow)
	}
	if GDPRMinGraceForPurge < 24*time.Hour {
		t.Errorf("GDPRMinGraceForPurge = %v, want >= 24h — it is the floor guard against an immediate mass-purge from a misconfigured purge_at", GDPRMinGraceForPurge)
	}
	if GDPRMinGraceForPurge >= GDPRGraceWindow {
		t.Errorf("GDPRMinGraceForPurge (%v) must be < GDPRGraceWindow (%v), otherwise requests are never eligible for purge", GDPRMinGraceForPurge, GDPRGraceWindow)
	}
	if GDPRPurgeInterval <= 0 || GDPRPurgeInterval > 24*time.Hour {
		t.Errorf("GDPRPurgeInterval = %v, want a sane scan cadence (0 < interval <= 24h)", GDPRPurgeInterval)
	}
}

// =============================================================================
// Handler request validation (no-DB paths)
// =============================================================================

// newDeletionTestApp mounts the deletion handlers behind a middleware that
// fakes the LogtoAuth locals, mirroring handlers_overview_test.go. An empty
// userID simulates an unauthenticated request.
func newDeletionTestApp(userID string) *fiber.App {
	app := fiber.New()
	app.Use(func(c *fiber.Ctx) error {
		if userID != "" {
			c.Locals("user_id", userID)
		}
		return c.Next()
	})
	app.Post("/users/me/delete", HandleRequestAccountDeletion)
	app.Post("/users/me/delete/cancel", HandleCancelAccountDeletion)
	app.Get("/users/me/delete/status", HandleAccountDeletionStatus)
	app.Get("/users/me/export", HandleExportUserData)
	return app
}

func testRequest(t *testing.T, app *fiber.App, method, path, body string) int {
	t.Helper()
	var req = httptest.NewRequest(method, path, strings.NewReader(body))
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("app.Test failed: %v", err)
	}
	defer resp.Body.Close()
	return resp.StatusCode
}

func TestDeletionEndpointsRequireAuth(t *testing.T) {
	app := newDeletionTestApp("")

	cases := []struct {
		method string
		path   string
	}{
		{"POST", "/users/me/delete"},
		{"POST", "/users/me/delete/cancel"},
		{"GET", "/users/me/delete/status"},
		{"GET", "/users/me/export"},
	}
	for _, tc := range cases {
		t.Run(tc.method+" "+tc.path, func(t *testing.T) {
			status := testRequest(t, app, tc.method, tc.path, "")
			if status != fiber.StatusUnauthorized {
				t.Errorf("%s %s without auth: status = %d, want %d", tc.method, tc.path, status, fiber.StatusUnauthorized)
			}
		})
	}
}

func TestRequestAccountDeletionRejectsBadConfirmation(t *testing.T) {
	app := newDeletionTestApp("user_test_123")

	cases := []struct {
		name string
		body string
	}{
		{"empty body", ""},
		{"malformed json", `{"confirm":`},
		{"missing confirm field", `{}`},
		{"empty confirm", `{"confirm":""}`},
		{"wrong phrase", `{"confirm":"delete my account please"}`},
		// The phrase is case-sensitive and exact-match by design.
		{"lowercase phrase", `{"confirm":"delete my account"}`},
		{"phrase with whitespace", `{"confirm":" DELETE MY ACCOUNT "}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			status := testRequest(t, app, "POST", "/users/me/delete", tc.body)
			if status != fiber.StatusBadRequest {
				t.Errorf("confirm=%s: status = %d, want %d", tc.body, status, fiber.StatusBadRequest)
			}
		})
	}
}
