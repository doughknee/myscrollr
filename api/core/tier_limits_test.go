package core

import (
	"encoding/json"
	"errors"
	"fmt"
	"testing"
	"time"
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
		symbols                *int
		feeds                  *int
		customFeeds            *int
		leagues                *int
		fantasy                *int
		maxTickerRows          int
		maxTickerCustomization bool
	}{
		{"free", intPtr(5), intPtr(1), intPtr(0), intPtr(1), intPtr(0), 1, false},
		{"uplink", intPtr(25), intPtr(25), intPtr(1), intPtr(8), intPtr(1), 2, false},
		{"uplink_pro", intPtr(75), intPtr(100), intPtr(3), intPtr(20), intPtr(3), 3, false},
		{"uplink_ultimate", nil, nil, intPtr(10), nil, intPtr(10), 3, true},
		{"super_user", nil, nil, nil, nil, nil, 3, true},
	}

	for _, c := range cases {
		got, ok := DefaultTierLimits[c.tier]
		if !ok {
			t.Errorf("missing tier: %q", c.tier)
			continue
		}
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
	if got, ok := ult["custom_feeds"].(float64); !ok || got != 10 {
		t.Errorf("uplink_ultimate.custom_feeds = %v (want 10)", ult["custom_feeds"])
	}

	free := parsed["tiers"]["free"]
	if got, ok := free["symbols"].(float64); !ok || got != 5 {
		t.Errorf("free.symbols = %v (want 5)", free["symbols"])
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

// ─── ValidateChannelConfig ──────────────────────────────────────────

// Helper: build a finance config with N symbols.
func financeCfg(n int) map[string]any {
	syms := make([]any, n)
	for i := range syms {
		syms[i] = "SYM" // duplicate strings are fine; we only count.
	}
	return map[string]any{"symbols": syms}
}

// Helper: build a sports config with N leagues.
func sportsCfg(n int) map[string]any {
	lgs := make([]any, n)
	for i := range lgs {
		lgs[i] = "NFL"
	}
	return map[string]any{"leagues": lgs}
}

// curatedFixtureURL is pinned into the curated-URL cache by
// TestValidateChannelConfig_Boundaries so is_custom derivation is
// deterministic (see pinCuratedFixture).
const curatedFixtureURL = "https://curated.example.com/feed"

// Helper: build an RSS config with `total` feeds where `custom` of them are
// user-added. Custom feeds get distinct non-curated URLs so the server-side
// derivation (URL ∉ curated set → custom) classifies them the same way the
// client-asserted flag does.
func rssCfg(total, custom int) map[string]any {
	feeds := make([]any, total)
	for i := range feeds {
		m := map[string]any{"name": "F", "url": curatedFixtureURL}
		if i < custom {
			m["is_custom"] = true
			m["url"] = fmt.Sprintf("https://custom.example.com/feed/%d", i)
		}
		feeds[i] = m
	}
	return map[string]any{"feeds": feeds}
}

// pinCuratedFixture pins the curated-URL cache to exactly the fixture URL
// for the duration of the test. This makes the rss cases exercise the
// production path (server-side is_custom derivation from the curated
// catalog) identically in unit mode (no DB → cache would be nil and fall
// back to client trust) and integration mode (DB present but tracked_feeds
// empty → every URL would look custom).
func pinCuratedFixture(t *testing.T) {
	t.Helper()
	curatedFeedURLsMu.Lock()
	prevCache, prevExpires := curatedFeedURLsCache, curatedFeedURLsExpires
	curatedFeedURLsCache = map[string]bool{curatedFixtureURL: true}
	curatedFeedURLsExpires = time.Now().Add(time.Hour)
	curatedFeedURLsMu.Unlock()
	t.Cleanup(func() {
		curatedFeedURLsMu.Lock()
		curatedFeedURLsCache, curatedFeedURLsExpires = prevCache, prevExpires
		curatedFeedURLsMu.Unlock()
	})
}

// TestValidateChannelConfig_Boundaries confirms that exactly-at-limit is
// accepted and one-over is rejected for every enforced channel/tier pair.
func TestValidateChannelConfig_Boundaries(t *testing.T) {
	pinCuratedFixture(t)
	cases := []struct {
		name        string
		tier        string
		channelType string
		config      map[string]any
		wantField   string // empty = no error expected
	}{
		// Finance — symbols
		{"free finance at cap", "free", "finance", financeCfg(5), ""},
		{"free finance over cap", "free", "finance", financeCfg(6), "symbols"},
		{"uplink finance at cap", "uplink", "finance", financeCfg(25), ""},
		{"uplink finance over cap", "uplink", "finance", financeCfg(26), "symbols"},
		{"ultimate finance unlimited", "uplink_ultimate", "finance", financeCfg(10000), ""},
		{"super_user finance unlimited", "super_user", "finance", financeCfg(100000), ""},

		// Sports — leagues
		{"free sports at cap", "free", "sports", sportsCfg(1), ""},
		{"free sports over cap", "free", "sports", sportsCfg(2), "leagues"},
		{"pro sports at cap", "uplink_pro", "sports", sportsCfg(20), ""},
		{"pro sports over cap", "uplink_pro", "sports", sportsCfg(21), "leagues"},

		// RSS — feeds + custom_feeds
		{"free rss at feed cap, no custom", "free", "rss", rssCfg(1, 0), ""},
		{"free rss over feed cap", "free", "rss", rssCfg(2, 0), "feeds"},
		{"free rss 1 custom forbidden", "free", "rss", rssCfg(1, 1), "custom_feeds"},
		{"uplink rss at custom cap", "uplink", "rss", rssCfg(2, 1), ""},
		{"uplink rss over custom cap", "uplink", "rss", rssCfg(3, 2), "custom_feeds"},
		{"pro rss under feed cap, over custom", "uplink_pro", "rss", rssCfg(10, 4), "custom_feeds"},
		{"pro rss at custom cap, over feed cap", "uplink_pro", "rss", rssCfg(101, 3), "feeds"},
		{"ultimate rss unlimited feeds", "uplink_ultimate", "rss", rssCfg(5000, 10), ""},
		{"ultimate rss at custom cap", "uplink_ultimate", "rss", rssCfg(5000, 10), ""},
		{"ultimate rss over custom cap", "uplink_ultimate", "rss", rssCfg(5000, 11), "custom_feeds"},

		// Empty config is always valid (first create).
		{"free finance empty", "free", "finance", map[string]any{}, ""},
		{"free rss empty", "free", "rss", map[string]any{}, ""},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			err := ValidateChannelConfig(c.tier, c.channelType, c.config)
			if c.wantField == "" {
				if err != nil {
					t.Errorf("want nil, got %v", err)
				}
				return
			}
			if err == nil {
				t.Errorf("want error on %s, got nil", c.wantField)
				return
			}
			var tle *TierLimitError
			if !errors.As(err, &tle) {
				t.Errorf("want *TierLimitError, got %T: %v", err, err)
				return
			}
			if tle.Field != c.wantField {
				t.Errorf("field: want %q, got %q", c.wantField, tle.Field)
			}
			if tle.Tier != c.tier {
				t.Errorf("tier: want %q, got %q", c.tier, tle.Tier)
			}
		})
	}
}

