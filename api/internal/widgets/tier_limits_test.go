package widgets

import (
	"encoding/json"
	"testing"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
)

// TestDefaultTierLimits_Exact pins the numeric values shipped to production.
// If you change DefaultTierLimits you MUST update this test in the same PR —
// the diff is your intentional signal that billing/pricing agreed with the
// move, and that desktop/src/tierLimits.ts + myscrollr.com/src/routes/
// uplink.tsx were updated to match.
//
// Null (unlimited) is checked by pointer-nil, finite caps by *int value.
func TestDefaultTierLimits_Exact(t *testing.T) {
	cases := []struct {
		tier                   string
		maxWidgets             *int
		symbols                *int
		feeds                  *int
		customFeeds            *int
		leagues                *int
		fantasy                *int
		maxTickerRows          int
		maxTickerCustomization bool
	}{
		// Per-feature depth caps retired 2026-07-02 — nil (unlimited) on every
		// tier. Only max_widgets (slot lever) + ticker rows still vary.
		{"free", intPtr(3), nil, nil, nil, nil, nil, 1, false},
		{"uplink", intPtr(6), nil, nil, nil, nil, nil, 2, false},
		{"uplink_pro", intPtr(12), nil, nil, nil, nil, nil, 3, false},
		{"uplink_ultimate", nil, nil, nil, nil, nil, nil, 3, true},
		{"super_user", nil, nil, nil, nil, nil, nil, 3, true},
	}

	for _, c := range cases {
		got, ok := DefaultTierLimits[c.tier]
		if !ok {
			t.Errorf("missing tier: %q", c.tier)
			continue
		}
		assertIntPtrEq(t, c.tier+".max_widgets", c.maxWidgets, got.MaxWidgets)
		assertIntPtrEq(t, c.tier+".symbols", c.symbols, got.Symbols)
		assertIntPtrEq(t, c.tier+".feeds", c.feeds, got.Feeds)
		assertIntPtrEq(t, c.tier+".custom_feeds", c.customFeeds, got.CustomFeeds)
		assertIntPtrEq(t, c.tier+".leagues", c.leagues, got.Leagues)
		assertIntPtrEq(t, c.tier+".fantasy", c.fantasy, got.Fantasy)
		if got.MaxTickerRows != c.maxTickerRows {
			t.Errorf("%s.max_ticker_rows: want %d, got %d", c.tier, c.maxTickerRows, got.MaxTickerRows)
		}
		if got.MaxTickerCustomization != c.maxTickerCustomization {
			t.Errorf("%s.max_ticker_customization: want %v, got %v", c.tier, c.maxTickerCustomization, got.MaxTickerCustomization)
		}
	}

	if len(DefaultTierLimits) != len(cases) {
		t.Errorf("DefaultTierLimits has %d tiers, expected %d — did you add a tier without updating this test?",
			len(DefaultTierLimits), len(cases))
	}
}

// TestTierLimitsJSONShape confirms JSON serialization renders missing caps
// as `null` (not `0`, which would mean "zero of this resource"). Both
// clients rely on this distinction.
func TestTierLimitsJSONShape(t *testing.T) {
	resp := TierLimitsResponse{Tiers: DefaultTierLimits}
	b, err := json.Marshal(resp)
	if err != nil {
		t.Fatalf("json.Marshal: %v", err)
	}
	var parsed map[string]map[string]map[string]any
	if err := json.Unmarshal(b, &parsed); err != nil {
		t.Fatalf("json.Unmarshal round-trip: %v", err)
	}

	ult, ok := parsed["tiers"]["uplink_ultimate"]
	if !ok {
		t.Fatal("uplink_ultimate missing from JSON")
	}
	if ult["symbols"] != nil {
		t.Errorf("uplink_ultimate.symbols = %v (want null)", ult["symbols"])
	}
	// Depth caps are retired → null on every tier.
	if ult["custom_feeds"] != nil {
		t.Errorf("uplink_ultimate.custom_feeds = %v (want null)", ult["custom_feeds"])
	}

	free := parsed["tiers"]["free"]
	if free["symbols"] != nil {
		t.Errorf("free.symbols = %v (want null)", free["symbols"])
	}

	// max_widgets must round-trip: a finite slot cap on free, null
	// (unlimited) on the top tiers.
	if got, ok := free["max_widgets"].(float64); !ok || got != 3 {
		t.Errorf("free.max_widgets = %v (want 3)", free["max_widgets"])
	}
	if ult["max_widgets"] != nil {
		t.Errorf("uplink_ultimate.max_widgets = %v (want null)", ult["max_widgets"])
	}
}

