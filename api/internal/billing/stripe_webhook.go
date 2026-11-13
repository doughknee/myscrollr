package billing

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/accounts"
	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/brandon-relentnet/myscrollr/api/internal/widgets"
	"github.com/getsentry/sentry-go"
	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
	"github.com/stripe/stripe-go/v82"
	stripesubscription "github.com/stripe/stripe-go/v82/subscription"
	"github.com/stripe/stripe-go/v82/webhook"
)

// =============================================================================
// Stripe Webhook Handler
// =============================================================================

// HandleStripeWebhook receives Stripe webhook events, verifies signatures,
// and dispatches to the appropriate handler.
func HandleStripeWebhook(c *fiber.Ctx) error {
	webhookSecret := os.Getenv("STRIPE_WEBHOOK_SECRET")
	if webhookSecret == "" {
		log.Println("[Stripe Webhook] STRIPE_WEBHOOK_SECRET not set")
		return c.SendStatus(fiber.StatusInternalServerError)
	}

	payload := c.Body()
	sigHeader := c.Get("Stripe-Signature")

	event, err := webhook.ConstructEventWithOptions(payload, sigHeader, webhookSecret,
		webhook.ConstructEventOptions{
			IgnoreAPIVersionMismatch: true,
			Tolerance:                platform.StripeWebhookTolerance * time.Second,
		})
	if err != nil {
		log.Printf("[Stripe Webhook] Signature verification failed: %v", err)
		return c.SendStatus(fiber.StatusBadRequest)
	}

	// Idempotency: atomically claim the event via INSERT ... ON CONFLICT DO NOTHING
	// RETURNING. If RETURNING yields a row, this worker owns the event and should
	// process it. If it yields no row, another concurrent worker already claimed
	// it — skip to avoid double-processing. This collapses the previous
	// check-then-insert flow (which had a race window between the EXISTS probe
	// and the INSERT) into a single atomic statement.
	if platform.DBPool != nil {
		var claimedID string
		claimErr := platform.DBPool.QueryRow(context.Background(),
			`INSERT INTO stripe_webhook_events (event_id) VALUES ($1)
			 ON CONFLICT (event_id) DO NOTHING
			 RETURNING event_id`,
			event.ID,
		).Scan(&claimedID)
		if claimErr == pgx.ErrNoRows {
			// Another worker already claimed this event. Skip.
			log.Printf("[Stripe Webhook] Skipping duplicate event %s (type: %s)", event.ID, event.Type)
			return c.SendStatus(fiber.StatusOK)
		}
		if claimErr != nil {
			// Some other DB error. Log and proceed — better to double-process than to
			// drop events. The handlers below are all idempotent.
			log.Printf("[Stripe Webhook] Failed to claim event idempotency slot: %v", claimErr)
		}
	}

	var handlerErr error
	switch event.Type {
	case "checkout.session.completed", "checkout.session.async_payment_succeeded":
		// Both carry the session; payment_status decides whether it grants.
		handlerErr = HandleCheckoutCompleted(event)
	case "checkout.session.async_payment_failed":
		// The delayed payment failed. checkout.session.completed granted
		// nothing for it (payment_status was "unpaid"), so there is nothing
		// to take back.
		log.Printf("[Stripe Webhook] Checkout async payment failed (event %s); no access granted", event.ID)
	case "customer.subscription.updated":
		handlerErr = HandleSubscriptionUpdated(event)
	case "customer.subscription.deleted":
		handlerErr = HandleSubscriptionDeleted(event)
	case "invoice.paid":
		handlerErr = HandleInvoicePaid(event)
	case "invoice.payment_failed":
		handlerErr = HandleInvoicePaymentFailed(event)
	case "customer.subscription.trial_will_end":
		handleTrialWillEnd(event)
	case "payment_intent.succeeded":
		handlerErr = handlePaymentIntentSucceeded(event)
	default:
		log.Printf("[Stripe Webhook] Unhandled event type: %s", event.Type)
	}

	// A failed handler releases its claim and answers 5xx, so Stripe
	// retries the event and the retry is not skipped as a duplicate. Every
	// handler is safe to run again.
	// ponytail: a duplicate delivery racing a failing first one gets a 200
	// and Stripe stops retrying; Stripe only redelivers after a failure, so
	// the two rarely overlap.
	if handlerErr != nil {
		log.Printf("[Stripe Webhook] Handling event %s (type: %s) failed, asking Stripe to retry: %v", event.ID, event.Type, handlerErr)
		sentry.CaptureMessage(fmt.Sprintf("stripe webhook: %s handler failed, event released for retry", event.Type))
		if platform.DBPool != nil {
			if _, err := platform.DBPool.Exec(context.Background(),
				`DELETE FROM stripe_webhook_events WHERE event_id = $1`, event.ID,
			); err != nil {
				log.Printf("[Stripe Webhook] Failed to release event %s for retry: %v", event.ID, err)
			}
		}
		return c.SendStatus(fiber.StatusInternalServerError)
	}

	return c.SendStatus(fiber.StatusOK)
}

