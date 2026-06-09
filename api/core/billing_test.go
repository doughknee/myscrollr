package core

import (
	"os"
	"testing"
)

func TestPlanFromPriceID(t *testing.T) {
	os.Setenv("STRIPE_PRICE_MONTHLY", "price_monthly_123")
	os.Setenv("STRIPE_PRICE_ANNUAL", "price_annual_456")
	os.Setenv("STRIPE_PRICE_LIFETIME", "price_lifetime_789")
	os.Setenv("STRIPE_PRICE_PRO_MONTHLY", "price_pro_monthly")
	os.Setenv("STRIPE_PRICE_PRO_ANNUAL", "price_pro_annual")
	os.Setenv("STRIPE_PRICE_ULTIMATE_MONTHLY", "price_ultimate_monthly")
	os.Setenv("STRIPE_PRICE_ULTIMATE_ANNUAL", "price_ultimate_annual")
	defer func() {
		for _, k := range []string{
			"STRIPE_PRICE_MONTHLY", "STRIPE_PRICE_ANNUAL", "STRIPE_PRICE_LIFETIME",
			"STRIPE_PRICE_PRO_MONTHLY", "STRIPE_PRICE_PRO_ANNUAL",
			"STRIPE_PRICE_ULTIMATE_MONTHLY", "STRIPE_PRICE_ULTIMATE_ANNUAL",
		} {
			os.Unsetenv(k)
		}
	}()

	tests := []struct {
		name   string
		priceID string
		want   string
	}{
		{"monthly", "price_monthly_123", "monthly"},
		{"annual", "price_annual_456", "annual"},
		{"lifetime", "price_lifetime_789", "lifetime"},
		{"pro monthly", "price_pro_monthly", "pro_monthly"},
		{"pro annual", "price_pro_annual", "pro_annual"},
		{"ultimate monthly", "price_ultimate_monthly", "ultimate_monthly"},
		{"ultimate annual", "price_ultimate_annual", "ultimate_annual"},
		{"unknown price id", "unknown_price_id", "unknown"},
		{"empty price id", "", "unknown"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := planFromPriceID(tc.priceID)
			if got != tc.want {
				t.Errorf("planFromPriceID(%q) = %q, want %q", tc.priceID, got, tc.want)
			}
		})
	}
}

func TestIsProPlan(t *testing.T) {
	tests := []struct {
		name string
		plan string
		want bool
	}{
		{"pro_monthly", "pro_monthly", true},
		{"pro_annual", "pro_annual", true},
		{"monthly", "monthly", false},
		{"annual", "annual", false},
		{"ultimate_monthly", "ultimate_monthly", false},
		{"lifetime", "lifetime", false},
		{"unknown", "unknown", false},
		{"empty", "", false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := isProPlan(tc.plan)
			if got != tc.want {
				t.Errorf("isProPlan(%q) = %v, want %v", tc.plan, got, tc.want)
			}
		})
	}
}

func TestIsUltimatePlan(t *testing.T) {
	tests := []struct {
		name string
		plan string
		want bool
	}{
		{"ultimate_monthly", "ultimate_monthly", true},
		{"ultimate_annual", "ultimate_annual", true},
		{"pro_monthly", "pro_monthly", false},
		{"monthly", "monthly", false},
		{"lifetime", "lifetime", false},
		{"unknown", "unknown", false},
		{"empty", "", false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := isUltimatePlan(tc.plan)
			if got != tc.want {
				t.Errorf("isUltimatePlan(%q) = %v, want %v", tc.plan, got, tc.want)
			}
		})
	}
}

func TestPlanRank(t *testing.T) {
	tests := []struct {
		name string
		plan string
		want int
	}{
		{"ultimate_monthly", "ultimate_monthly", 3},
		{"ultimate_annual", "ultimate_annual", 3},
		{"pro_monthly", "pro_monthly", 2},
		{"pro_annual", "pro_annual", 2},
		{"monthly", "monthly", 1},
		{"annual", "annual", 1},
		{"lifetime", "lifetime", 1},
		{"unknown", "unknown", 1},
		{"empty", "", 1},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := planRank(tc.plan)
			if got != tc.want {
				t.Errorf("planRank(%q) = %d, want %d", tc.plan, got, tc.want)
			}
		})
	}
}