// TestValidateChannelConfig_UnknownTierFallsBackToFree guards against JWTs
// with unknown role names leaking elevated privileges.
func TestValidateChannelConfig_UnknownTierFallsBackToFree(t *testing.T) {
	err := ValidateChannelConfig("bogus_tier", "finance", financeCfg(6))
	if err == nil {
		t.Fatal("want error, got nil")
	}
	var tle *TierLimitError
	if !errors.As(err, &tle) {
		t.Fatalf("want *TierLimitError, got %T", err)
	}
	if tle.Tier != "free" {
		t.Errorf("tier: want %q (fallback), got %q", "free", tle.Tier)
	}
	if tle.Limit != 5 {
		t.Errorf("limit: want 5 (free cap), got %d", tle.Limit)
	}
}

// TestValidateChannelConfig_UnknownChannelPasses protects the dynamic
// channel registry: new channels can roll out without this validator
// being the thing that blocks them.
func TestValidateChannelConfig_UnknownChannelPasses(t *testing.T) {
	err := ValidateChannelConfig("free", "future_channel", map[string]any{"whatever": 1})
	if err != nil {
		t.Errorf("want nil, got %v", err)
	}
}

// TestTierLimitError_UserFacingMessage sanity-checks the copy path the
// handler renders into 403 bodies.
func TestTierLimitError_UserFacingMessage(t *testing.T) {
	e := &TierLimitError{
		Tier: "free", ChannelType: "finance", Field: "symbols", Limit: 5, Got: 12,
	}
	got := e.UserFacingMessage()
	want := "Your Free plan allows 5 symbols; you tried to save 12."
	if got != want {
		t.Errorf("UserFacingMessage:\n got:  %q\n want: %q", got, want)
	}
}