// HandleCheckoutCompleted processes checkout.session.completed and
// checkout.session.async_payment_succeeded. This is the primary entry point
// for new subscriptions and lifetime purchases made through Checkout. It
// grants only once the session's payment_status says the money arrived.
func HandleCheckoutCompleted(event stripe.Event) error {
	var session stripe.CheckoutSession
	if err := json.Unmarshal(event.Data.Raw, &session); err != nil {
		log.Printf("[Stripe Webhook] Failed to parse %s: %v", event.Type, err)
		return nil
	}

	logtoSub := session.Metadata["logto_sub"]
	plan := session.Metadata["plan"]
	if logtoSub == "" || plan == "" {
		log.Printf("[Stripe Webhook] %s missing metadata (logto_sub=%s, plan=%s)", event.Type, logtoSub, plan)
		return nil
	}

	if !checkoutPaid(string(session.PaymentStatus)) {
		// A delayed payment method (bank debit) has not settled.
		// checkout.session.async_payment_succeeded grants when it does.
		log.Printf("[Stripe Webhook] %s for user=%s plan=%s not paid yet (payment_status=%q); no access granted",
			event.Type, logtoSub, plan, session.PaymentStatus)
		return nil
	}

	customerID := ""
	if session.Customer != nil {
		customerID = session.Customer.ID
	}

	log.Printf("[Stripe Webhook] Checkout completed: user=%s plan=%s mode=%s", logtoSub, plan, session.Mode)

	subStatus := "active" // hoisted — used for role assignment after the if/else

	if plan == "lifetime" {
		// One-time payment — mark as lifetime
		_, err := platform.DBPool.Exec(context.Background(),
			`INSERT INTO stripe_customers (logto_sub, stripe_customer_id, plan, status, lifetime)
			 VALUES ($1, $2, $3, 'active', true)
			 ON CONFLICT (logto_sub) DO UPDATE SET
			   stripe_customer_id = $2, plan = $3, status = 'active',
			   lifetime = true, updated_at = now()`,
			logtoSub, customerID, plan,
		)
		if err != nil {
			return fmt.Errorf("upsert lifetime: %w", err)
		}
	} else {
		// Subscription — fetch the full subscription to get actual status.
		// Webhook payloads don't expand the subscription object, so
		// session.Subscription.Status is always empty. We must call the
		// Stripe API to get the real status (e.g. "trialing" vs "active").
		// If Stripe can't be reached, retry the event rather than guess.
		subID := ""
		if session.Subscription != nil {
			subID = session.Subscription.ID
			fullSub, err := stripesubscription.Get(subID, nil)
			if err != nil {
				return fmt.Errorf("fetch subscription %s: %w", subID, err)
			}
			subStatus = string(fullSub.Status)
		}
		if !subscriptionGrantsAccess(subStatus) {
			log.Printf("[Stripe Webhook] Checkout subscription %s for user=%s is %s; no access granted", subID, logtoSub, subStatus)
			return nil
		}

		_, err := platform.DBPool.Exec(context.Background(),
			`INSERT INTO stripe_customers (logto_sub, stripe_customer_id, stripe_subscription_id, plan, status)
			 VALUES ($1, $2, $3, $4, $5)
			 ON CONFLICT (logto_sub) DO UPDATE SET
			   stripe_customer_id = $2, stripe_subscription_id = $3,
			   plan = $4, status = $5, updated_at = now()`,
			logtoSub, customerID, subID, plan, subStatus,
		)
		if err != nil {
			return fmt.Errorf("upsert subscription: %w", err)
		}
	}

	// Assign the appropriate Logto role.
	// During trial, always grant Ultimate access regardless of selected plan.
	// When the trial ends, subscription.updated fires and assigns the correct role.
	tier := decideCheckoutTier(subStatus, plan)
	if err := assignTierRole(logtoSub, tier); err != nil {
		return fmt.Errorf("assign %s role: %w", tier, err)
	}

	// Subscription state changed — overview's tier + subscription
	// blocks are now stale.
	platform.InvalidateOverviewCache(context.Background(), logtoSub)
	return nil
}