func assertIntPtrEq(t *testing.T, label string, want, got *int) {
	t.Helper()
	if want == nil && got == nil {
		return
	}
	if want == nil || got == nil {
		t.Errorf("%s: want %v, got %v (one is nil)", label, derefOr(want, "nil"), derefOr(got, "nil"))
		return
	}
	if *want != *got {
		t.Errorf("%s: want %d, got %d", label, *want, *got)
	}
}

func derefOr(p *int, fallback string) any {
	if p == nil {
		return fallback
	}
	return *p
}

// TestTierLimitError_UserFacingMessage sanity-checks the copy path the
// handler renders into 403 bodies.
func TestTierLimitError_UserFacingMessage(t *testing.T) {
	e := &TierLimitError{
		Tier: "free", WidgetType: "finance", Field: "symbols", Limit: 5, Got: 12,
	}
	got := e.UserFacingMessage()
	want := "Your Free plan allows 5 symbols; you tried to save 12."
	if got != want {
		t.Errorf("UserFacingMessage:\n got:  %q\n want: %q", got, want)
	}
}

// ─── partitionWidgetsForCap (downgrade slot prune) ───────────────────

// TestPartitionWidgetsForCap covers the selection logic of the downgrade
// prune: keep the oldest enabled widgets up to the slot cap, mark the
// newest overflow for disabling, and never touch already-disabled rows.
func TestPartitionWidgetsForCap(t *testing.T) {
	w := func(name string, enabled bool) platform.Widget {
		return platform.Widget{WidgetType: name, Enabled: enabled}
	}
	// created_at ASC order, matching GetUserWidgets.
	channels := []platform.Widget{
		w("sports_nfl", true),
		w("finance_stocks", true),
		w("news_bbc", false), // user-disabled — passes through untouched
		w("sports_nba", true),
		w("predictions", true),
		w("fantasy_yahoo", true),
	}

	kept, pruned := partitionWidgetsForCap(channels, 3)

	wantKept := []string{"sports_nfl", "finance_stocks", "sports_nba"}
	wantPruned := []string{"predictions", "fantasy_yahoo"}
	if got := widgetNames(kept); !equalStrings(got, wantKept) {
		t.Errorf("kept = %v, want %v", got, wantKept)
	}
	if got := widgetNames(pruned); !equalStrings(got, wantPruned) {
		t.Errorf("pruned = %v, want %v", got, wantPruned)
	}
}

// TestPartitionWidgetsForCap_UnderCap — nothing to prune when the user
// fits their slots (the upgrade / no-op path).
func TestPartitionWidgetsForCap_UnderCap(t *testing.T) {
	channels := []platform.Widget{
		{WidgetType: "sports_nfl", Enabled: true},
		{WidgetType: "news_bbc", Enabled: true},
	}
	kept, pruned := partitionWidgetsForCap(channels, 3)
	if len(kept) != 2 || len(pruned) != 0 {
		t.Errorf("kept=%d pruned=%d, want kept=2 pruned=0", len(kept), len(pruned))
	}
}

func widgetNames(chs []platform.Widget) []string {
	names := make([]string, len(chs))
	for i, ch := range chs {
		names[i] = ch.WidgetType
	}
	return names
}

func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
