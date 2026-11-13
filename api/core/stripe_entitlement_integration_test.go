package core

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/accounts"
	"github.com/brandon-relentnet/myscrollr/api/internal/billing"
	"github.com/brandon-relentnet/myscrollr/api/internal/testsupport"
	"github.com/gofiber/fiber/v2"
)

// =============================================================================
// Paid access only for paid subscriptions (SCROLLR-443) and retryable
// webhook processing (SCROLLR-381) — integration tests
// =============================================================================

const entitlementWebhookSecret = "whsec_test_secret"

// postSignedEvent delivers a signed event through the real webhook endpoint.
func postSignedEvent(t *testing.T, app *fiber.App, payload string) int {
	t.Helper()
	sig := testsupport.SignStripePayload(t, []byte(payload), entitlementWebhookSecret, time.Now())
	return testsupport.PostWebhook(t, app, []byte(payload), sig)
}

// asUser mounts a handler behind a stand-in for LogtoAuth.
func asUser(method, path, sub string, h fiber.Handler) *fiber.App {
	app := fiber.New()
	app.Add(method, path, func(c *fiber.Ctx) error {
		c.Locals("user_id", sub)
		return c.Next()
	}, h)
	return app
}

func TestIntegrationCheckoutCompletedUnpaidGrantsNothing(t *testing.T) {
	setupIntegrationDB(t)
	stub := newLogtoStub(t)

	// A delayed payment method (bank debit) completes the session before
	// the money arrives.
	_ = billing.HandleCheckoutCompleted(stripeEvent("checkout.session.completed", `{
		"id": "cs_unpaid_1", "object": "checkout.session", "mode": "payment",
		"payment_status": "unpaid", "customer": "cus_unpaid_1",
		"metadata": {"logto_sub": "user_unpaid", "plan": "lifetime"}
	}`))

	if n := queryCount(t, `SELECT count(*) FROM stripe_customers WHERE logto_sub = $1`, "user_unpaid"); n != 0 {
		t.Errorf("stripe_customers rows for unpaid checkout = %d, want 0", n)
	}
	if got := stub.assignedRoles(); len(got) != 0 {
		t.Errorf("assigned roles = %v, want none before the payment settles", got)
	}
}

func TestIntegrationCheckoutAsyncPayment(t *testing.T) {
	setupIntegrationDB(t)
	stub := newLogtoStub(t)
	t.Setenv("STRIPE_WEBHOOK_SECRET", entitlementWebhookSecret)
	app := testsupport.NewWebhookTestApp(billing.HandleStripeWebhook)

	// Failed: nothing granted.
	if status := postSignedEvent(t, app, `{"id":"evt_async_fail","object":"event","type":"checkout.session.async_payment_failed",
		"data":{"object":{"id":"cs_async_1","object":"checkout.session","mode":"payment","payment_status":"unpaid",
		"customer":"cus_async_1","metadata":{"logto_sub":"user_async_fail","plan":"lifetime"}}}}`); status != 200 {
		t.Fatalf("async_payment_failed: status = %d, want 200", status)
	}
	if n := queryCount(t, `SELECT count(*) FROM stripe_customers WHERE logto_sub = $1`, "user_async_fail"); n != 0 {
		t.Errorf("rows after async failure = %d, want 0", n)
	}
	if got := stub.assignedRoles(); len(got) != 0 {
		t.Errorf("assigned roles after async failure = %v, want none", got)
	}

	// Succeeded: granted.
	if status := postSignedEvent(t, app, `{"id":"evt_async_ok","object":"event","type":"checkout.session.async_payment_succeeded",
		"data":{"object":{"id":"cs_async_2","object":"checkout.session","mode":"payment","payment_status":"paid",
		"customer":"cus_async_2","metadata":{"logto_sub":"user_async_ok","plan":"lifetime"}}}}`); status != 200 {
		t.Fatalf("async_payment_succeeded: status = %d, want 200", status)
	}
	if row := readStripeCustomer(t, "user_async_ok"); !row.Lifetime || row.Status != "active" {
		t.Errorf("row after async success = %+v, want lifetime active", row)
	}
	if got := stub.assignedRoles(); len(got) != 1 || got[0] != "user_async_ok:"+stubRoleUltimate {
		t.Errorf("assigned roles = %v, want [user_async_ok:%s]", got, stubRoleUltimate)
	}
}