// HandleSubscriptionUpdated handles subscription changes (renewals, plan changes, cancellations).
func HandleSubscriptionUpdated(event stripe.Event) error {
	var sub stripe.Subscription
	if err := json.Unmarshal(event.Data.Raw, &sub); err != nil {
		log.Printf("[Stripe Webhook] Failed to parse subscription.updated: %v", err)
		return nil
	}

	// Look up user by Stripe customer ID
	logtoSub, err := lookupLogtoSub(sub.Customer.ID)
	if err != nil {
		return err
	}
	if logtoSub == "" {
		log.Printf("[Stripe Webhook] No user found for customer %s", sub.Customer.ID)
		return nil
	}

	storedSubID, isLifetime, err := lookupStoredSubscription(logtoSub)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	if isStaleSubscription(storedSubID, sub.ID) {
		// An older or second subscription changed; the customer's current
		// one is stored. Don't let it overwrite the row or the roles.
		log.Printf("[Stripe Webhook] Ignoring subscription.updated for %s: user=%s's stored subscription is %s", sub.ID, logtoSub, *storedSubID)
		return nil
	}

	// Act on the subscription as it is now, not as the event saw it: a
	// retried or late event can describe a state a later event already
	// replaced (SCROLLR-465). Stripe is unreachable: retry the event.
	current, err := stripesubscription.Get(sub.ID, nil)
	var se *stripe.Error
	if errors.As(err, &se) && se.Code == stripe.ErrorCodeResourceMissing {
		// Gone at Stripe (mode switch, test-data clean-up): no retry can
		// succeed, so acknowledge it like an unknown customer.
		log.Printf("[Stripe Webhook] Ignoring subscription.updated for %s: Stripe has no such subscription", sub.ID)
		return nil
	}
	if err != nil {
		return fmt.Errorf("fetch subscription %s: %w", sub.ID, err)
	}
	sub = *current
	if storedSubID == nil && !subscriptionGrantsAccess(string(sub.Status)) {
		// The row stores no subscription: this one's end was already
		// applied, or it never started. Nothing to change.
		log.Printf("[Stripe Webhook] Ignoring subscription.updated for %s: user=%s has no stored subscription and it is %s", sub.ID, logtoSub, sub.Status)
		return nil
	}

	status := string(sub.Status)
	// In stripe-go v82, CurrentPeriodEnd moved to SubscriptionItem
	var periodEndUnix int64
	if sub.Items != nil && len(sub.Items.Data) > 0 {
		periodEndUnix = sub.Items.Data[0].CurrentPeriodEnd
	}
	periodEnd := time.Unix(periodEndUnix, 0)

	// Determine plan from the first line item
	plan := "unknown"
	if sub.Items != nil && len(sub.Items.Data) > 0 {
		plan = planFromPriceID(sub.Items.Data[0].Price.ID)
	}

	log.Printf("[Stripe Webhook] Subscription updated: user=%s status=%s plan=%s cancel_at_period_end=%v",
		logtoSub, status, plan, sub.CancelAtPeriodEnd)

	action := decideSubscriptionUpdate(status, sub.CancelAtPeriodEnd, plan, isLifetime)

	_, err = platform.DBPool.Exec(context.Background(),
		`UPDATE stripe_customers SET
		   plan = $2, status = $3, current_period_end = $4,
		   stripe_subscription_id = $5, updated_at = now()
		 WHERE logto_sub = $1`,
		logtoSub, plan, action.DBStatus, periodEnd, sub.ID,
	)
	if err != nil {
		return fmt.Errorf("update subscription: %w", err)
	}

	// Active subscriptions remove stale roles first to handle plan
	// up/downgrades cleanly, then assign only the current one. Trials
	// always get Ultimate access (matching checkout.session.completed);
	// when the trial ends, this handler fires again with status="active"
	// and assigns the plan-appropriate role. A subscription Stripe gave up
	// on (incomplete_expired, unpaid, canceled) clears every paid role.
	if action.ClearPaidRoles {
		if err := removePaidRoles(logtoSub); err != nil {
			return err
		}
	}
	if action.AssignTier != "" {
		if err := assignTierRole(logtoSub, action.AssignTier); err != nil {
			return fmt.Errorf("assign %s role: %w", action.AssignTier, err)
		}
	}

	// Disable widgets over the new tier's slot cap. This is a no-op for
	// upgrades (more slots = nothing over cap) and the safety net for
	// downgrades and lost access.
	switch {
	case action.AssignTier != "":
		widgets.PruneWidgetsForTier(context.Background(), logtoSub, action.AssignTier)
	case action.ClearPaidRoles:
		widgets.PruneWidgetsForTier(context.Background(), logtoSub, "free")
	}

	// Tier and subscription fields in the overview response just changed.
	platform.InvalidateOverviewCache(context.Background(), logtoSub)
	return nil
}

