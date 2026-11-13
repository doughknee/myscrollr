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

// SCROLLR-445: "current version" is the newest published Stable, chosen by
// version rather than list order, with the Beta named only while it is ahead.
func TestCurrentDesktopVersions(t *testing.T) {
	rel := func(tag string, pre bool) release { return release{Tag: tag, Prerelease: pre} }
	all := []release{
		rel("server-2026.10.26.4", false),
		rel("desktop-v1.8.0-beta.2", true),
		rel("desktop-v1.8.0-beta.10", true),
		rel("desktop-v1.7.3", false),
		rel("desktop-v1.7.10", false),
		rel("desktop-v1.7.9", false),
	}
	stable, beta := currentDesktopVersions(all)
	if stable == nil || stable.version != "1.7.10" {
		t.Fatalf("stable = %+v, want 1.7.10", stable)
	}
	if beta == nil || beta.version != "1.8.0-beta.10" {
		t.Fatalf("beta = %+v, want 1.8.0-beta.10", beta)
	}
	// Once the final release ships, its betas are no longer "current".
	_, beta = currentDesktopVersions(append(all, rel("desktop-v1.8.0", false)))
	if beta != nil {
		t.Errorf("beta = %+v after 1.8.0 shipped, want none", beta)
	}
}
