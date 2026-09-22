package ingestread

import (
	"context"
	"testing"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/brandon-relentnet/myscrollr/api/internal/testsupport"
)

func TestParsePinnedSubjects(t *testing.T) {
	for _, tc := range []struct {
		name string
		raw  string
		want map[string][]string
	}{
		{"empty", "", nil},
		{"garbage", "not json", nil},
		{"wrong shape", `{"sports":"x"}`, nil},
		{
			"two sources",
			`[["sports","Milwaukee Brewers"],["finance","AAPL"]]`,
			map[string][]string{"sports": {"Milwaukee Brewers"}, "finance": {"AAPL"}},
		},
		{
			// A feed URL is a subject, which is why the wire format is
			// JSON rather than a delimited string.
			"feed url subject",
			`[["rss","https://example.com/feed?a=1,2"]]`,
			map[string][]string{"rss": {"https://example.com/feed?a=1,2"}},
		},
		{"unknown source dropped", `[["weather","Berlin"],["finance","MSFT"]]`,
			map[string][]string{"finance": {"MSFT"}}},
		{"empty subject dropped", `[["finance",""]]`, nil},
		{"duplicate collapsed", `[["finance","AAPL"],["finance","AAPL"]]`,
			map[string][]string{"finance": {"AAPL"}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := ParsePinnedSubjects(tc.raw)
			if len(got) != len(tc.want) {
				t.Fatalf("got %v, want %v", got, tc.want)
			}
			for source, subjects := range tc.want {
				if len(got[source]) != len(subjects) {
					t.Fatalf("source %s: got %v, want %v", source, got[source], subjects)
				}
				for i, s := range subjects {
					if got[source][i] != s {
						t.Fatalf("source %s[%d]: got %q, want %q", source, i, got[source][i], s)
					}
				}
			}
		})
	}
}

// A hand-rolled request must not be able to turn one poll into an
// unbounded fan of per-subject queries.
func TestParsePinnedSubjectsCapsCount(t *testing.T) {
	raw := `[["finance","A"],["finance","B"],["finance","C"],["finance","D"],["finance","E"],["finance","F"]]`
	got := ParsePinnedSubjects(raw)
	if n := len(got["finance"]); n != MaxPinnedSubjects {
		t.Fatalf("kept %d subjects, want %d", n, MaxPinnedSubjects)
	}
}

func TestRowsHaveSubject(t *testing.T) {
	rows := []interface{}{
		map[string]interface{}{"home_team_name": "Cubs", "away_team_name": "Brewers"},
		"not a row",
	}
	fields := pinSubjectFields["sports"]
	// A game is about both teams -- pinning the away side counts.
	if !rowsHaveSubject(rows, fields, "Brewers") {
		t.Error("away team should count as carried")
	}
	if !rowsHaveSubject(rows, fields, "Cubs") {
		t.Error("home team should count as carried")
	}
	if rowsHaveSubject(rows, fields, "Reds") {
		t.Error("absent team reported as carried")
	}
}

// A source the user does not have gets no section in the payload, and a
// pin for it must not conjure one.
func TestMergePinnedRowsSkipsAbsentSection(t *testing.T) {
	data := map[string]interface{}{"finance": []interface{}{}}
	MergePinnedRows(context.Background(), "nobody",
		map[string][]string{"rss": {"https://example.com/feed"}}, data)
	if _, ok := data["rss"]; ok {
		t.Fatal("merged a section the user does not have")
	}
}

// The point of SCROLLR-9: a pinned team whose only fixture is far past
// the dashboard's horizon still reaches the payload.
func TestPinnedGameIgnoresHorizon(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	ctx := context.Background()
	const league = "PinTestLeague"
	clean := func() {
		_, _ = platform.DBPool.Exec(ctx, `DELETE FROM games WHERE league = $1`, league)
	}
	clean()
	defer clean()

	if _, err := platform.DBPool.Exec(ctx, `
		INSERT INTO games (league, external_game_id, home_team_name, away_team_name, start_time, state)
		VALUES ($1, 'pin-far', 'Milwaukee Brewers', 'Chicago Cubs', $2, 'pre')`,
		league, time.Now().Add(40*24*time.Hour)); err != nil {
		t.Fatalf("insert game: %v", err)
	}

	got := pinnedGame(ctx, []string{league}, "Milwaukee Brewers")
	if got == nil {
		t.Fatal("pinned team 40 days out resolved to nothing")
	}
	game, ok := got.(Game)
	if !ok || game.HomeTeamName != "Milwaukee Brewers" {
		t.Fatalf("got %#v", got)
	}

	// Truly empty stays empty: no placeholder row is invented (§8.5).
	if pinnedGame(ctx, []string{league}, "Cincinnati Reds") != nil {
		t.Error("a team with no fixture produced a row")
	}
	// And a pin cannot widen the payload past the user's own leagues.
	if pinnedGame(ctx, []string{"SomeOtherLeague"}, "Milwaukee Brewers") != nil {
		t.Error("pinned team resolved outside the user's leagues")
	}
}

// Live beats the next fixture, which beats the last result.
func TestPinnedGamePrefersLive(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	ctx := context.Background()
	const league = "PinTestOrderLeague"
	clean := func() {
		_, _ = platform.DBPool.Exec(ctx, `DELETE FROM games WHERE league = $1`, league)
	}
	clean()
	defer clean()

	for _, g := range []struct {
		ext    string
		offset time.Duration
		state  string
	}{
		{"pin-final", -30 * 24 * time.Hour, "final"},
		{"pin-pre", 10 * 24 * time.Hour, "pre"},
		{"pin-live", -1 * time.Hour, "in"},
	} {
		if _, err := platform.DBPool.Exec(ctx, `
			INSERT INTO games (league, external_game_id, home_team_name, away_team_name, start_time, state)
			VALUES ($1, $2, 'Milwaukee Brewers', 'Away', $3, $4)`,
			league, g.ext, time.Now().Add(g.offset), g.state); err != nil {
			t.Fatalf("insert %s: %v", g.ext, err)
		}
	}

	game, ok := pinnedGame(ctx, []string{league}, "Milwaukee Brewers").(Game)
	if !ok || game.ExternalGameID != "pin-live" {
		t.Fatalf("got %v, want the live game", game.ExternalGameID)
	}

	// With the live game gone, the next fixture wins over the old final.
	if _, err := platform.DBPool.Exec(ctx,
		`DELETE FROM games WHERE league = $1 AND external_game_id = 'pin-live'`, league); err != nil {
		t.Fatalf("delete live: %v", err)
	}
	game, ok = pinnedGame(ctx, []string{league}, "Milwaukee Brewers").(Game)
	if !ok || game.ExternalGameID != "pin-pre" {
		t.Fatalf("got %v, want the next fixture", game.ExternalGameID)
	}
}
