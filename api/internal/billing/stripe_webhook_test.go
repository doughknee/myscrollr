package billing

import (
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/testsupport"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
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
		lifetime          bool
		want              subscriptionUpdateAction
	}{
		{
			name:   "active ultimate assigns ultimate after clearing stale roles",
			status: "active", plan: "ultimate_monthly",
			want: subscriptionUpdateAction{DBStatus: "active", ClearPaidRoles: true, AssignTier: tierUltimate},
		},
		{
			name:   "active pro assigns pro after clearing stale roles",
			status: "active", plan: "pro_annual",
			want: subscriptionUpdateAction{DBStatus: "active", ClearPaidRoles: true, AssignTier: tierPro},
		},
		{
			name:   "active base plan assigns uplink after clearing stale roles",
			status: "active", plan: "monthly",
			want: subscriptionUpdateAction{DBStatus: "active", ClearPaidRoles: true, AssignTier: tierUplink},
		},
		{
			// Documents current behavior: an unmapped price ID (e.g. a missing
			// STRIPE_PRICE_* env var) stores plan="unknown" and grants the
			// base paid tier rather than revoking access.
			name:   "active unknown plan falls back to uplink",
			status: "active", plan: "unknown",
			want: subscriptionUpdateAction{DBStatus: "active", ClearPaidRoles: true, AssignTier: tierUplink},
		},
		{
			// Trials get Ultimate access without clearing roles; the
			// plan-appropriate role is assigned when the trial converts.
			name:   "trialing grants ultimate regardless of plan",
			status: "trialing", plan: "monthly",
			want: subscriptionUpdateAction{DBStatus: "trialing", AssignTier: tierUltimate},
		},
		{
			name:   "cancel at period end stores canceling and never touches roles",
			status: "active", cancelAtPeriodEnd: true, plan: "ultimate_monthly",
			want: subscriptionUpdateAction{DBStatus: "canceling"},
		},
		{
			name:   "canceling trial stores canceling and never touches roles",
			status: "trialing", cancelAtPeriodEnd: true, plan: "pro_monthly",
			want: subscriptionUpdateAction{DBStatus: "canceling"},
		},
		{
			name:   "past_due keeps roles untouched",
			status: "past_due", plan: "ultimate_monthly",
			want: subscriptionUpdateAction{DBStatus: "past_due"},
		},
		{
			// The first payment may still settle (3-D Secure); Stripe moves
			// it to incomplete_expired if it doesn't.
			name:   "incomplete keeps roles untouched",
			status: "incomplete", plan: "pro_monthly",
			want: subscriptionUpdateAction{DBStatus: "incomplete"},
		},
		// Stripe stopped collecting: no paid access (SCROLLR-443).
		{
			name:   "canceled clears paid roles",
			status: "canceled", plan: "monthly",
			want: subscriptionUpdateAction{DBStatus: "canceled", ClearPaidRoles: true},
		},
		{
			name:   "unpaid clears paid roles",
			status: "unpaid", plan: "ultimate_annual",
			want: subscriptionUpdateAction{DBStatus: "unpaid", ClearPaidRoles: true},
		},
		{
			name:   "incomplete_expired clears paid roles",
			status: "incomplete_expired", plan: "ultimate_monthly",
			want: subscriptionUpdateAction{DBStatus: "incomplete_expired", ClearPaidRoles: true},
		},
		{
			name:   "canceled clears paid roles even with cancel_at_period_end still set",
			status: "canceled", cancelAtPeriodEnd: true, plan: "pro_monthly",
			want: subscriptionUpdateAction{DBStatus: "canceled", ClearPaidRoles: true},
		},
		// Lifetime is permanent Ultimate: subscription events never touch roles.
		{
			name:   "lifetime unpaid keeps roles",
			status: "unpaid", plan: "ultimate_monthly", lifetime: true,
			want: subscriptionUpdateAction{DBStatus: "unpaid"},
		},
		{
			name:   "lifetime canceled keeps roles",
			status: "canceled", plan: "pro_monthly", lifetime: true,
			want: subscriptionUpdateAction{DBStatus: "canceled"},
		},
		{
			name:   "lifetime active never swaps ultimate for the plan tier",
			status: "active", plan: "pro_monthly", lifetime: true,
			want: subscriptionUpdateAction{DBStatus: "active"},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := decideSubscriptionUpdate(tc.status, tc.cancelAtPeriodEnd, tc.plan, tc.lifetime)
			if got != tc.want {
				t.Errorf("decideSubscriptionUpdate(%q, %v, %q, %v) = %+v, want %+v",
					tc.status, tc.cancelAtPeriodEnd, tc.plan, tc.lifetime, got, tc.want)
			}
		})
	}
}

