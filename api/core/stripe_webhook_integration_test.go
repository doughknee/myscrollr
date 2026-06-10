package core

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stripe/stripe-go/v82"
)

// =============================================================================
// Stripe webhook handlers — integration tests (DB write paths)
// =============================================================================
//
// These exercise the webhook handlers' real SQL against the test database
// (see TestMain in main_test.go). Logto is stubbed via newLogtoStub; where
// a handler calls back into the Stripe API, the SDK is redirected to a
// local stub server — the same mechanism as initStripe's STRIPE_API_URL
// hook for stripe-mock.

// stripeEvent builds an event the way the webhook dispatcher hands it to
// the per-type handlers: type + raw JSON payload.
func stripeEvent(eventType, raw string) stripe.Event {
	return stripe.Event{
		Type: stripe.EventType(eventType),
		Data: &stripe.EventData{Raw: json.RawMessage(raw)},
	}
}

// stubStripeAPI redirects the Stripe SDK to a local handler for the
// duration of the test.
func stubStripeAPI(t *testing.T, handler http.HandlerFunc) {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	prevBackend := stripe.GetBackend(stripe.APIBackend)
	prevKey := stripe.Key
	stripe.Key = "sk_test_stub"
	stripe.SetBackend(stripe.APIBackend, stripe.GetBackendWithConfig(
		stripe.APIBackend,
		&stripe.BackendConfig{URL: stripe.String(server.URL)},
	))
	t.Cleanup(func() {
		stripe.SetBackend(stripe.APIBackend, prevBackend)
		stripe.Key = prevKey
	})
}

// setStripePriceEnv configures the price-ID → plan mapping used by
// planFromPriceID.
func setStripePriceEnv(t *testing.T) {
	t.Helper()
	t.Setenv("STRIPE_PRICE_MONTHLY", "price_monthly_t")
	t.Setenv("STRIPE_PRICE_ANNUAL", "price_annual_t")
	t.Setenv("STRIPE_PRICE_LIFETIME", "price_lifetime_t")
	t.Setenv("STRIPE_PRICE_PRO_MONTHLY", "price_pro_monthly_t")
	t.Setenv("STRIPE_PRICE_PRO_ANNUAL", "price_pro_annual_t")
	t.Setenv("STRIPE_PRICE_ULTIMATE_MONTHLY", "price_ultimate_monthly_t")
	t.Setenv("STRIPE_PRICE_ULTIMATE_ANNUAL", "price_ultimate_annual_t")
}

type stripeCustomerRow struct {
	CustomerID     string
	SubscriptionID *string
	Plan           string
	Status         string
	CurrentPeriod  *time.Time
	Lifetime       bool
}

func readStripeCustomer(t *testing.T, sub string) stripeCustomerRow {
	t.Helper()
	var row stripeCustomerRow
	err := DBPool.QueryRow(context.Background(),
		`SELECT stripe_customer_id, stripe_subscription_id, plan, status,
		        current_period_end, lifetime
		   FROM stripe_customers WHERE logto_sub = $1`, sub,
	).Scan(&row.CustomerID, &row.SubscriptionID, &row.Plan, &row.Status,
		&row.CurrentPeriod, &row.Lifetime)
	if err != nil {
		t.Fatalf("read stripe_customers for %s: %v", sub, err)
	}
	return row
}

func seedStripeCustomer(t *testing.T, sub, customerID, plan, status string, lifetime bool) {
	t.Helper()
	mustExec(t, `INSERT INTO stripe_customers
	             (logto_sub, stripe_customer_id, plan, status, lifetime)
	             VALUES ($1, $2, $3, $4, $5)`,
		sub, customerID, plan, status, lifetime)
}

func TestIntegrationCheckoutCompletedLifetime(t *testing.T) {
	setupIntegrationDB(t)
	stub := newLogtoStub(t)

	handleCheckoutCompleted(stripeEvent("checkout.session.completed", `{
		"id": "cs_life_1", "object": "checkout.session", "mode": "payment",
		"customer": "cus_life_1",
		"metadata": {"logto_sub": "user_hook_life", "plan": "lifetime"}
	}`))

	row := readStripeCustomer(t, "user_hook_life")
	if row.Plan != "lifetime" || row.Status != "active" || !row.Lifetime {
		t.Errorf("lifetime checkout row = %+v, want plan=lifetime status=active lifetime=true", row)
	}
	if row.CustomerID != "cus_life_1" {
		t.Errorf("customer id = %q, want cus_life_1", row.CustomerID)
	}
	if got := stub.assignedRoles(); len(got) != 1 || got[0] != "user_hook_life:"+stubRoleUltimate {
		t.Errorf("assigned roles = %v, want [user_hook_life:%s]", got, stubRoleUltimate)
	}
}

