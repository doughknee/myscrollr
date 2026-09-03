package ingestread

// Ported from channels/sports/api/sports_test.go when the sports source
// was folded into core (ADR-0002, REL-15).

import (
	"context"
	"testing"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
)

func TestFairShareSideSplit(t *testing.T) {
	tests := []struct {
		perLeague, wantUp, wantDown int
	}{
		{60, 30, 30}, // single-league widget at the dashboard limit
		{10, 5, 5},   // six leagues at limit 60
		{5, 3, 2},    // odd share — the extra slot goes to upcoming
		{3, 2, 1},
		{2, 1, 1}, // MinPerLeagueShare floor — both sides stay visible
		{1, 1, 0}, // degenerate: upcoming wins the only slot
	}
	for _, tt := range tests {
		up, down := fairShareSideSplit(tt.perLeague)
		if up != tt.wantUp || down != tt.wantDown {
			t.Errorf("fairShareSideSplit(%d) = (%d, %d), want (%d, %d)",
				tt.perLeague, up, down, tt.wantUp, tt.wantDown)
		}
		if up+down != tt.perLeague {
			t.Errorf("fairShareSideSplit(%d): sides sum to %d, must equal the share",
				tt.perLeague, up+down)
		}
	}
}

func TestExtractFavoriteTeamsFromConfig(t *testing.T) {
	got := extractFavoriteTeamsFromConfig([]byte(`{"favoriteTeams":{"NFL":{"teamId":12,"teamName":"Kansas City Chiefs"}}}`))
	if len(got) != 1 || got["NFL"].TeamName != "Kansas City Chiefs" || got["NFL"].TeamID != 12 {
		t.Fatalf("extractFavoriteTeamsFromConfig = %v", got)
	}
	if extractFavoriteTeamsFromConfig(nil) != nil {
		t.Error("nil config should return nil")
	}
	if extractFavoriteTeamsFromConfig([]byte(`not json`)) != nil {
		t.Error("invalid JSON should return nil")
	}

	names := extractFavoriteTeamNames(got)
	if len(names) != 1 || names[0] != "Kansas City Chiefs" {
		t.Errorf("extractFavoriteTeamNames = %v", names)
	}
	if n := extractFavoriteTeamNames(nil); len(n) != 0 {
		t.Errorf("extractFavoriteTeamNames(nil) = %v, want empty", n)
	}
}

// TestStaleUpcomingGamesAreNotServed pins the read-side guard for games left
// marked 'pre' after their start time has passed.
//
// They are not hypothetical: poll_schedule reads only today..+7, so any
// fixture that drifts out of that window is never re-read to be marked final
// and sits as "upcoming" for the 7 days until cleanup_old_games removes it.
// Production had 33 across five leagues when REL-152 was filed; the August
// seed snapshot carried 63. Because every ordering here puts 'pre' ahead of
// finals and sorts it by start_time ASC, one stale row sorts to the FRONT of
// upcoming and a finished game is presented as the next one to watch.
func TestStaleUpcomingGamesAreNotServed(t *testing.T) {
	if platform.DBPool == nil {
		t.Skip("needs TEST_DATABASE_URL")
	}
	ctx := context.Background()
	const league = "TestStaleLeague"
	defer func() {
		_, _ = platform.DBPool.Exec(ctx, `DELETE FROM games WHERE league = $1`, league)
	}()
	_, _ = platform.DBPool.Exec(ctx, `DELETE FROM games WHERE league = $1`, league)

	// Three rows: one stale, one genuinely upcoming, and one that started
	// 30 minutes ago and has not been polled to 'in' yet. The last must
	// survive -- a guard that drops it would blank out live games.
	for _, g := range []struct {
		ext    string
		offset time.Duration
	}{
		{"stale", -72 * time.Hour},
		{"future", 48 * time.Hour},
		{"just-started", -30 * time.Minute},
	} {
		if _, err := platform.DBPool.Exec(ctx, `
			INSERT INTO games (league, external_game_id, home_team_name, away_team_name, start_time, state)
			VALUES ($1, $2, 'Home', 'Away', $3, 'pre')`,
			league, g.ext, time.Now().Add(g.offset),
		); err != nil {
			t.Fatalf("insert %s: %v", g.ext, err)
		}
	}

	games, err := queryGamesByLeagues(ctx, []string{league}, 50, nil, false)
	if err != nil {
		t.Fatalf("queryGamesByLeagues: %v", err)
	}
	got := make(map[string]bool, len(games))
	for _, g := range games {
		got[g.ExternalGameID] = true
	}
	if got["stale"] {
		t.Error("a 3-day-old 'pre' game was served as upcoming; it sorts ahead of every real fixture")
	}
	if !got["future"] {
		t.Error("a genuinely upcoming game was dropped")
	}
	if !got["just-started"] {
		t.Error("a game that kicked off 30 minutes ago was dropped — the guard is too aggressive " +
			"and would blank out fixtures during the gap before polling marks them live")
	}

	// The same staleness must reach LeagueMeta.NextGame, which the desktop
	// empty state reads to say when a league returns. Unfiltered it is
	// MIN(start_time) over 'pre' rows, so the stale row would make it name
	// a date in the PAST.
	meta := loadLeagueMeta(ctx, []string{league})
	for _, m := range meta {
		if m.NextGame != nil && m.NextGame.Before(time.Now()) {
			t.Errorf("next_game is in the past (%s) — the empty state would say a league returns on a date that has been and gone", m.NextGame)
		}
	}
}
