package core

import (
	"context"
	"encoding/json"
	"log"
	"os"
	"time"

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
			Tolerance:                StripeWebhookTolerance * time.Second,
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
	if DBPool != nil {
		var claimedID string
		claimErr := DBPool.QueryRow(context.Background(),
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

	switch event.Type {
	case "checkout.session.completed":
		handleCheckoutCompleted(event)
	case "customer.subscription.updated":
		handleSubscriptionUpdated(event)
	case "customer.subscription.deleted":
		handleSubscriptionDeleted(event)
	case "invoice.paid":
		handleInvoicePaid(event)
	case "invoice.payment_failed":
		handleInvoicePaymentFailed(event)
	case "customer.subscription.trial_will_end":
		handleTrialWillEnd(event)
	case "payment_intent.succeeded":
		handlePaymentIntentSucceeded(event)
	default:
		log.Printf("[Stripe Webhook] Unhandled event type: %s", event.Type)
	}

	// Event slot was already claimed atomically above via INSERT ... ON CONFLICT
	// RETURNING. No second write needed.

	return c.SendStatus(fiber.StatusOK)
}

// handleCheckoutCompleted processes successful checkout sessions.
// This is the primary entry point for new subscriptions and lifetime purchases.
func handleCheckoutCompleted(event stripe.Event) {
	var session stripe.CheckoutSession
	if err := json.Unmarshal(event.Data.Raw, &session); err != nil {
		log.Printf("[Stripe Webhook] Failed to parse checkout.session.completed: %v", err)
		return
	}

	logtoSub := session.Metadata["logto_sub"]
	plan := session.Metadata["plan"]
	if logtoSub == "" || plan == "" {
		log.Printf("[Stripe Webhook] checkout.session.completed missing metadata (logto_sub=%s, plan=%s)", logtoSub, plan)
		return
	}

	customerID := ""
	if session.Customer != nil {
		customerID = session.Customer.ID
	}

	log.Printf("[Stripe Webhook] Checkout completed: user=%s plan=%s mode=%s", logtoSub, plan, session.Mode)

	subStatus := "active" // hoisted — used for role assignment after the if/else

	if plan == "lifetime" {
		// One-time payment — mark as lifetime
		_, err := DBPool.Exec(context.Background(),
			`INSERT INTO stripe_customers (logto_sub, stripe_customer_id, plan, status, lifetime)
			 VALUES ($1, $2, $3, 'active', true)
			 ON CONFLICT (logto_sub) DO UPDATE SET
			   stripe_customer_id = $2, plan = $3, status = 'active',
			   lifetime = true, updated_at = now()`,
			logtoSub, customerID, plan,
		)
		if err != nil {
			log.Printf("[Stripe Webhook] Failed to upsert lifetime for %s: %v", logtoSub, err)
			return
		}
	} else {
		// Subscription — fetch the full subscription to get actual status.
		// Webhook payloads don't expand the subscription object, so
		// session.Subscription.Status is always empty. We must call the
		// Stripe API to get the real status (e.g. "trialing" vs "active").
		subID := ""
		if session.Subscription != nil {
			subID = session.Subscription.ID
			fullSub, err := stripesubscription.Get(subID, nil)
			if err == nil {
				subStatus = string(fullSub.Status)
			} else {
				log.Printf("[Stripe Webhook] Failed to fetch subscription %s, defaulting to active: %v", subID, err)
			}
		}

		_, err := DBPool.Exec(context.Background(),
			`INSERT INTO stripe_customers (logto_sub, stripe_customer_id, stripe_subscription_id, plan, status)
			 VALUES ($1, $2, $3, $4, $5)
			 ON CONFLICT (logto_sub) DO UPDATE SET
			   stripe_customer_id = $2, stripe_subscription_id = $3,
			   plan = $4, status = $5, updated_at = now()`,
			logtoSub, customerID, subID, plan, subStatus,
		)
		if err != nil {
			log.Printf("[Stripe Webhook] Failed to upsert subscription for %s: %v", logtoSub, err)
			return
		}
	}

	// Assign the appropriate Logto role.
	// During trial, always grant Ultimate access regardless of selected plan.
	// When the trial ends, subscription.updated fires and assigns the correct role.
	tier := decideCheckoutTier(subStatus, plan)
	if err := assignTierRole(logtoSub, tier); err != nil {
		log.Printf("[Stripe Webhook] Failed to assign %s role to %s: %v", tier, logtoSub, err)
	}

	// Subscription state changed — overview's tier + subscription
	// blocks are now stale.
	InvalidateOverviewCache(context.Background(), logtoSub)
}

// handleSubscriptionUpdated handles subscription changes (renewals, plan changes, cancellations).
func handleSubscriptionUpdated(event stripe.Event) {
	var sub stripe.Subscription
	if err := json.Unmarshal(event.Data.Raw, &sub); err != nil {
		log.Printf("[Stripe Webhook] Failed to parse subscription.updated: %v", err)
		return
	}

	// Look up user by Stripe customer ID
	logtoSub := lookupLogtoSub(sub.Customer.ID)
	if logtoSub == "" {
		log.Printf("[Stripe Webhook] No user found for customer %s", sub.Customer.ID)
		return
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

	action := decideSubscriptionUpdate(status, sub.CancelAtPeriodEnd, plan)

	_, err := DBPool.Exec(context.Background(),
		`UPDATE stripe_customers SET
		   plan = $2, status = $3, current_period_end = $4,
		   stripe_subscription_id = $5, updated_at = now()
		 WHERE logto_sub = $1`,
		logtoSub, plan, action.DBStatus, periodEnd, sub.ID,
	)
	if err != nil {
		log.Printf("[Stripe Webhook] Failed to update subscription for %s: %v", logtoSub, err)
	}

	// Active subscriptions remove stale roles first to handle plan
	// up/downgrades cleanly, then assign only the current one. Trials
	// always get Ultimate access (matching checkout.session.completed);
	// when the trial ends, this handler fires again with status="active"
	// and assigns the plan-appropriate role.
	if action.ClearPaidRoles {
		if err := RemoveUplinkRole(logtoSub); err != nil {
			log.Printf("[Stripe Webhook] Failed to remove uplink role from %s: %v", logtoSub, err)
		}
		if err := RemoveProRole(logtoSub); err != nil {
			log.Printf("[Stripe Webhook] Failed to remove uplink_pro role from %s: %v", logtoSub, err)
		}
		if err := RemoveUltimateRole(logtoSub); err != nil {
			log.Printf("[Stripe Webhook] Failed to remove uplink_ultimate role from %s: %v", logtoSub, err)
		}
	}
	if action.AssignTier != "" {
		if err := assignTierRole(logtoSub, action.AssignTier); err != nil {
			log.Printf("[Stripe Webhook] Failed to assign %s role to %s: %v", action.AssignTier, logtoSub, err)
		}
	}

	// Auto-prune oversized channel configs to match the new tier's caps.
	// This is a no-op for upgrades (higher caps = nothing to trim) and
	// the safety net for downgrades. Called after role assignment so a
	// failed Logto call doesn't block the prune.
	if action.AssignTier != "" {
		PruneUserChannelsForTier(context.Background(), logtoSub, action.AssignTier)
	}

	// Tier and subscription fields in the overview response just changed.
	InvalidateOverviewCache(context.Background(), logtoSub)
}

// handleSubscriptionDeleted fires when a subscription is fully cancelled (period ended).
func handleSubscriptionDeleted(event stripe.Event) {
	var sub stripe.Subscription
	if err := json.Unmarshal(event.Data.Raw, &sub); err != nil {
		log.Printf("[Stripe Webhook] Failed to parse subscription.deleted: %v", err)
		return
	}

	logtoSub := lookupLogtoSub(sub.Customer.ID)
	if logtoSub == "" {
		log.Printf("[Stripe Webhook] No user found for customer %s", sub.Customer.ID)
		return
	}

	log.Printf("[Stripe Webhook] Subscription deleted: user=%s", logtoSub)

	// Check if user has lifetime (don't remove role if so)
	var isLifetime bool
	_ = DBPool.QueryRow(context.Background(),
		`SELECT lifetime FROM stripe_customers WHERE logto_sub = $1`, logtoSub,
	).Scan(&isLifetime)

	// Reset to free plan in DB
	_, err := DBPool.Exec(context.Background(),
		`UPDATE stripe_customers SET
		   plan = 'free', status = 'canceled', stripe_subscription_id = NULL,
		   current_period_end = NULL, updated_at = now()
		 WHERE logto_sub = $1 AND lifetime = false`,
		logtoSub,
	)
	if err != nil {
		log.Printf("[Stripe Webhook] Failed to reset subscription for %s: %v", logtoSub, err)
	}

	// Remove all paid roles (only if not lifetime)
	if !isLifetime {
		if err := RemoveUplinkRole(logtoSub); err != nil {
			log.Printf("[Stripe Webhook] Failed to remove uplink role from %s: %v", logtoSub, err)
		}
		if err := RemoveProRole(logtoSub); err != nil {
			log.Printf("[Stripe Webhook] Failed to remove uplink_pro role from %s: %v", logtoSub, err)
		}
		if err := RemoveUltimateRole(logtoSub); err != nil {
			log.Printf("[Stripe Webhook] Failed to remove uplink_ultimate role from %s: %v", logtoSub, err)
		}
		// Full cancellation drops the user to the free tier — trim any
		// configs they accumulated while on a paid plan down to free caps.
		PruneUserChannelsForTier(context.Background(), logtoSub, "free")
	}

	// Subscription went away (or downgraded to free) — overview is stale.
	InvalidateOverviewCache(context.Background(), logtoSub)
}

// handleInvoicePaid confirms successful payment for a subscription renewal.
func handleInvoicePaid(event stripe.Event) {
	var invoice struct {
		Customer     string `json:"customer"`
		Subscription string `json:"subscription"`
	}
	if err := json.Unmarshal(event.Data.Raw, &invoice); err != nil {
		log.Printf("[Stripe Webhook] Failed to parse invoice.paid: %v", err)
		return
	}

	logtoSub := lookupLogtoSub(invoice.Customer)
	if logtoSub == "" {
		return
	}

	log.Printf("[Stripe Webhook] Invoice paid for user=%s", logtoSub)

	// Look up current plan to assign the correct role on renewal
	var currentPlan string
	_ = DBPool.QueryRow(context.Background(),
		`SELECT plan FROM stripe_customers WHERE logto_sub = $1`, logtoSub,
	).Scan(&currentPlan)

	// Ensure correct role is still assigned on successful renewal.
	// Also reset past_due status back to active on successful payment.
	_, _ = DBPool.Exec(context.Background(),
		`UPDATE stripe_customers SET status = 'active', updated_at = now()
		 WHERE logto_sub = $1 AND status = 'past_due'`,
		logtoSub,
	)

	tier := tierForPlan(currentPlan)
	if err := assignTierRole(logtoSub, tier); err != nil {
		log.Printf("[Stripe Webhook] Failed to re-assign %s role to %s: %v", tier, logtoSub, err)
	}
}

// handleInvoicePaymentFailed handles failed subscription payments.
func handleInvoicePaymentFailed(event stripe.Event) {
	var invoice struct {
		Customer     string `json:"customer"`
		Subscription string `json:"subscription"`
		AttemptCount int    `json:"attempt_count"`
	}
	if err := json.Unmarshal(event.Data.Raw, &invoice); err != nil {
		log.Printf("[Stripe Webhook] Failed to parse invoice.payment_failed: %v", err)
		return
	}

	logtoSub := lookupLogtoSub(invoice.Customer)
	if logtoSub == "" {
		return
	}

	log.Printf("[Stripe Webhook] Payment failed for user=%s (attempt %d)", logtoSub, invoice.AttemptCount)

	// Mark as past_due in our DB
	_, _ = DBPool.Exec(context.Background(),
		`UPDATE stripe_customers SET status = 'past_due', updated_at = now()
		 WHERE logto_sub = $1 AND lifetime = false`,
		logtoSub,
	)
}

// handleTrialWillEnd is fired ~3 days before a trial expires.
// Currently used for logging/monitoring. Future: send email notification.
func handleTrialWillEnd(event stripe.Event) {
	var sub stripe.Subscription
	if err := json.Unmarshal(event.Data.Raw, &sub); err != nil {
		log.Printf("[Stripe Webhook] Failed to parse trial_will_end: %v", err)
		return
	}

	logtoSub := lookupLogtoSub(sub.Customer.ID)
	if logtoSub == "" {
		return
	}

	trialEnd := time.Unix(sub.TrialEnd, 0)
	log.Printf("[Stripe Webhook] Trial ending soon for user=%s on %s (sub=%s)",
		logtoSub, trialEnd.Format("2006-01-02"), sub.ID)
}

// handlePaymentIntentSucceeded handles successful one-time payments (lifetime purchases).
func handlePaymentIntentSucceeded(event stripe.Event) {
	var pi stripe.PaymentIntent
	if err := json.Unmarshal(event.Data.Raw, &pi); err != nil {
		log.Printf("[Stripe Webhook] Failed to parse payment_intent.succeeded: %v", err)
		return
	}

	plan := pi.Metadata["plan"]
	logtoSub := pi.Metadata["logto_sub"]

	// Only handle lifetime payments (other PaymentIntents are not ours)
	if plan != "lifetime" || logtoSub == "" {
		log.Printf("[Stripe Webhook] Ignoring payment_intent.succeeded: plan=%s logto_sub=%s", plan, logtoSub)
		return
	}

	customerID := ""
	if pi.Customer != nil {
		customerID = pi.Customer.ID
	}

	log.Printf("[Stripe Webhook] Lifetime payment succeeded: user=%s customer=%s", logtoSub, customerID)

	_, err := DBPool.Exec(context.Background(),
		`INSERT INTO stripe_customers (logto_sub, stripe_customer_id, plan, status, lifetime)
		 VALUES ($1, $2, 'lifetime', 'active', true)
		 ON CONFLICT (logto_sub) DO UPDATE SET
		   stripe_customer_id = $2, plan = 'lifetime', status = 'active',
		   lifetime = true, updated_at = now()`,
		logtoSub, customerID,
	)
	if err != nil {
		log.Printf("[Stripe Webhook] Failed to upsert lifetime for %s: %v", logtoSub, err)
		return
	}

	if err := AssignUltimateRole(logtoSub); err != nil {
		log.Printf("[Stripe Webhook] Failed to assign ultimate role to %s: %v", logtoSub, err)
	}
}

// lookupLogtoSub finds the Logto user ID for a Stripe customer ID.
func lookupLogtoSub(stripeCustomerID string) string {
	var logtoSub string
	err := DBPool.QueryRow(context.Background(),
		`SELECT logto_sub FROM stripe_customers WHERE stripe_customer_id = $1`, stripeCustomerID,
	).Scan(&logtoSub)
	if err != nil {
		return ""
	}
	return logtoSub
}