// HandleSubscriptionDeleted fires when a subscription is fully cancelled (period ended).
func HandleSubscriptionDeleted(event stripe.Event) error {
	var sub stripe.Subscription
	if err := json.Unmarshal(event.Data.Raw, &sub); err != nil {
		log.Printf("[Stripe Webhook] Failed to parse subscription.deleted: %v", err)
		return nil
	}

	logtoSub, err := lookupLogtoSub(sub.Customer.ID)
	if err != nil {
		return err
	}
	if logtoSub == "" {
		log.Printf("[Stripe Webhook] No user found for customer %s", sub.Customer.ID)
		return nil
	}

	// Check if user has lifetime (don't remove role if so). A lookup
	// failure retries the event rather than risk stripping a lifetime
	// purchase; no row (pgx.ErrNoRows) means no lifetime flag.
	storedSubID, isLifetime, lifetimeErr := lookupStoredSubscription(logtoSub)
	if lifetimeErr != nil && !errors.Is(lifetimeErr, pgx.ErrNoRows) {
		return lifetimeErr
	}

	if isStaleSubscription(storedSubID, sub.ID) {
		// A stale or second subscription ended; the customer still has the
		// stored one. Downgrading them would take access they pay for.
		log.Printf("[Stripe Webhook] Ignoring subscription.deleted for %s: user=%s's stored subscription is %s", sub.ID, logtoSub, *storedSubID)
		return nil
	}

	log.Printf("[Stripe Webhook] Subscription deleted: user=%s", logtoSub)

	// Reset to free plan in DB
	_, err = platform.DBPool.Exec(context.Background(),
		`UPDATE stripe_customers SET
		   plan = 'free', status = 'canceled', stripe_subscription_id = NULL,
		   current_period_end = NULL, updated_at = now()
		 WHERE logto_sub = $1 AND lifetime = false`,
		logtoSub,
	)
	if err != nil {
		return fmt.Errorf("reset subscription: %w", err)
	}

	// Remove all paid roles (only if not lifetime)
	if decideStripPaidRoles(isLifetime, lifetimeErr) {
		if err := removePaidRoles(logtoSub); err != nil {
			return err
		}
		// Full cancellation drops the user to the free tier — disable any
		// widgets over the free slot cap (newest first, never deleted).
		widgets.PruneWidgetsForTier(context.Background(), logtoSub, "free")
	}

	// Subscription went away (or downgraded to free) — overview is stale.
	platform.InvalidateOverviewCache(context.Background(), logtoSub)
	return nil
}

