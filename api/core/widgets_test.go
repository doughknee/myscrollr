package core

import "testing"

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
		{"news", "rss"},
		{"news_bbc", "rss"},
		{"news_hackernews", "rss"},
		{"rss_custom", "rss"},
		{"fantasy_yahoo", "fantasy"},
		{"predictions", "predictions"},
		// Dynamic via source prefix (league not in the featured set).
		{"sports_premier_league", "sports"},
		{"finance_forex", "finance"},
		{"fantasy_espn", "fantasy"},
		// Legacy coarse types map to themselves.
		{"finance", "finance"},
		{"sports", "sports"},
		{"rss", "rss"},
		{"fantasy", "fantasy"},
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
		"sports_nfl", "finance_stocks", "finance_crypto", "news",
		"news_bbc", "rss_custom",
		"fantasy_yahoo", "predictions", "clock", "github",
		"sports_premier_league", // dynamic league
		"finance", "sports", "rss", "fantasy", // legacy coarse
	}
	for _, w := range known {
		if !IsKnownWidgetType(w) {
			t.Errorf("IsKnownWidgetType(%q) = false, want true", w)
		}
	}

	unknown := []string{"sports_", "", "garbage", "finance_"}
	for _, w := range unknown {
		if IsKnownWidgetType(w) {
			t.Errorf("IsKnownWidgetType(%q) = true, want false", w)
		}
	}
}