func TestIntegrationWebhookFailedHandlerIsRetried(t *testing.T) {
	setupIntegrationDB(t)
	newLogtoStub(t)
	t.Setenv("STRIPE_WEBHOOK_SECRET", entitlementWebhookSecret)
	app := testsupport.NewWebhookTestApp(billing.HandleStripeWebhook)
	const event = `{"id":"evt_retry_1","object":"event","type":"checkout.session.completed",
		"data":{"object":{"id":"cs_retry_1","object":"checkout.session","mode":"payment","payment_status":"paid",
		"customer":"cus_retry_1","metadata":{"logto_sub":"user_retry","plan":"lifetime"}}}}`

	// Logto is down: the role can't be assigned.
	down := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	down.Close()
	t.Setenv("LOGTO_ENDPOINT", down.URL)
	accounts.ResetM2MTokenCache()

	if status := postSignedEvent(t, app, event); status != fiber.StatusInternalServerError {
		t.Fatalf("delivery with Logto down: status = %d, want 500 so Stripe retries", status)
	}
	if n := queryCount(t, `SELECT count(*) FROM stripe_webhook_events WHERE event_id = $1`, "evt_retry_1"); n != 0 {
		t.Errorf("idempotency rows after failed handler = %d, want 0 (claim released)", n)
	}

	// Logto is back: Stripe's retry is processed, not skipped as a duplicate.
	stub := newLogtoStub(t)
	if status := postSignedEvent(t, app, event); status != 200 {
		t.Fatalf("retry: status = %d, want 200", status)
	}
	if got := stub.assignedRoles(); len(got) != 1 || got[0] != "user_retry:"+stubRoleUltimate {
		t.Errorf("assigned roles on retry = %v, want [user_retry:%s]", got, stubRoleUltimate)
	}

	// A further delivery of the handled event is a 200 no-op.
	if status := postSignedEvent(t, app, event); status != 200 {
		t.Fatalf("duplicate: status = %d, want 200", status)
	}
	if got := stub.assignedRoles(); len(got) != 1 {
		t.Errorf("assigned roles after duplicate = %v, want the retry's one only", got)
	}
}

func TestIntegrationSubscriptionDeletedIgnoresOtherSubscription(t *testing.T) {
	setupIntegrationDB(t)
	stub := newLogtoStub(t)
	const sub = "user_del_stale"
	seedStripeCustomer(t, sub, "cus_del_stale", "ultimate_monthly", "active", false)
	testsupport.MustExec(t, `UPDATE stripe_customers SET stripe_subscription_id = 'sub_current' WHERE logto_sub = $1`, sub)

	_ = billing.HandleSubscriptionDeleted(stripeEvent("customer.subscription.deleted", `{
		"id": "sub_old", "object": "subscription", "customer": "cus_del_stale"
	}`))

	row := readStripeCustomer(t, sub)
	if row.Plan != "ultimate_monthly" || row.Status != "active" || row.SubscriptionID == nil || *row.SubscriptionID != "sub_current" {
		t.Errorf("row after another subscription's deletion = %+v, want untouched", row)
	}
	if got := stub.removedRoles(); len(got) != 0 {
		t.Errorf("removed roles = %v, want none", got)
	}
}

