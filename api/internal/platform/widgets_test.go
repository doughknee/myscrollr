package platform

import "testing"

// The catalog is the single authority clients render from (VISION §4.2), so
// a malformed entry is a client-wide bug. Check the invariants the client
// relies on: unique ids, a renderer key for every data widget, none for
// utilities, and identity fields actually filled in.
func TestCatalogIsWellFormed(t *testing.T) {
	seen := map[string]bool{}
	for i, w := range Catalog() {
		if w.ID == "" || w.Name == "" || w.Description == "" || w.Color == "" || w.Category == "" {
			t.Errorf("catalog[%d] (%q): identity field empty: %+v", i, w.ID, w)
		}
		// Slots are the only price lever, so every widget is available on
		// every plan — but the field must still be populated, since clients
		// gate the Add button on it.
		if w.RequiredTier == "" {
			t.Errorf("catalog %q: RequiredTier empty", w.ID)
		}
		if seen[w.ID] {
			t.Errorf("catalog: duplicate id %q", w.ID)
		}
		seen[w.ID] = true

		if w.Order != i {
			t.Errorf("catalog[%d] (%q): Order = %d, want %d", i, w.ID, w.Order, i)
		}

		switch w.Kind {
		case WidgetData:
			// Source is the renderer key AND the CDC route; without it the
			// widget cannot render or receive data.
			if w.Source == "" {
				t.Errorf("catalog %q: data widget has no source", w.ID)
			}
			if got := DataSourceForWidget(w.ID); got != w.Source {
				t.Errorf("catalog %q: DataSourceForWidget = %q, want %q", w.ID, got, w.Source)
			}
		case WidgetUtility:
			if w.Source != "" {
				t.Errorf("catalog %q: utility must have no source, got %q", w.ID, w.Source)
			}
			if !IsUtilityWidgetType(w.ID) {
				t.Errorf("catalog %q: not reported as a utility", w.ID)
			}
		default:
			t.Errorf("catalog %q: unknown kind %q", w.ID, w.Kind)
		}

		if !IsKnownWidgetType(w.ID) {
			t.Errorf("catalog %q: not accepted by IsKnownWidgetType", w.ID)
		}
	}
}

func TestDataSourceForWidget(t *testing.T) {
	cases := []struct {
		widget string
		want   string
	}{
		// Featured widgets.
		{"sports_nfl", "sports"},
		{"sports_mlb", "sports"},
		{"finance_stocks", "finance"},
		{"finance_crypto", "finance"},
		{"news_bbc", "rss"},
		{"news_hackernews", "rss"},
		{"rss_custom", "rss"},
		{"fantasy_yahoo", "fantasy"},
		{"predictions", "predictions"},
		// Dynamic via source prefix (an id the catalog doesn't enumerate).
		{"sports_premier_league", "sports"},
		{"finance_forex", "finance"},
		{"fantasy_espn", "fantasy"},
		// The pre-split coarse types are gone (VISION §7.10): the catalog is
		// the authority and it has no "finance"/"sports"/"news" entry, so
		// they resolve to nothing and CreateWidget rejects them.
		{"finance", ""},
		{"sports", ""},
		{"rss", ""},
		{"fantasy", ""},
		{"news", ""},
		// Utilities have no data source.
		{"clock", ""},
		{"weather", ""},
		// Unknown / bare prefix.
		{"sports_", ""},
		{"totally_unknown", ""},
		{"", ""},
	}
	for _, c := range cases {
		if got := DataSourceForWidget(c.widget); got != c.want {
			t.Errorf("DataSourceForWidget(%q) = %q, want %q", c.widget, got, c.want)
		}
	}
}

func TestIsKnownWidgetType(t *testing.T) {
	known := []string{
		"sports_nfl", "finance_stocks", "finance_crypto",
		"news_bbc", "rss_custom",
		"fantasy_yahoo", "predictions", "clock", "github",
		"sports_premier_league", // dynamic league, resolved by prefix
	}
	for _, w := range known {
		if !IsKnownWidgetType(w) {
			t.Errorf("IsKnownWidgetType(%q) = false, want true", w)
		}
	}

	// Pre-split coarse types are no longer valid widget ids.
	unknown := []string{"sports_", "", "garbage", "finance_", "finance", "sports", "news"}
	for _, w := range unknown {
		if IsKnownWidgetType(w) {
			t.Errorf("IsKnownWidgetType(%q) = true, want false", w)
		}
	}
}