func TestPlanRankUpgradeDowngrade(t *testing.T) {
	// These tests verify the upgrade/downgrade logic used by HandleChangePlan

	upgradeCases := [][2]string{
		{"monthly", "pro_monthly"},
		{"monthly", "ultimate_monthly"},
		{"pro_monthly", "ultimate_monthly"},
		{"lifetime", "pro_monthly"},
		{"lifetime", "ultimate_monthly"},
	}
	for _, pair := range upgradeCases {
		current, next := pair[0], pair[1]
		if planRank(next) <= planRank(current) {
			t.Errorf("planRank(%q)=%d should be > planRank(%q)=%d for upgrade", next, planRank(next), current, planRank(current))
		}
	}

	downgradeCases := [][2]string{
		{"pro_monthly", "monthly"},
		{"ultimate_monthly", "monthly"},
		{"ultimate_monthly", "pro_monthly"},
	}
	for _, pair := range downgradeCases {
		current, next := pair[0], pair[1]
		if planRank(next) >= planRank(current) {
			t.Errorf("planRank(%q)=%d should be < planRank(%q)=%d for downgrade", next, planRank(next), current, planRank(current))
		}
	}
}

func TestHasSubscriptionConflict(t *testing.T) {
	tests := []struct {
		name           string
		existingPlan   string
		existingStatus string
		isLifetime     bool
		newPlan        string
		want           bool
	}{
		// Free users never conflict.
		{"free plan", "free", "active", false, "monthly", false},
		{"free plan trialing status", "free", "trialing", false, "ultimate_monthly", false},

		// Active or trialing paid plans block a new subscription.
		{"active monthly blocks", "monthly", "active", false, "pro_monthly", true},
		{"active pro blocks", "pro_monthly", "active", false, "ultimate_monthly", true},
		{"trialing blocks", "monthly", "trialing", false, "monthly", true},

		// Ended subscriptions don't block re-subscribing.
		{"canceled does not block", "monthly", "canceled", false, "monthly", false},
		{"canceling does not block", "pro_monthly", "canceling", false, "pro_monthly", false},
		{"past_due does not block", "monthly", "past_due", false, "monthly", false},
		{"none status does not block", "monthly", "none", false, "monthly", false},

		// Lifetime members may stack Ultimate or Pro on top...
		{"lifetime can add ultimate monthly", "lifetime", "active", true, "ultimate_monthly", false},
		{"lifetime can add ultimate annual", "lifetime", "active", true, "ultimate_annual", false},
		{"lifetime can add pro monthly", "lifetime", "active", true, "pro_monthly", false},
		{"lifetime can add pro annual", "lifetime", "active", true, "pro_annual", false},
		// ...but not a base Uplink subscription.
		{"lifetime cannot add base monthly", "lifetime", "active", true, "monthly", true},
		{"lifetime cannot add base annual", "lifetime", "active", true, "annual", true},

		// Non-lifetime users get no stacking exception.
		{"active without lifetime cannot add ultimate", "monthly", "active", false, "ultimate_monthly", true},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := hasSubscriptionConflict(tc.existingPlan, tc.existingStatus, tc.isLifetime, tc.newPlan)
			if got != tc.want {
				t.Errorf("hasSubscriptionConflict(%q, %q, %v, %q) = %v, want %v",
					tc.existingPlan, tc.existingStatus, tc.isLifetime, tc.newPlan, got, tc.want)
			}
		})
	}
}

func TestHasLifetimeCheckoutConflict(t *testing.T) {
	tests := []struct {
		name           string
		existingPlan   string
		existingStatus string
		isLifetime     bool
		want           bool
	}{
		// Existing lifetime members can't buy lifetime again.
		{"lifetime member blocks", "lifetime", "none", true, true},
		{"lifetime member with stacked sub blocks", "ultimate_monthly", "active", true, true},

		// Free users can always buy lifetime.
		{"free plan", "free", "none", false, false},
		{"free plan active status", "free", "active", false, false},
		{"free plan trialing status", "free", "trialing", false, false},

		// Active or trialing paid subscriptions block lifetime purchase —
		// a trial converts to a paid subscription that would stack on lifetime.
		{"active monthly blocks", "monthly", "active", false, true},
		{"active annual blocks", "annual", "active", false, true},
		{"trialing monthly blocks", "monthly", "trialing", false, true},
		{"trialing pro blocks", "pro_monthly", "trialing", false, true},

		// Ended subscriptions don't block buying lifetime.
		{"canceled does not block", "monthly", "canceled", false, false},
		{"canceling does not block", "annual", "canceling", false, false},
		{"past_due does not block", "monthly", "past_due", false, false},
		{"none status does not block", "monthly", "none", false, false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := hasLifetimeCheckoutConflict(tc.existingPlan, tc.existingStatus, tc.isLifetime)
			if got != tc.want {
				t.Errorf("hasLifetimeCheckoutConflict(%q, %q, %v) = %v, want %v",
					tc.existingPlan, tc.existingStatus, tc.isLifetime, got, tc.want)
			}
		})
	}
}