func TestIntegrationSubscriptionUpdatedUnpaidRemovesAccess(t *testing.T) {
	setupIntegrationDB(t)
	stub := newLogtoStub(t)
	setStripePriceEnv(t)
	const sub = "user_unpaid_upd"
	seedStripeCustomer(t, sub, "cus_unpaid_upd", "pro_monthly", "past_due", false)
	testsupport.MustExec(t, `UPDATE stripe_customers SET stripe_subscription_id = 'sub_unpaid' WHERE logto_sub = $1`, sub)

	// An update about some other subscription changes nothing.
	_ = deliverSubscriptionUpdate(t, `{
		"id": "sub_other", "object": "subscription", "status": "canceled",
		"cancel_at_period_end": false, "customer": "cus_unpaid_upd",
		"items": {"object": "list", "data": [{"id": "si_1", "object": "subscription_item",
			"current_period_end": 1781136000, "price": {"id": "price_monthly_t", "object": "price"}}]}
	}`)
	if row := readStripeCustomer(t, sub); row.Status != "past_due" || row.Plan != "pro_monthly" {
		t.Errorf("row after another subscription's update = %+v, want untouched", row)
	}
	if got := stub.removedRoles(); len(got) != 0 {
		t.Fatalf("removed roles after another subscription's update = %v, want none", got)
	}

	// The stored subscription going unpaid ends paid access.
	_ = deliverSubscriptionUpdate(t, `{
		"id": "sub_unpaid", "object": "subscription", "status": "unpaid",
		"cancel_at_period_end": false, "customer": "cus_unpaid_upd",
		"items": {"object": "list", "data": [{"id": "si_1", "object": "subscription_item",
			"current_period_end": 1781136000, "price": {"id": "price_pro_monthly_t", "object": "price"}}]}
	}`)
	if row := readStripeCustomer(t, sub); row.Status != "unpaid" {
		t.Errorf("status = %q, want unpaid", row.Status)
	}
	if got := stub.removedRoles(); len(got) != 3 {
		t.Errorf("removed roles = %v, want all three paid roles", got)
	}
	if got := stub.assignedRoles(); len(got) != 0 {
		t.Errorf("assigned roles = %v, want none", got)
	}
}

func TestIntegrationFailedFirstInvoiceKeepsPriorSubscriber(t *testing.T) {
	setupIntegrationDB(t)
	stub := newLogtoStub(t)
	const sub = "user_free_invoice"
	seedStripeCustomer(t, sub, "cus_free_invoice", "free", "canceled", false)

	_ = billing.HandleInvoicePaymentFailed(stripeEvent("invoice.payment_failed", `{
		"customer": "cus_free_invoice", "subscription": "sub_declined", "attempt_count": 1
	}`))
	if row := readStripeCustomer(t, sub); row.Status != "canceled" {
		t.Errorf("status after a free row's failed invoice = %q, want canceled (trial eligibility mark kept)", row.Status)
	}

	_ = billing.HandleInvoicePaid(stripeEvent("invoice.paid", `{
		"customer": "cus_free_invoice", "subscription": "sub_other"
	}`))
	if got := stub.assignedRoles(); len(got) != 0 {
		t.Errorf("assigned roles for a paid invoice on the free plan = %v, want none", got)
	}
}