// HandleInvoicePaid confirms successful payment for a subscription renewal.
func HandleInvoicePaid(event stripe.Event) error {
	var invoice struct {
		Customer     string `json:"customer"`
		Subscription string `json:"subscription"`
	}
	if err := json.Unmarshal(event.Data.Raw, &invoice); err != nil {
		log.Printf("[Stripe Webhook] Failed to parse invoice.paid: %v", err)
		return nil
	}

	logtoSub, err := lookupLogtoSub(invoice.Customer)
	if err != nil || logtoSub == "" {
		return err
	}

	log.Printf("[Stripe Webhook] Invoice paid for user=%s", logtoSub)

	// Look up current plan to assign the correct role on renewal
	var currentPlan string
	if err := platform.DBPool.QueryRow(context.Background(),
		`SELECT plan FROM stripe_customers WHERE logto_sub = $1`, logtoSub,
	).Scan(&currentPlan); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		return fmt.Errorf("read plan: %w", err)
	}
	if currentPlan == "free" {
		// No subscription on record (never stored, or already ended):
		// a paid invoice alone is not a plan to grant.
		log.Printf("[Stripe Webhook] Invoice paid for user=%s on the free plan; no role assigned", logtoSub)
		return nil
	}

	// Ensure correct role is still assigned on successful renewal.
	// Also reset past_due status back to active on successful payment.
	if _, err := platform.DBPool.Exec(context.Background(),
		`UPDATE stripe_customers SET status = 'active', updated_at = now()
		 WHERE logto_sub = $1 AND status = 'past_due'`,
		logtoSub,
	); err != nil {
		return fmt.Errorf("clear past_due: %w", err)
	}

	tier := tierForPlan(currentPlan)
	if err := assignTierRole(logtoSub, tier); err != nil {
		return fmt.Errorf("re-assign %s role: %w", tier, err)
	}
	return nil
}

// HandleInvoicePaymentFailed handles failed subscription payments.
func HandleInvoicePaymentFailed(event stripe.Event) error {
	var invoice struct {
		Customer     string `json:"customer"`
		Subscription string `json:"subscription"`
		AttemptCount int    `json:"attempt_count"`
	}
	if err := json.Unmarshal(event.Data.Raw, &invoice); err != nil {
		log.Printf("[Stripe Webhook] Failed to parse invoice.payment_failed: %v", err)
		return nil
	}

	logtoSub, err := lookupLogtoSub(invoice.Customer)
	if err != nil || logtoSub == "" {
		return err
	}

	log.Printf("[Stripe Webhook] Payment failed for user=%s (attempt %d)", logtoSub, invoice.AttemptCount)

	// Mark as past_due in our DB. A free-plan row is left alone: the failed
	// first invoice of a subscription /checkout/subscribe turned away must
	// not overwrite the 'canceled' status that ends trial eligibility.
	if _, err := platform.DBPool.Exec(context.Background(),
		`UPDATE stripe_customers SET status = 'past_due', updated_at = now()
		 WHERE logto_sub = $1 AND lifetime = false AND plan <> 'free'`,
		logtoSub,
	); err != nil {
		return fmt.Errorf("mark past_due: %w", err)
	}
	return nil
}