func TestIntegrationCheckoutCompletedTrialGrantsUltimate(t *testing.T) {
	setupIntegrationDB(t)
	stub := newLogtoStub(t)
	setStripePriceEnv(t)
	// The handler fetches the full subscription to learn its real status
	// (webhook payloads don't expand it). Report a trial in progress.
	stubStripeAPI(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"sub_trial_1","object":"subscription","status":"trialing"}`))
	})

	handleCheckoutCompleted(stripeEvent("checkout.session.completed", `{
		"id": "cs_trial_1", "object": "checkout.session", "mode": "subscription",
		"customer": "cus_trial_1", "subscription": "sub_trial_1",
		"metadata": {"logto_sub": "user_hook_trial", "plan": "monthly"}
	}`))

	row := readStripeCustomer(t, "user_hook_trial")
	if row.Plan != "monthly" || row.Status != "trialing" {
		t.Errorf("trial checkout row = %+v, want plan=monthly status=trialing", row)
	}
	if row.SubscriptionID == nil || *row.SubscriptionID != "sub_trial_1" {
		t.Errorf("subscription id = %v, want sub_trial_1", row.SubscriptionID)
	}
	// Trials always get Ultimate access regardless of the selected plan.
	if got := stub.assignedRoles(); len(got) != 1 || got[0] != "user_hook_trial:"+stubRoleUltimate {
		t.Errorf("assigned roles = %v, want [user_hook_trial:%s]", got, stubRoleUltimate)
	}
}

func TestIntegrationSubscriptionUpdatedPlanChange(t *testing.T) {
	setupIntegrationDB(t)
	stub := newLogtoStub(t)
	setStripePriceEnv(t)
	const sub = "user_hook_up"
	seedStripeCustomer(t, sub, "cus_up_1", "monthly", "active", false)

	periodEnd := int64(1781136000)
	handleSubscriptionUpdated(stripeEvent("customer.subscription.updated", `{
		"id": "sub_up_1", "object": "subscription", "status": "active",
		"cancel_at_period_end": false, "customer": "cus_up_1",
		"items": {"object": "list", "data": [{
			"id": "si_1", "object": "subscription_item",
			"current_period_end": 1781136000,
			"price": {"id": "price_pro_monthly_t", "object": "price"}
		}]}
	}`))

	row := readStripeCustomer(t, sub)
	if row.Plan != "pro_monthly" || row.Status != "active" {
		t.Errorf("row after upgrade = %+v, want plan=pro_monthly status=active", row)
	}
	if row.SubscriptionID == nil || *row.SubscriptionID != "sub_up_1" {
		t.Errorf("subscription id = %v, want sub_up_1", row.SubscriptionID)
	}
	if row.CurrentPeriod == nil || row.CurrentPeriod.Unix() != periodEnd {
		t.Errorf("current_period_end = %v, want unix %d", row.CurrentPeriod, periodEnd)
	}
	// Plan changes clear all paid roles, then assign only the new one.
	removed := stub.removedRoles()
	if len(removed) != 3 {
		t.Errorf("removed roles = %v, want all three paid roles cleared", removed)
	}
	if got := stub.assignedRoles(); len(got) != 1 || got[0] != sub+":"+stubRolePro {
		t.Errorf("assigned roles = %v, want [%s:%s]", got, sub, stubRolePro)
	}
}

func TestIntegrationSubscriptionUpdatedCancelAtPeriodEnd(t *testing.T) {
	setupIntegrationDB(t)
	stub := newLogtoStub(t)
	setStripePriceEnv(t)
	const sub = "user_hook_cancel"
	seedStripeCustomer(t, sub, "cus_cancel_1", "pro_monthly", "active", false)

	handleSubscriptionUpdated(stripeEvent("customer.subscription.updated", `{
		"id": "sub_cancel_1", "object": "subscription", "status": "active",
		"cancel_at_period_end": true, "customer": "cus_cancel_1",
		"items": {"object": "list", "data": [{
			"id": "si_1", "object": "subscription_item",
			"current_period_end": 1781136000,
			"price": {"id": "price_pro_monthly_t", "object": "price"}
		}]}
	}`))

	row := readStripeCustomer(t, sub)
	if row.Status != "canceling" {
		t.Errorf("status = %q, want canceling", row.Status)
	}
	// User keeps access until the period ends — roles must not change.
	if got := stub.assignedRoles(); len(got) != 0 {
		t.Errorf("assigned roles = %v, want none while canceling", got)
	}
	if got := stub.removedRoles(); len(got) != 0 {
		t.Errorf("removed roles = %v, want none while canceling", got)
	}
}

func TestIntegrationSubscriptionDeletedResetsAndPrunes(t *testing.T) {
	setupIntegrationDB(t)
	stub := newLogtoStub(t)
	const sub = "user_hook_del"
	seedStripeCustomer(t, sub, "cus_del_1", "ultimate_monthly", "active", false)
	// Ten tracked symbols — double the free-tier cap of five.
	mustExec(t, `INSERT INTO user_channels (logto_sub, channel_type, enabled, config)
	             VALUES ($1, 'finance', true,
	                     '{"symbols":["A","B","C","D","E","F","G","H","I","J"]}')`, sub)

	handleSubscriptionDeleted(stripeEvent("customer.subscription.deleted", `{
		"id": "sub_del_1", "object": "subscription", "customer": "cus_del_1"
	}`))

	row := readStripeCustomer(t, sub)
	if row.Plan != "free" || row.Status != "canceled" || row.SubscriptionID != nil {
		t.Errorf("row after deletion = %+v, want plan=free status=canceled no subscription", row)
	}
	if got := stub.removedRoles(); len(got) != 3 {
		t.Errorf("removed roles = %v, want all three paid roles cleared", got)
	}

	// The downgrade safety net must trim the config to free-tier caps.
	var configJSON []byte
	if err := DBPool.QueryRow(context.Background(),
		`SELECT config FROM user_channels WHERE logto_sub = $1 AND channel_type = 'finance'`, sub,
	).Scan(&configJSON); err != nil {
		t.Fatalf("read pruned config: %v", err)
	}
	var config struct {
		Symbols []string `json:"symbols"`
	}
	if err := json.Unmarshal(configJSON, &config); err != nil {
		t.Fatalf("unmarshal pruned config: %v", err)
	}
	if len(config.Symbols) != 5 {
		t.Errorf("symbols after prune = %d (%v), want free-tier cap of 5", len(config.Symbols), config.Symbols)
	}
}

func TestIntegrationSubscriptionDeletedLifetimeKeepsAccess(t *testing.T) {
	setupIntegrationDB(t)
	stub := newLogtoStub(t)
	const sub = "user_hook_del_life"
	seedStripeCustomer(t, sub, "cus_del_life_1", "lifetime", "active", true)

	handleSubscriptionDeleted(stripeEvent("customer.subscription.deleted", `{
		"id": "sub_del_life_1", "object": "subscription", "customer": "cus_del_life_1"
	}`))

	row := readStripeCustomer(t, sub)
	if row.Plan != "lifetime" || row.Status != "active" || !row.Lifetime {
		t.Errorf("lifetime row after sub deletion = %+v, want untouched", row)
	}
	if got := stub.removedRoles(); len(got) != 0 {
		t.Errorf("removed roles = %v, want none for lifetime member", got)
	}
}

func TestIntegrationInvoicePaidRecoversPastDue(t *testing.T) {
	setupIntegrationDB(t)
	stub := newLogtoStub(t)
	const sub = "user_hook_paid"
	seedStripeCustomer(t, sub, "cus_paid_1", "monthly", "past_due", false)

	handleInvoicePaid(stripeEvent("invoice.paid", `{
		"customer": "cus_paid_1", "subscription": "sub_paid_1"
	}`))

	row := readStripeCustomer(t, sub)
	if row.Status != "active" {
		t.Errorf("status after invoice.paid = %q, want active", row.Status)
	}
	if got := stub.assignedRoles(); len(got) != 1 || got[0] != sub+":"+stubRoleUplink {
		t.Errorf("assigned roles = %v, want [%s:%s] re-assigned on renewal", got, sub, stubRoleUplink)
	}
}

func TestIntegrationInvoicePaymentFailedMarksPastDue(t *testing.T) {
	setupIntegrationDB(t)
	newLogtoStub(t)
	const sub = "user_hook_fail"
	seedStripeCustomer(t, sub, "cus_fail_1", "monthly", "active", false)
	// Lifetime members are exempt from past_due (one-time payment).
	const lifetimeSub = "user_hook_fail_life"
	seedStripeCustomer(t, lifetimeSub, "cus_fail_life_1", "lifetime", "active", true)

	handleInvoicePaymentFailed(stripeEvent("invoice.payment_failed", `{
		"customer": "cus_fail_1", "subscription": "sub_fail_1", "attempt_count": 2
	}`))
	handleInvoicePaymentFailed(stripeEvent("invoice.payment_failed", `{
		"customer": "cus_fail_life_1", "subscription": "sub_fail_life_1", "attempt_count": 1
	}`))

	if row := readStripeCustomer(t, sub); row.Status != "past_due" {
		t.Errorf("status after payment failure = %q, want past_due", row.Status)
	}
	if row := readStripeCustomer(t, lifetimeSub); row.Status != "active" {
		t.Errorf("lifetime status after payment failure = %q, want active (exempt)", row.Status)
	}
}
