package core

import (
	_ "embed"
	"encoding/json"
	"reflect"
	"testing"
)

// tier_limits.json is the cross-language sync snapshot for DefaultTierLimits.
// Three test suites assert against the same file:
//
//   - this test (backend-tests CI)
//   - desktop/src/tierLimits.test.ts            (frontend-tests CI)
//   - myscrollr.com/src/lib/fallbackTierLimits.test.ts (frontend-tests CI)
//
// Changing any one of the four copies without the others fails CI on the
// stale side. To change a limit: edit DefaultTierLimits, tier_limits.json,
// desktop/src/tierLimits.ts, and myscrollr.com/src/lib/fallbackTierLimits.ts
// in the same PR.
//
//go:embed tier_limits.json
var tierLimitsSnapshot []byte

// TestDefaultTierLimits_MatchesSnapshot asserts that DefaultTierLimits
// serializes to exactly the contents of tier_limits.json — the same wire
// shape GET /tier-limits serves. Comparison is on parsed values, so JSON
// formatting/key order in the snapshot file doesn't matter.
func TestDefaultTierLimits_MatchesSnapshot(t *testing.T) {
	served, err := json.Marshal(TierLimitsResponse{Tiers: DefaultTierLimits})
	if err != nil {
		t.Fatalf("marshal DefaultTierLimits: %v", err)
	}

	var got, want any
	if err := json.Unmarshal(served, &got); err != nil {
		t.Fatalf("unmarshal serialized DefaultTierLimits: %v", err)
	}
	if err := json.Unmarshal(tierLimitsSnapshot, &want); err != nil {
		t.Fatalf("unmarshal tier_limits.json: %v", err)
	}

	if !reflect.DeepEqual(got, want) {
		t.Errorf("DefaultTierLimits drifted from tier_limits.json\n  got:  %s\n  want: %s\n"+
			"Update both (plus desktop/src/tierLimits.ts and myscrollr.com/src/lib/fallbackTierLimits.ts) in the same PR.",
			served, tierLimitsSnapshot)
	}
}