// handleTrialWillEnd is fired ~3 days before a trial expires.
// Currently used for logging/monitoring. Future: send email notification.
func handleTrialWillEnd(event stripe.Event) {
	var sub stripe.Subscription
	if err := json.Unmarshal(event.Data.Raw, &sub); err != nil {
		log.Printf("[Stripe Webhook] Failed to parse trial_will_end: %v", err)
		return
	}

	logtoSub, _ := lookupLogtoSub(sub.Customer.ID)
	if logtoSub == "" {
		return
	}

	trialEnd := time.Unix(sub.TrialEnd, 0)
	log.Printf("[Stripe Webhook] Trial ending soon for user=%s on %s (sub=%s)",
		logtoSub, trialEnd.Format("2006-01-02"), sub.ID)
}

// handlePaymentIntentSucceeded handles successful one-time payments (lifetime purchases).
func handlePaymentIntentSucceeded(event stripe.Event) error {
	var pi stripe.PaymentIntent
	if err := json.Unmarshal(event.Data.Raw, &pi); err != nil {
		log.Printf("[Stripe Webhook] Failed to parse payment_intent.succeeded: %v", err)
		return nil
	}

	plan := pi.Metadata["plan"]
	logtoSub := pi.Metadata["logto_sub"]

	// Only handle lifetime payments (other PaymentIntents are not ours)
	if plan != "lifetime" || logtoSub == "" {
		log.Printf("[Stripe Webhook] Ignoring payment_intent.succeeded: plan=%s logto_sub=%s", plan, logtoSub)
		return nil
	}

	customerID := ""
	if pi.Customer != nil {
		customerID = pi.Customer.ID
	}

	log.Printf("[Stripe Webhook] Lifetime payment succeeded: user=%s customer=%s", logtoSub, customerID)

	_, err := platform.DBPool.Exec(context.Background(),
		`INSERT INTO stripe_customers (logto_sub, stripe_customer_id, plan, status, lifetime)
		 VALUES ($1, $2, 'lifetime', 'active', true)
		 ON CONFLICT (logto_sub) DO UPDATE SET
		   stripe_customer_id = $2, plan = 'lifetime', status = 'active',
		   lifetime = true, updated_at = now()`,
		logtoSub, customerID,
	)
	if err != nil {
		return fmt.Errorf("upsert lifetime: %w", err)
	}

	if err := accounts.AssignUltimateRole(logtoSub); err != nil {
		return fmt.Errorf("assign ultimate role: %w", err)
	}
	return nil
}

// lookupLogtoSub finds the Logto user ID for a Stripe customer ID. An unknown
// customer is "" with no error; a database failure is an error so the event
// is retried.
func lookupLogtoSub(stripeCustomerID string) (string, error) {
	var logtoSub string
	err := platform.DBPool.QueryRow(context.Background(),
		`SELECT logto_sub FROM stripe_customers WHERE stripe_customer_id = $1`, stripeCustomerID,
	).Scan(&logtoSub)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("look up customer %s: %w", stripeCustomerID, err)
	}
	return logtoSub, nil
}

// lookupStoredSubscription reads the subscription id and lifetime flag
// stored for a user. pgx.ErrNoRows is returned as is.
func lookupStoredSubscription(logtoSub string) (*string, bool, error) {
	var subID *string
	var isLifetime bool
	err := platform.DBPool.QueryRow(context.Background(),
		`SELECT stripe_subscription_id, lifetime FROM stripe_customers WHERE logto_sub = $1`, logtoSub,
	).Scan(&subID, &isLifetime)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		err = fmt.Errorf("read stored subscription: %w", err)
	}
	return subID, isLifetime, err
}

// removePaidRoles removes every paid Logto role. Each removal is idempotent
// (Logto answers 404 for a role the user does not hold).
func removePaidRoles(logtoSub string) error {
	if err := accounts.RemoveUplinkRole(logtoSub); err != nil {
		return fmt.Errorf("remove uplink role: %w", err)
	}
	if err := accounts.RemoveProRole(logtoSub); err != nil {
		return fmt.Errorf("remove uplink_pro role: %w", err)
	}
	if err := accounts.RemoveUltimateRole(logtoSub); err != nil {
		return fmt.Errorf("remove uplink_ultimate role: %w", err)
	}
	return nil
}