func TestIntegrationCanceledCustomerGetsNoSecondTrial(t *testing.T) {
	setupIntegrationDB(t)
	const sub = "user_trial_again"
	// What subscription.deleted leaves behind.
	seedStripeCustomer(t, sub, "cus_trial_again", "free", "canceled", false)

	app := asUser(fiber.MethodGet, "/users/me/subscription", sub, billing.HandleGetSubscription)
	resp, err := app.Test(httptest.NewRequest(fiber.MethodGet, "/users/me/subscription", nil), -1)
	if err != nil {
		t.Fatalf("GET subscription: %v", err)
	}
	var body struct {
		HadPriorSub bool `json:"had_prior_sub"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !body.HadPriorSub {
		t.Error("had_prior_sub = false for a canceled customer, want true (no second trial)")
	}
}

// subscribeStripeStub fakes the Stripe calls /checkout/subscribe makes and
// creates subscriptions with the given status.
type subscribeStripeStub struct {
	mu             sync.Mutex
	idempotencyKey string
	trialRequested bool
	canceled       []string
	created        int
}

func newSubscribeStripeStub(t *testing.T, logtoSub, subStatus string) *subscribeStripeStub {
	s := &subscribeStripeStub{}
	stubStripeAPI(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/v1/setup_intents/"):
			_, _ = w.Write([]byte(`{"id":"` + strings.TrimPrefix(r.URL.Path, "/v1/setup_intents/") + `","object":"setup_intent","status":"succeeded",
				"payment_method":"pm_1","customer":"cus_subscribe","metadata":{"logto_sub":"` + logtoSub + `"}}`))
		case r.URL.Path == "/v1/payment_methods/pm_1/attach":
			_, _ = w.Write([]byte(`{"id":"pm_1","object":"payment_method"}`))
		case r.URL.Path == "/v1/customers/cus_subscribe":
			_, _ = w.Write([]byte(`{"id":"cus_subscribe","object":"customer"}`))
		case r.Method == http.MethodPost && r.URL.Path == "/v1/subscriptions":
			form, _ := io.ReadAll(r.Body)
			s.mu.Lock()
			s.idempotencyKey = r.Header.Get("Idempotency-Key")
			s.trialRequested = strings.Contains(string(form), "trial_period_days")
			s.created++
			s.mu.Unlock()
			time.Sleep(100 * time.Millisecond) // widen the window a second tab could race through
			_, _ = w.Write([]byte(`{"id":"sub_new","object":"subscription","status":"` + subStatus + `"}`))
		case r.Method == http.MethodDelete && strings.HasPrefix(r.URL.Path, "/v1/subscriptions/"):
			s.mu.Lock()
			s.canceled = append(s.canceled, strings.TrimPrefix(r.URL.Path, "/v1/subscriptions/"))
			s.mu.Unlock()
			_, _ = w.Write([]byte(`{"id":"sub_new","object":"subscription","status":"canceled"}`))
		default:
			t.Errorf("unexpected Stripe call %s %s", r.Method, r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	})
	return s
}

func postSubscribe(t *testing.T, sub string) (int, string) {
	return postSubscribeWith(t, sub, "seti_1")
}

func postSubscribeWith(t *testing.T, sub, setupIntentID string) (int, string) {
	t.Helper()
	app := asUser(fiber.MethodPost, "/checkout/subscribe", sub, billing.HandleConfirmSubscription)
	req := httptest.NewRequest(fiber.MethodPost, "/checkout/subscribe",
		strings.NewReader(`{"setup_intent_id":"`+setupIntentID+`","price_id":"price_ultimate_monthly_t"}`))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req, -1)
	if err != nil {
		t.Fatalf("POST /checkout/subscribe: %v", err)
	}
	body, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, string(body)
}

func TestIntegrationSubscribeIncompleteGrantsNothing(t *testing.T) {
	setupIntegrationDB(t)
	logto := newLogtoStub(t)
	setStripePriceEnv(t)
	const sub = "user_sub_declined"
	// A returning customer: no trial, so the first charge happens now.
	seedStripeCustomer(t, sub, "cus_subscribe", "free", "canceled", false)
	stripeStub := newSubscribeStripeStub(t, sub, "incomplete")

	status, body := postSubscribe(t, sub)
	if status != fiber.StatusPaymentRequired {
		t.Fatalf("status = %d (%s), want 402", status, body)
	}
	if !strings.Contains(body, `"error":"Your payment did not go through`) {
		t.Errorf("body = %s, want the payment-failed message in the error field the website shows", body)
	}
	if len(stripeStub.canceled) != 1 || stripeStub.canceled[0] != "sub_new" {
		t.Errorf("canceled at Stripe = %v, want [sub_new]", stripeStub.canceled)
	}
	if stripeStub.trialRequested {
		t.Error("a returning customer was offered a trial")
	}
	if got := logto.assignedRoles(); len(got) != 0 {
		t.Errorf("assigned roles = %v, want none for an unpaid subscription", got)
	}
	row := readStripeCustomer(t, sub)
	if row.Plan != "free" || row.Status != "canceled" || row.SubscriptionID != nil {
		t.Errorf("row = %+v, want untouched free/canceled", row)
	}
}

func TestIntegrationSubscribeActiveGrantsWithIdempotencyKey(t *testing.T) {
	setupIntegrationDB(t)
	logto := newLogtoStub(t)
	setStripePriceEnv(t)
	const sub = "user_sub_paid"
	seedStripeCustomer(t, sub, "cus_subscribe", "free", "canceled", false)
	stripeStub := newSubscribeStripeStub(t, sub, "active")

	status, body := postSubscribe(t, sub)
	if status != fiber.StatusOK {
		t.Fatalf("status = %d (%s), want 200", status, body)
	}
	if stripeStub.idempotencyKey != "subscribe-seti_1-price_ultimate_monthly_t" {
		t.Errorf("Idempotency-Key = %q, want subscribe-seti_1-price_ultimate_monthly_t", stripeStub.idempotencyKey)
	}
	if len(stripeStub.canceled) != 0 {
		t.Errorf("canceled at Stripe = %v, want none", stripeStub.canceled)
	}
	if got := logto.assignedRoles(); len(got) != 1 || got[0] != sub+":"+stubRoleUltimate {
		t.Errorf("assigned roles = %v, want [%s:%s]", got, sub, stubRoleUltimate)
	}
	row := readStripeCustomer(t, sub)
	if row.Plan != "ultimate_monthly" || row.Status != "active" || row.SubscriptionID == nil || *row.SubscriptionID != "sub_new" {
		t.Errorf("row = %+v, want ultimate_monthly active sub_new", row)
	}
}