// =============================================================================
// Decision logic — what may grant access (SCROLLR-443)
// =============================================================================

func TestSubscriptionGrantsAccess(t *testing.T) {
	for status, want := range map[string]bool{
		"active": true, "trialing": true,
		"incomplete": false, "incomplete_expired": false, "past_due": false,
		"unpaid": false, "canceled": false, "": false,
	} {
		if got := subscriptionGrantsAccess(status); got != want {
			t.Errorf("subscriptionGrantsAccess(%q) = %v, want %v", status, got, want)
		}
	}
}

func TestCheckoutPaid(t *testing.T) {
	for status, want := range map[string]bool{
		"paid": true, "no_payment_required": true, "unpaid": false, "": false,
	} {
		if got := checkoutPaid(status); got != want {
			t.Errorf("checkoutPaid(%q) = %v, want %v", status, got, want)
		}
	}
}

func TestIsStaleSubscription(t *testing.T) {
	str := func(s string) *string { return &s }
	tests := []struct {
		name   string
		stored *string
		event  string
		want   bool
	}{
		{"same subscription", str("sub_a"), "sub_a", false},
		{"other subscription", str("sub_b"), "sub_a", true},
		{"nothing stored", nil, "sub_a", false},
		{"empty stored", str(""), "sub_a", false},
	}
	for _, tc := range tests {
		if got := isStaleSubscription(tc.stored, tc.event); got != tc.want {
			t.Errorf("%s: isStaleSubscription = %v, want %v", tc.name, got, tc.want)
		}
	}
}

func TestHadSubscription(t *testing.T) {
	str := func(s string) *string { return &s }
	tests := []struct {
		name   string
		plan   string
		status string
		subID  *string
		want   bool
	}{
		// The row getOrCreateStripeCustomer writes before any subscription.
		{"never subscribed", "free", "active", nil, false},
		{"current subscription", "monthly", "active", str("sub_1"), true},
		{"trialing", "ultimate_monthly", "trialing", str("sub_1"), true},
		{"lifetime", "lifetime", "active", nil, true},
		// Reset by subscription.deleted or the trial cancel: still a prior
		// subscriber, so no second trial.
		{"canceled and reset to free", "free", "canceled", nil, true},
		// Reset by the HandleGetSubscription self-heal.
		{"self-healed to none", "free", "none", nil, true},
		{"free with a subscription id", "free", "active", str("sub_1"), true},
	}
	for _, tc := range tests {
		if got := hadSubscription(tc.plan, tc.status, tc.subID); got != tc.want {
			t.Errorf("%s: hadSubscription(%q, %q) = %v, want %v", tc.name, tc.plan, tc.status, got, tc.want)
		}
	}
}

// =============================================================================
// Decision logic — decideStripPaidRoles
// =============================================================================

