package core

import (
	"bytes"
	"encoding/hex"
	"fmt"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/stripe/stripe-go/v82/webhook"
)

// =============================================================================
// Decision logic — decideCheckoutTier
// =============================================================================

func TestDecideCheckoutTier(t *testing.T) {
	tests := []struct {
		name      string
		subStatus string
		plan      string
		want      string
	}{
		// Trials always get Ultimate access regardless of the selected plan.
		{"trialing monthly", "trialing", "monthly", tierUltimate},
		{"trialing pro", "trialing", "pro_monthly", tierUltimate},
		{"trialing ultimate", "trialing", "ultimate_annual", tierUltimate},
		// Lifetime purchases grant Ultimate access.
		{"lifetime", "active", "lifetime", tierUltimate},
		// Active subscriptions get the plan-appropriate role.
		{"active ultimate monthly", "active", "ultimate_monthly", tierUltimate},
		{"active ultimate annual", "active", "ultimate_annual", tierUltimate},
		{"active pro monthly", "active", "pro_monthly", tierPro},
		{"active pro annual", "active", "pro_annual", tierPro},
		{"active monthly", "active", "monthly", tierUplink},
		{"active annual", "active", "annual", tierUplink},
		// Unknown plans fall back to the base paid tier (mirrors planRank).
		{"active unknown plan", "active", "unknown", tierUplink},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := decideCheckoutTier(tc.subStatus, tc.plan)
			if got != tc.want {
				t.Errorf("decideCheckoutTier(%q, %q) = %q, want %q", tc.subStatus, tc.plan, got, tc.want)
			}
		})
	}
}

// =============================================================================
// Decision logic — decideSubscriptionUpdate
// =============================================================================

func TestDecideSubscriptionUpdate(t *testing.T) {
	tests := []struct {
		name              string
		status            string
		cancelAtPeriodEnd bool
		plan              string
		want              subscriptionUpdateAction
	}{
		{
			name: "active ultimate assigns ultimate after clearing stale roles",
			status: "active", plan: "ultimate_monthly",
			want: subscriptionUpdateAction{DBStatus: "active", ClearPaidRoles: true, AssignTier: tierUltimate},
		},
		{
			name: "active pro assigns pro after clearing stale roles",
			status: "active", plan: "pro_annual",
			want: subscriptionUpdateAction{DBStatus: "active", ClearPaidRoles: true, AssignTier: tierPro},
		},
		{
			name: "active base plan assigns uplink after clearing stale roles",
			status: "active", plan: "monthly",
			want: subscriptionUpdateAction{DBStatus: "active", ClearPaidRoles: true, AssignTier: tierUplink},
		},
		{
			// Documents current behavior: an unmapped price ID (e.g. a missing
			// STRIPE_PRICE_* env var) stores plan="unknown" and grants the
			// base paid tier rather than revoking access.
			name: "active unknown plan falls back to uplink",
			status: "active", plan: "unknown",
			want: subscriptionUpdateAction{DBStatus: "active", ClearPaidRoles: true, AssignTier: tierUplink},
		},
		{
			// Trials get Ultimate access without clearing roles; the
			// plan-appropriate role is assigned when the trial converts.
			name: "trialing grants ultimate regardless of plan",
			status: "trialing", plan: "monthly",
			want: subscriptionUpdateAction{DBStatus: "trialing", AssignTier: tierUltimate},
		},
		{
			name: "cancel at period end stores canceling and never touches roles",
			status: "active", cancelAtPeriodEnd: true, plan: "ultimate_monthly",
			want: subscriptionUpdateAction{DBStatus: "canceling"},
		},
		{
			name: "canceling trial stores canceling and never touches roles",
			status: "trialing", cancelAtPeriodEnd: true, plan: "pro_monthly",
			want: subscriptionUpdateAction{DBStatus: "canceling"},
		},
		{
			name: "past_due keeps roles untouched",
			status: "past_due", plan: "ultimate_monthly",
			want: subscriptionUpdateAction{DBStatus: "past_due"},
		},
		{
			name: "canceled keeps roles untouched",
			status: "canceled", plan: "monthly",
			want: subscriptionUpdateAction{DBStatus: "canceled"},
		},
		{
			name: "incomplete keeps roles untouched",
			status: "incomplete", plan: "pro_monthly",
			want: subscriptionUpdateAction{DBStatus: "incomplete"},
		},
		{
			name: "unpaid keeps roles untouched",
			status: "unpaid", plan: "ultimate_annual",
			want: subscriptionUpdateAction{DBStatus: "unpaid"},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := decideSubscriptionUpdate(tc.status, tc.cancelAtPeriodEnd, tc.plan)
			if got != tc.want {
				t.Errorf("decideSubscriptionUpdate(%q, %v, %q) = %+v, want %+v",
					tc.status, tc.cancelAtPeriodEnd, tc.plan, got, tc.want)
			}
		})
	}
}

// =============================================================================
// Decision logic — tierForPlan
// =============================================================================