// ─── PruneChannelConfig ──────────────────────────────────────────────

// TestPruneChannelConfig_FinanceTrimsToSymbolCap — ultimate → pro loses
// everything over 75.
func TestPruneChannelConfig_FinanceTrimsToSymbolCap(t *testing.T) {
	cfg := financeCfg(200)
	out, report := PruneChannelConfig("uplink_pro", "finance", cfg)
	if got := len(out["symbols"].([]any)); got != 75 {
		t.Errorf("symbols after prune: want 75, got %d", got)
	}
	if report.SymbolsBefore != 200 || report.SymbolsAfter != 75 {
		t.Errorf("report: want 200→75, got %d→%d", report.SymbolsBefore, report.SymbolsAfter)
	}
	if !report.Changed() {
		t.Error("report should register a change")
	}
}

// TestPruneChannelConfig_UltimateIsNoOp — no cap ⇒ no prune.
func TestPruneChannelConfig_UltimateIsNoOp(t *testing.T) {
	cfg := financeCfg(500)
	out, report := PruneChannelConfig("uplink_ultimate", "finance", cfg)
	if got := len(out["symbols"].([]any)); got != 500 {
		t.Errorf("symbols after prune: want 500 (unchanged), got %d", got)
	}
	if report.Changed() {
		t.Error("ultimate tier should not register any change")
	}
}

// TestPruneChannelConfig_RSS_CustomFirst — when both caps would trip,
// the pruner drops custom feeds first (they're the scarcer resource)
// then trims the remaining pool by the total cap.
func TestPruneChannelConfig_RSS_CustomFirst(t *testing.T) {
	// Pro tier: feeds=100, custom_feeds=3. Input has 110 feeds, 5 custom.
	cfg := rssCfg(110, 5)
	out, report := PruneChannelConfig("uplink_pro", "rss", cfg)

	feeds := out["feeds"].([]any)
	if len(feeds) != 100 {
		t.Errorf("feeds after prune: want 100, got %d", len(feeds))
	}
	customKept := 0
	for _, f := range feeds {
		m := f.(map[string]any)
		if v, _ := m["is_custom"].(bool); v {
			customKept++
		}
	}
	if customKept != 3 {
		t.Errorf("custom feeds kept: want 3, got %d", customKept)
	}
	if report.FeedsBefore != 110 || report.FeedsAfter != 100 ||
		report.CustomFeedsBefore != 5 || report.CustomFeedsAfter != 3 {
		t.Errorf("report mismatch: %+v", report)
	}
}

// TestPruneChannelConfig_FreeRSSDropsAllCustom — free allows 0 custom.
func TestPruneChannelConfig_FreeRSSDropsAllCustom(t *testing.T) {
	cfg := rssCfg(1, 1) // 1 custom feed only
	out, _ := PruneChannelConfig("free", "rss", cfg)
	feeds := out["feeds"].([]any)
	if len(feeds) != 0 {
		t.Errorf("free tier should drop the 1 custom feed (cap 0); got %d feeds", len(feeds))
	}
}

// TestPruneChannelConfig_SportsLeaguesTrim — ultimate → free drops to 1.
func TestPruneChannelConfig_SportsLeaguesTrim(t *testing.T) {
	cfg := sportsCfg(10)
	out, report := PruneChannelConfig("free", "sports", cfg)
	if got := len(out["leagues"].([]any)); got != 1 {
		t.Errorf("leagues after prune: want 1, got %d", got)
	}
	if report.LeaguesBefore != 10 || report.LeaguesAfter != 1 {
		t.Errorf("report: want 10→1, got %d→%d", report.LeaguesBefore, report.LeaguesAfter)
	}
}

// TestPruneChannelConfig_UnknownChannelNoOp — don't touch configs we
// don't understand.
func TestPruneChannelConfig_UnknownChannelNoOp(t *testing.T) {
	cfg := map[string]any{"custom_array": []any{"a", "b", "c"}}
	out, report := PruneChannelConfig("free", "future_channel", cfg)
	if got, ok := out["custom_array"].([]any); !ok || len(got) != 3 {
		t.Errorf("unknown channel config should pass through; got %v", out)
	}
	if report.Changed() {
		t.Error("unknown channel should not register any change")
	}
}