func TestIntegrationPurchaseRefusedWhileDeletionPending(t *testing.T) {
	setupIntegrationDB(t)
	const pendingSub, otherSub = "user_buy_pending", "user_buy_free"
	testsupport.MustExec(t, `INSERT INTO user_deletion_requests (logto_sub, requested_at, purge_at, status)
		VALUES ($1, now(), now() + interval '30 days', 'pending'), ($2, now(), now() + interval '30 days', 'canceled')`,
		pendingSub, otherSub)

	for _, tc := range []struct {
		sub        string
		wantStatus int
	}{{pendingSub, fiber.StatusConflict}, {otherSub, fiber.StatusOK}} {
		app := fiber.New()
		app.Post("/checkout/subscribe", func(c *fiber.Ctx) error {
			c.Locals("user_id", tc.sub)
			return c.Next()
		}, billing.RefuseWhileDeletionPending, func(c *fiber.Ctx) error { return c.SendStatus(fiber.StatusOK) })
		resp, err := app.Test(httptest.NewRequest(fiber.MethodPost, "/checkout/subscribe", nil), -1)
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(resp.Body)
		if resp.StatusCode != tc.wantStatus {
			t.Errorf("%s: status = %d (%s), want %d", tc.sub, resp.StatusCode, body, tc.wantStatus)
		}
		if tc.wantStatus == fiber.StatusConflict && !strings.Contains(string(body), `"error":"Your account is scheduled for deletion. Cancel the deletion`) {
			t.Errorf("body = %s, want the cancel-the-deletion message", body)
		}
	}
}