func TestTierForPlan(t *testing.T) {
	tests := []struct {
		plan string
		want string
	}{
		{"ultimate_monthly", tierUltimate},
		{"ultimate_annual", tierUltimate},
		{"pro_monthly", tierPro},
		{"pro_annual", tierPro},
		{"monthly", tierUplink},
		{"annual", tierUplink},
		{"lifetime", tierUplink}, // lifetime is handled upstream by decideCheckoutTier
		{"unknown", tierUplink},
		{"", tierUplink},
	}

	for _, tc := range tests {
		t.Run(tc.plan, func(t *testing.T) {
			got := tierForPlan(tc.plan)
			if got != tc.want {
				t.Errorf("tierForPlan(%q) = %q, want %q", tc.plan, got, tc.want)
			}
		})
	}
}

// =============================================================================
// HandleStripeWebhook — signature verification
// =============================================================================

// newWebhookTestApp returns a Fiber app with only the Stripe webhook route,
// mirroring how server.go registers it.
func newWebhookTestApp() *fiber.App {
	app := fiber.New()
	app.Post("/webhooks/stripe", HandleStripeWebhook)
	return app
}

// signStripePayload produces a valid Stripe-Signature header for the payload,
// using the same scheme Stripe uses (t=<unix>,v1=<hex HMAC-SHA256>).
func signStripePayload(t *testing.T, payload []byte, secret string, at time.Time) string {
	t.Helper()
	sig := webhook.ComputeSignature(at, payload, secret)
	return fmt.Sprintf("t=%d,v1=%s", at.Unix(), hex.EncodeToString(sig))
}

func postWebhook(t *testing.T, app *fiber.App, payload []byte, sigHeader string) int {
	t.Helper()
	req := httptest.NewRequest("POST", "/webhooks/stripe", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	if sigHeader != "" {
		req.Header.Set("Stripe-Signature", sigHeader)
	}
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("app.Test failed: %v", err)
	}
	defer resp.Body.Close()
	return resp.StatusCode
}

// unhandledEvent is a minimal valid Stripe event of a type the handler
// ignores, so the dispatch path runs without touching the database or Logto.
const unhandledEvent = `{"id":"evt_test_1","object":"event","type":"product.created","data":{"object":{}}}`

func TestHandleStripeWebhookMissingSecret(t *testing.T) {
	t.Setenv("STRIPE_WEBHOOK_SECRET", "")

	app := newWebhookTestApp()
	status := postWebhook(t, app, []byte(unhandledEvent), "")
	if status != fiber.StatusInternalServerError {
		t.Errorf("missing webhook secret: status = %d, want %d", status, fiber.StatusInternalServerError)
	}
}

func TestHandleStripeWebhookRejectsMissingSignature(t *testing.T) {
	t.Setenv("STRIPE_WEBHOOK_SECRET", "whsec_test_secret")

	app := newWebhookTestApp()
	status := postWebhook(t, app, []byte(unhandledEvent), "")
	if status != fiber.StatusBadRequest {
		t.Errorf("missing signature: status = %d, want %d", status, fiber.StatusBadRequest)
	}
}

func TestHandleStripeWebhookRejectsWrongSecret(t *testing.T) {
	t.Setenv("STRIPE_WEBHOOK_SECRET", "whsec_test_secret")

	app := newWebhookTestApp()
	payload := []byte(unhandledEvent)
	sig := signStripePayload(t, payload, "whsec_wrong_secret", time.Now())
	status := postWebhook(t, app, payload, sig)
	if status != fiber.StatusBadRequest {
		t.Errorf("wrong secret: status = %d, want %d", status, fiber.StatusBadRequest)
	}
}

func TestHandleStripeWebhookRejectsTamperedPayload(t *testing.T) {
	t.Setenv("STRIPE_WEBHOOK_SECRET", "whsec_test_secret")

	app := newWebhookTestApp()
	sig := signStripePayload(t, []byte(unhandledEvent), "whsec_test_secret", time.Now())
	tampered := []byte(`{"id":"evt_evil","object":"event","type":"product.created","data":{"object":{}}}`)
	status := postWebhook(t, app, tampered, sig)
	if status != fiber.StatusBadRequest {
		t.Errorf("tampered payload: status = %d, want %d", status, fiber.StatusBadRequest)
	}
}

func TestHandleStripeWebhookRejectsExpiredTimestamp(t *testing.T) {
	t.Setenv("STRIPE_WEBHOOK_SECRET", "whsec_test_secret")

	app := newWebhookTestApp()
	payload := []byte(unhandledEvent)
	// Signed well outside StripeWebhookTolerance (300s).
	stale := time.Now().Add(-2 * StripeWebhookTolerance * time.Second)
	sig := signStripePayload(t, payload, "whsec_test_secret", stale)
	status := postWebhook(t, app, payload, sig)
	if status != fiber.StatusBadRequest {
		t.Errorf("expired timestamp: status = %d, want %d", status, fiber.StatusBadRequest)
	}
}

func TestHandleStripeWebhookAcceptsValidSignature(t *testing.T) {
	t.Setenv("STRIPE_WEBHOOK_SECRET", "whsec_test_secret")

	app := newWebhookTestApp()
	payload := []byte(unhandledEvent)
	sig := signStripePayload(t, payload, "whsec_test_secret", time.Now())
	status := postWebhook(t, app, payload, sig)
	if status != fiber.StatusOK {
		t.Errorf("valid signature: status = %d, want %d", status, fiber.StatusOK)
	}
}
