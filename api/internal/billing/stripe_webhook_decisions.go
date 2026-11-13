package billing

import (
	"errors"

	"github.com/brandon-relentnet/myscrollr/api/internal/accounts"
	"github.com/jackc/pgx/v5"
)

// =============================================================================
// Stripe Webhook Decision Logic
// =============================================================================
//
// Pure decision functions for the webhook handlers in stripe_webhook.go.
// They encode the tier/role rules in one place so the rules are unit-testable
// without a database or Logto connection:
//
//   - Trialing users always get Ultimate access regardless of selected plan.
//   - Lifetime purchases grant Ultimate access.
//   - cancel_at_period_end is stored as "canceling" and never changes roles.
//   - active/trialing grant a role; incomplete_expired, unpaid and canceled
//     remove every paid role; past_due (dunning grace) and incomplete (first
//     payment still settling) leave roles as-is.
//   - Lifetime members never have roles changed by a subscription event.

// Tier identifiers returned by the decision helpers. These match the Logto
// role names and the tier strings PruneWidgetsForTier expects.
const (
	tierUplink   = "uplink"
	tierPro      = "uplink_pro"
	tierUltimate = "uplink_ultimate"
)

// tierForPlan maps a plan name to the tier role it grants. Unknown plans
// fall back to the base paid tier, mirroring planRank.
func tierForPlan(plan string) string {
	switch {
	case isUltimatePlan(plan):
		return tierUltimate
	case isProPlan(plan):
		return tierPro
	default:
		return tierUplink
	}
}

// decideCheckoutTier returns the tier role to assign after a completed
// checkout. During trial, always grant Ultimate access regardless of selected
// plan — when the trial ends, subscription.updated fires and assigns the
// plan-appropriate role. Lifetime purchases also grant Ultimate access.
func decideCheckoutTier(subStatus, plan string) string {
	if subStatus == "trialing" || plan == "lifetime" {
		return tierUltimate
	}
	return tierForPlan(plan)
}

// subscriptionUpdateAction describes the state changes a
// customer.subscription.updated event should produce.
type subscriptionUpdateAction struct {
	// DBStatus is the status persisted to stripe_customers.
	DBStatus string
	// ClearPaidRoles removes all existing paid roles before assigning,
	// so plan up/downgrades don't leave stale roles behind.
	ClearPaidRoles bool
	// AssignTier is the tier role to assign; "" leaves roles untouched.
	// Non-empty also triggers PruneWidgetsForTier for that tier.
	AssignTier string
}

// decideSubscriptionUpdate computes the DB status and role changes for a
// customer.subscription.updated event. isLifetime is the stripe_customers
// lifetime flag: lifetime is permanent Ultimate, so a subscription event never
// adds, clears or prunes anything for it.
func decideSubscriptionUpdate(status string, cancelAtPeriodEnd bool, plan string, isLifetime bool) subscriptionUpdateAction {
	action := subscriptionUpdateAction{DBStatus: status}
	if isLifetime {
		return action
	}
	switch status {
	case "incomplete_expired", "unpaid", "canceled":
		// Stripe has stopped trying to collect: no paid access, even if
		// cancel_at_period_end is still set on the object.
		action.ClearPaidRoles = true
		return action
	}
	if cancelAtPeriodEnd {
		action.DBStatus = "canceling"
		return action
	}
	switch status {
	case "trialing":
		// Trial users get full access; the plan-appropriate role is
		// assigned when this handler fires again with status="active".
		action.AssignTier = tierUltimate
	case "active":
		action.ClearPaidRoles = true
		action.AssignTier = tierForPlan(plan)
	}
	return action
}

// decideStripPaidRoles reports whether a subscription deletion should strip
// the user's paid roles, given the result of the lifetime-flag lookup.
//
// Fail safe: if the lookup errored we cannot tell whether the customer is
// lifetime, and stripping roles from a lifetime customer is the worse failure
// mode — keep the roles and let a later event or manual reconciliation sort it
// out. pgx.ErrNoRows is not a failure: no customer row means no lifetime flag,
// so roles are stripped as usual.
func decideStripPaidRoles(isLifetime bool, lookupErr error) bool {
	if lookupErr != nil && !errors.Is(lookupErr, pgx.ErrNoRows) {
		return false
	}
	return !isLifetime
}

// subscriptionGrantsAccess reports whether a subscription status Stripe
// returned at creation may grant a paid role: only a paid (active) or
// trialing subscription. "incomplete" means the first charge was declined or
// still needs the customer (3-D Secure).
func subscriptionGrantsAccess(status string) bool {
	return status == "active" || status == "trialing"
}

// checkoutPaid reports whether a Checkout Session's payment_status lets the
// session grant access. "unpaid" means a delayed payment method has not
// settled yet; checkout.session.async_payment_succeeded grants it later.
func checkoutPaid(paymentStatus string) bool {
	return paymentStatus == "paid" || paymentStatus == "no_payment_required"
}

// isStaleSubscription reports whether a subscription event is about a
// subscription other than the one stored for the customer. Only a stored,
// non-empty id can make an event stale: with none stored there is no current
// subscription the event could clobber.
func isStaleSubscription(storedSubID *string, eventSubID string) bool {
	return storedSubID != nil && *storedSubID != "" && *storedSubID != eventSubID
}

// hadSubscription reports whether a stripe_customers row shows the account
// has had a subscription, which ends trial eligibility. A row that never
// subscribed is the one getOrCreateStripeCustomer writes: plan 'free', the
// column-default status 'active', no subscription id. Every path that ends a
// subscription leaves a mark: subscription.deleted and the trial cancel store
// status 'canceled', the subscription self-heal stores 'none'.
func hadSubscription(plan, status string, subID *string) bool {
	return plan != "free" || status == "canceled" || status == "none" || (subID != nil && *subID != "")
}

// assignTierRole assigns the Logto role for the given tier.
func assignTierRole(logtoSub, tier string) error {
	switch tier {
	case tierUltimate:
		return accounts.AssignUltimateRole(logtoSub)
	case tierPro:
		return accounts.AssignProRole(logtoSub)
	default:
		return accounts.AssignUplinkRole(logtoSub)
	}
}