func TestDecideStripPaidRoles(t *testing.T) {
	tests := []struct {
		name       string
		isLifetime bool
		lookupErr  error
		want       bool
	}{
		// Clean lookup: lifetime flag decides.
		{"not lifetime strips roles", false, nil, true},
		{"lifetime keeps roles", true, nil, false},
		// No customer row is a definitive "no lifetime flag" — strip as usual.
		{"no rows strips roles", false, pgx.ErrNoRows, true},
		{"wrapped no rows strips roles", false, fmt.Errorf("scan: %w", pgx.ErrNoRows), true},
		// Any other lookup failure fails safe: never strip roles when we
		// can't tell whether the customer is lifetime.
		{"lookup failure keeps roles", false, errors.New("connection refused"), false},
		{"lookup failure keeps roles even if scan defaulted true", true, errors.New("timeout"), false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := decideStripPaidRoles(tc.isLifetime, tc.lookupErr)
			if got != tc.want {
				t.Errorf("decideStripPaidRoles(%v, %v) = %v, want %v", tc.isLifetime, tc.lookupErr, got, tc.want)
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
	return testsupport.NewWebhookTestApp(HandleStripeWebhook)
}

// unhandledEvent is a minimal valid Stripe event of a type the handler
// ignores, so the dispatch path runs without touching the database or Logto.
const unhandledEvent = `{"id":"evt_test_1","object":"event","type":"product.created","data":{"object":{}}}`

func TestHandleStripeWebhookMissingSecret(t *testing.T) {
	t.Setenv("STRIPE_WEBHOOK_SECRET", "")

	app := newWebhookTestApp()
	status := testsupport.PostWebhook(t, app, []byte(unhandledEvent), "")
	if status != fiber.StatusInternalServerError {
		t.Errorf("missing webhook secret: status = %d, want %d", status, fiber.StatusInternalServerError)
	}
}

func TestHandleStripeWebhookRejectsMissingSignature(t *testing.T) {
	t.Setenv("STRIPE_WEBHOOK_SECRET", "whsec_test_secret")

	app := newWebhookTestApp()
	status := testsupport.PostWebhook(t, app, []byte(unhandledEvent), "")
	if status != fiber.StatusBadRequest {
		t.Errorf("missing signature: status = %d, want %d", status, fiber.StatusBadRequest)
	}
}

func TestHandleStripeWebhookRejectsWrongSecret(t *testing.T) {
	t.Setenv("STRIPE_WEBHOOK_SECRET", "whsec_test_secret")

	app := newWebhookTestApp()
	payload := []byte(unhandledEvent)
	sig := testsupport.SignStripePayload(t, payload, "whsec_wrong_secret", time.Now())
	status := testsupport.PostWebhook(t, app, payload, sig)
	if status != fiber.StatusBadRequest {
		t.Errorf("wrong secret: status = %d, want %d", status, fiber.StatusBadRequest)
	}
}

func TestHandleStripeWebhookRejectsTamperedPayload(t *testing.T) {
	t.Setenv("STRIPE_WEBHOOK_SECRET", "whsec_test_secret")

	app := newWebhookTestApp()
	sig := testsupport.SignStripePayload(t, []byte(unhandledEvent), "whsec_test_secret", time.Now())
	tampered := []byte(`{"id":"evt_evil","object":"event","type":"product.created","data":{"object":{}}}`)
	status := testsupport.PostWebhook(t, app, tampered, sig)
	if status != fiber.StatusBadRequest {
		t.Errorf("tampered payload: status = %d, want %d", status, fiber.StatusBadRequest)
	}
}

func TestHandleStripeWebhookRejectsExpiredTimestamp(t *testing.T) {
	t.Setenv("STRIPE_WEBHOOK_SECRET", "whsec_test_secret")

	app := newWebhookTestApp()
	payload := []byte(unhandledEvent)
	// Signed well outside StripeWebhookTolerance (300s).
	stale := time.Now().Add(-2 * platform.StripeWebhookTolerance * time.Second)
	sig := testsupport.SignStripePayload(t, payload, "whsec_test_secret", stale)
	status := testsupport.PostWebhook(t, app, payload, sig)
	if status != fiber.StatusBadRequest {
		t.Errorf("expired timestamp: status = %d, want %d", status, fiber.StatusBadRequest)
	}
}

func TestHandleStripeWebhookAcceptsValidSignature(t *testing.T) {
	t.Setenv("STRIPE_WEBHOOK_SECRET", "whsec_test_secret")

	app := newWebhookTestApp()
	payload := []byte(unhandledEvent)
	sig := testsupport.SignStripePayload(t, payload, "whsec_test_secret", time.Now())
	status := testsupport.PostWebhook(t, app, payload, sig)
	if status != fiber.StatusOK {
		t.Errorf("valid signature: status = %d, want %d", status, fiber.StatusOK)
	}
}
