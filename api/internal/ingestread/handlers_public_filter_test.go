package ingestread

import (
	"slices"
	"strings"
	"testing"
)

// TestPublicFeedWidgetsNormalizes pins SCROLLR-315's cache key: the same
// set in any order, repeated or padded with unknown and utility ids, is one
// key; nothing usable is the full feed; the list is capped.
func TestPublicFeedWidgetsNormalizes(t *testing.T) {
	want := []string{"finance_stocks", "news_npr", "sports_nfl"}
	for _, raw := range []string{
		"sports_nfl,news_npr,finance_stocks",
		" news_npr ,finance_stocks,sports_nfl,news_npr,clock,bogus,,",
	} {
		if got := publicFeedWidgets(raw); !slices.Equal(got, want) {
			t.Errorf("publicFeedWidgets(%q) = %v, want %v", raw, got, want)
		}
	}
	for _, raw := range []string{"", "clock,github", "nope"} {
		if got := publicFeedWidgets(raw); len(got) != 0 {
			t.Errorf("publicFeedWidgets(%q) = %v, want none (the full feed)", raw, got)
		}
	}
	many := "sports_nfl,sports_nba,sports_nhl,sports_mlb,sports_f1,sports_ncaaf,sports_ncaab,sports_mls," +
		"sports_ufc,sports_afl,sports_khl,sports_npb,news_npr,news_bbc"
	if got := publicFeedWidgets(many); len(got) != PublicFeedMaxWidgets {
		t.Errorf("%d ids kept, want the cap %d", len(got), PublicFeedMaxWidgets)
	}
}

// TestPublicFeedFilterKeepsWhatTheWidgetsShow: a sports widget keeps its
// league (games and meta), a news widget its feed, a finance widget its
// starter symbols plus its asset class's page fill, and nothing else.
func TestPublicFeedFilterKeepsWhatTheWidgetsShow(t *testing.T) {
	f := newPublicFeedFilter(publicFeedWidgets("sports_nfl,news_npr,finance_stocks"))

	trades := []Trade{{Symbol: "AAPL"}, {Symbol: "XOM"}, {Symbol: "ZZZZ"}, {Symbol: "BTC/USD"}}
	var syms []string
	for _, tr := range f.finance(trades) {
		syms = append(syms, tr.Symbol)
	}
	if !slices.Equal(syms, []string{"AAPL", "XOM"}) {
		t.Errorf("finance kept %v, want [AAPL XOM]: the starter list plus the stock fill, no crypto", syms)
	}

	s := f.sports(SportsResponse{
		Sports: []Game{{League: "NFL"}, {League: "NCAA Football"}, {League: "NFL"}},
		Meta:   SportsMeta{Leagues: []LeagueMeta{{Name: "NFL"}, {Name: "NCAA Football"}}},
	})
	if len(s.Sports) != 2 || len(s.Meta.Leagues) != 1 || s.Meta.Leagues[0].Name != "NFL" {
		t.Errorf("sports kept %d games and leagues %v, want 2 NFL games and [NFL]", len(s.Sports), s.Meta.Leagues)
	}

	if urls := f.feedURLs(); len(urls) != 1 || !strings.Contains(urls[0], "npr.org") {
		t.Errorf("rss feeds = %v, want NPR's only", urls)
	}
}