// SCROLLR-465 B2-2: an active update retried after the subscription was
// deleted must not re-grant access; the handler asks Stripe what is true now.
func TestIntegrationLateActiveUpdateAfterDeletionGrantsNothing(t *testing.T) {
	setupIntegrationDB(t)
	logto := newLogtoStub(t)
	setStripePriceEnv(t)
	const sub = "user_late_update"
	// What subscription.deleted leaves behind.
	seedStripeCustomer(t, sub, "cus_late_update", "free", "canceled", false)
	const event = `{"id": "sub_late", "object": "subscription", "status": "active",
		"cancel_at_period_end": false, "customer": "cus_late_update",
		"items": {"object": "list", "data": [{"id": "si_1", "object": "subscription_item",
			"current_period_end": 1781136000, "price": {"id": "price_ultimate_monthly_t", "object": "price"}}]}}`

	serveSubscription(t, `{"id": "sub_late", "object": "subscription", "status": "canceled", "customer": "cus_late_update"}`)
	if err := billing.HandleSubscriptionUpdated(stripeEvent("customer.subscription.updated", event)); err != nil {
		t.Fatalf("handler: %v", err)
	}
	if got := logto.assignedRoles(); len(got) != 0 {
		t.Errorf("assigned roles = %v, want none for a subscription Stripe says has ended", got)
	}
	if row := readStripeCustomer(t, sub); row.Plan != "free" || row.Status != "canceled" || row.SubscriptionID != nil {
		t.Errorf("row = %+v, want untouched free/canceled", row)
	}

	// Stripe unreachable: the event fails so Stripe retries it, and nothing changes.
	stubStripeAPI(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":{"type":"invalid_request_error","message":"down"}}`))
	})
	if err := billing.HandleSubscriptionUpdated(stripeEvent("customer.subscription.updated", event)); err == nil {
		t.Error("handler succeeded although Stripe could not be asked")
	}
	if got := logto.assignedRoles(); len(got) != 0 {
		t.Errorf("assigned roles = %v, want none", got)
	}

	// Stripe has no such subscription at all: acknowledged (no retry can
	// succeed), and nothing changes.
	stubStripeAPI(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"error":{"type":"invalid_request_error","code":"resource_missing","message":"No such subscription"}}`))
	})
	if err := billing.HandleSubscriptionUpdated(stripeEvent("customer.subscription.updated", event)); err != nil {
		t.Errorf("handler = %v for a subscription Stripe does not have, want nil so Stripe stops retrying", err)
	}
	if got := logto.assignedRoles(); len(got) != 0 {
		t.Errorf("assigned roles = %v, want none", got)
	}
	if row := readStripeCustomer(t, sub); row.Plan != "free" || row.Status != "canceled" || row.SubscriptionID != nil {
		t.Errorf("row = %+v, want untouched free/canceled", row)
	}
}

// SCROLLR-465 B2-3: only a customer Stripe says is gone is replaced; any other
// Stripe error fails the request and keeps the billing row.
func TestIntegrationStripeCustomerReplacedOnlyWhenMissing(t *testing.T) {
	for _, missing := range []bool{false, true} {
		t.Run(map[bool]string{false: "stripe error", true: "customer missing"}[missing], func(t *testing.T) {
			setupIntegrationDB(t)
			setStripePriceEnv(t)
			const sub = "user_customer_check"
			seedStripeCustomer(t, sub, "cus_kept", "free", "canceled", false)
			stubStripeAPI(t, func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				switch {
				case r.Method == http.MethodGet && r.URL.Path == "/v1/customers/cus_kept" && missing:
					w.WriteHeader(http.StatusNotFound)
					_, _ = w.Write([]byte(`{"error":{"type":"invalid_request_error","code":"resource_missing","message":"No such customer"}}`))
				case r.Method == http.MethodGet && r.URL.Path == "/v1/customers/cus_kept":
					w.Header().Set("Stripe-Should-Retry", "false")
					w.WriteHeader(http.StatusServiceUnavailable)
					_, _ = w.Write([]byte(`{"error":{"type":"api_error","message":"timeout"}}`))
				case r.Method == http.MethodPost && r.URL.Path == "/v1/customers":
					if !missing {
						t.Error("a new customer was created after a transient error")
					}
					_, _ = w.Write([]byte(`{"id":"cus_new","object":"customer"}`))
				default:
					// Stop the handler after the customer step.
					w.WriteHeader(http.StatusBadRequest)
					_, _ = w.Write([]byte(`{"error":{"type":"invalid_request_error","message":"stop"}}`))
				}
			})

			app := asUser(fiber.MethodPost, "/checkout/setup-intent", sub, billing.HandleCreateSetupIntent)
			req := httptest.NewRequest(fiber.MethodPost, "/checkout/setup-intent", strings.NewReader(`{"price_id":"price_ultimate_monthly_t"}`))
			req.Header.Set("Content-Type", "application/json")
			resp, err := app.Test(req, -1)
			if err != nil {
				t.Fatal(err)
			}
			if resp.StatusCode != fiber.StatusInternalServerError {
				t.Errorf("status = %d, want 500", resp.StatusCode)
			}
			row := readStripeCustomer(t, sub)
			if missing {
				if row.CustomerID != "cus_new" {
					t.Errorf("customer = %q, want the replacement cus_new", row.CustomerID)
				}
				return
			}
			if row.CustomerID != "cus_kept" || row.Status != "canceled" {
				t.Errorf("row = %+v, want cus_kept/canceled untouched", row)
			}
		})
	}
}

// SCROLLR-465 B2-4: two tabs, each with its own SetupIntent, subscribe at the
// same time. One subscription is created; the other tab gets the conflict.
func TestIntegrationConcurrentSubscribesCreateOne(t *testing.T) {
	setupIntegrationDB(t)
	newLogtoStub(t)
	setStripePriceEnv(t)
	const sub = "user_two_tabs"
	seedStripeCustomer(t, sub, "cus_subscribe", "free", "canceled", false)
	stripeStub := newSubscribeStripeStub(t, sub, "active")

	var wg sync.WaitGroup
	statuses := make([]int, 2)
	for i, seti := range []string{"seti_tab1", "seti_tab2"} {
		wg.Add(1)
		go func() {
			defer wg.Done()
			statuses[i], _ = postSubscribeWith(t, sub, seti)
		}()
	}
	wg.Wait()

	if stripeStub.created != 1 {
		t.Errorf("subscriptions created at Stripe = %d, want 1", stripeStub.created)
	}
	ok, conflict := 0, 0
	for _, st := range statuses {
		switch st {
		case fiber.StatusOK:
			ok++
		case fiber.StatusConflict:
			conflict++
		}
	}
	if ok != 1 || conflict != 1 {
		t.Errorf("statuses = %v, want one 200 and one 409", statuses)
	}
}
