package core

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
//   - Only active/trialing subscriptions touch roles; past_due, canceled,
//     incomplete, etc. leave roles as-is.

// Tier identifiers returned by the decision helpers. These match the Logto
// role names and the tier strings PruneUserChannelsForTier expects.
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
	// Non-empty also triggers PruneUserChannelsForTier for that tier.
	AssignTier string
}

// decideSubscriptionUpdate computes the DB status and role changes for a
// customer.subscription.updated event.
func decideSubscriptionUpdate(status string, cancelAtPeriodEnd bool, plan string) subscriptionUpdateAction {
	action := subscriptionUpdateAction{DBStatus: status}
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

// assignTierRole assigns the Logto role for the given tier.
func assignTierRole(logtoSub, tier string) error {
	switch tier {
	case tierUltimate:
		return AssignUltimateRole(logtoSub)
	case tierPro:
		return AssignProRole(logtoSub)
	default:
		return AssignUplinkRole(logtoSub)
	}
}
