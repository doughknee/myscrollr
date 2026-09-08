package main

import (
	"testing"

	"github.com/brandon-relentnet/myscrollr/api/internal/widgets"
)

// TestTierOrderIsDeterministic guards the generator's own CI gate.
//
// The plan table is built by ranging a map, and the rank comparator alone
// leaves super_user and uplink_ultimate comparing equal in both directions
// (TierFromRoles short-circuits on super_user wherever it appears). With an
// unstable sort on top of Go's randomised map iteration, the two rows
// swapped run to run — so `git diff --exit-code` on the committed knowledge
// base failed on unrelated pull requests, at random.
//
// Ranging the same map repeatedly is exactly the shuffle that exposed it.
func TestTierOrderIsDeterministic(t *testing.T) {
	first := tierOrder(widgets.DefaultTierLimits)
	for i := 0; i < 200; i++ {
		got := tierOrder(widgets.DefaultTierLimits)
		if len(got) != len(first) {
			t.Fatalf("run %d returned %d ids, first run returned %d", i, len(got), len(first))
		}
		for j := range got {
			if got[j] != first[j] {
				t.Fatalf("run %d differs at %d: %q vs %q\n got: %v\nfirst: %v",
					i, j, got[j], first[j], got, first)
			}
		}
	}
}

// The table still has to read weakest-first, which is the reason the rank
// sort is there at all.
func TestTierOrderRunsWeakestFirst(t *testing.T) {
	ids := tierOrder(widgets.DefaultTierLimits)
	if len(ids) < 2 {
		t.Skip("not enough plans to order")
	}
	if ids[0] != "free" {
		t.Errorf("first plan is %q, want free", ids[0])
	}
	for i, id := range ids {
		if id == "uplink_pro" {
			for _, weaker := range []string{"free", "uplink"} {
				if indexOf(ids, weaker) > i {
					t.Errorf("%s sorts after uplink_pro", weaker)
				}
			}
		}
	}
}

func indexOf(ids []string, want string) int {
	for i, id := range ids {
		if id == want {
			return i
		}
	}
	return -1
}
