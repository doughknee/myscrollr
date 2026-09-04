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
		{5, 3, 2},    // odd share â€” the extra slot goes to upcoming
		{3, 2, 1},
		{2, 1, 1}, // MinPerLeagueShare floor â€” both sides stay visible
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
		t.Error("a game that kicked off 30 minutes ago was dropped â€” the guard is too aggressive " +
			"and would blank out fixtures during the gap before polling marks them live")
	}

	// The same staleness must reach LeagueMeta.NextGame, which the desktop
	// empty state reads to say when a league returns. Unfiltered it is
	// MIN(start_time) over 'pre' rows, so the stale row would make it name
	// a date in the PAST.
	meta := loadLeagueMeta(ctx, []string{league})
	for _, m := range meta {
		if m.NextGame != nil && m.NextGame.Before(time.Now()) {
			t.Errorf("next_game is in the past (%s) â€” the empty state would say a league returns on a date that has been and gone", m.NextGame)
		}
	}
}

// TestStandingsReturnsOneSeasonPerTeam pins the season filter on the
// standings read.
//
// The table keeps history: its unique key is (league, team_name, season), so
// last season sits alongside this one by design. The query had no season
// filter, so every team came back TWICE -- a finished 38-game record
// interleaved with a 3-game one, both claiming the same rank. La Liga
// returned 40 rows for 23 teams.
func TestStandingsReturnsOneSeasonPerTeam(t *testing.T) {
	if platform.DBPool == nil {
		t.Skip("needs TEST_DATABASE_URL")
	}
	ctx := context.Background()
	const league = "TestSeasonLeague"
	clean := func() {
		_, _ = platform.DBPool.Exec(ctx, `DELETE FROM standings WHERE league = $1`, league)
	}
	clean()
	defer clean()

	for _, r := range []struct {
		team, season   string
		rank, w, l, gp int
	}{
		{"Alpha", "2025", 1, 31, 6, 38},
		{"Beta", "2025", 2, 27, 11, 38},
		{"Alpha", "2026", 2, 1, 2, 3},
		{"Beta", "2026", 1, 3, 0, 3},
	} {
		if _, err := platform.DBPool.Exec(ctx, `
			INSERT INTO standings (league, team_name, season, rank, wins, losses, draws, games_played)
			VALUES ($1, $2, $3, $4, $5, $6, 0, $7)`,
			league, r.team, r.season, r.rank, r.w, r.l, r.gp,
		); err != nil {
			t.Fatalf("insert %s/%s: %v", r.team, r.season, err)
		}
	}

	rows, err := platform.DBPool.Query(ctx, `
		SELECT team_name, season, games_played FROM standings
		WHERE league = $1
		  AND season = (SELECT max(season) FROM standings s2 WHERE s2.league = $1)
		ORDER BY COALESCE(rank, 9999) ASC`, league)
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	defer rows.Close()

	seen := map[string]int{}
	for rows.Next() {
		var team, season string
		var gp int
		if err := rows.Scan(&team, &season, &gp); err != nil {
			t.Fatalf("scan: %v", err)
		}
		seen[team]++
		if season != "2026" {
			t.Errorf("%s came back on season %q; last season's table is not the standings", team, season)
		}
		if gp != 3 {
			t.Errorf("%s shows %d games played; that is the finished season, not the current one", team, gp)
		}
	}
	if len(seen) != 2 {
		t.Fatalf("got %d teams; want 2", len(seen))
	}
	for team, n := range seen {
		if n != 1 {
			t.Errorf("%s appears %d times; a team holds one row in a table", team, n)
		}
	}
}

// TestGamesCarryCurrentSeasonStandings pins the lateral join that attaches
// each side's table row to a game -- and that it picks THIS season. A bare
// join on (league, team_name) matched both stored seasons and doubled
// every game; the lateral applies max(season) per row.
func TestGamesCarryCurrentSeasonStandings(t *testing.T) {
	if platform.DBPool == nil {
		t.Skip("needs TEST_DATABASE_URL")
	}
	ctx := context.Background()
	const league = "TestStandingsJoinLeague"
	clean := func() {
		_, _ = platform.DBPool.Exec(ctx, `DELETE FROM games WHERE league = $1`, league)
		_, _ = platform.DBPool.Exec(ctx, `DELETE FROM standings WHERE league = $1`, league)
	}
	clean()
	defer clean()

	if _, err := platform.DBPool.Exec(ctx, `
		INSERT INTO games (league, external_game_id, home_team_name, away_team_name, start_time, state)
		VALUES ($1, 'sj-1', 'Home FC', 'Away FC', $2, 'pre')`, league, time.Now().Add(2*time.Hour)); err != nil {
		t.Fatalf("insert game: %v", err)
	}
	for _, r := range []struct {
		team, season string
		rank, w, l   int
	}{
		{"Home FC", "2025", 1, 30, 4}, // last season: must NOT be attached
		{"Home FC", "2026", 3, 2, 1},  // this season
		{"Away FC", "2026", 7, 1, 2},
	} {
		if _, err := platform.DBPool.Exec(ctx, `
			INSERT INTO standings (league, team_name, season, rank, wins, losses, draws, games_played)
			VALUES ($1, $2, $3, $4, $5, $6, 0, $7)`,
			league, r.team, r.season, r.rank, r.w, r.l, r.w+r.l); err != nil {
			t.Fatalf("insert standing: %v", err)
		}
	}

	for _, fair := range []bool{false, true} {
		games, err := queryGamesByLeagues(ctx, []string{league}, 10, nil, fair)
		if err != nil {
			t.Fatalf("query (fairShare=%v): %v", fair, err)
		}
		if len(games) != 1 {
			t.Fatalf("fairShare=%v: got %d games; want 1 -- a join that matched both seasons would double it", fair, len(games))
		}
		g := games[0]
		if g.HomeStanding == nil || g.AwayStanding == nil {
			t.Fatalf("fairShare=%v: standings not attached: home=%v away=%v", fair, g.HomeStanding, g.AwayStanding)
		}
		if g.HomeStanding.Wins != 2 || g.HomeStanding.Rank != 3 {
			t.Errorf("fairShare=%v: home carries %+v; want this season (3rd, 2-1), not last (1st, 30-4)", fair, *g.HomeStanding)
		}
		if g.AwayStanding.Rank != 7 {
			t.Errorf("fairShare=%v: away rank %d; want 7", fair, g.AwayStanding.Rank)
		}
	}

	// A side with no table row is nil, not a zeroed struct: the chip draws
	// a dash for nil and would draw "0th 0-0" for zeros.
	if _, err := platform.DBPool.Exec(ctx, `DELETE FROM standings WHERE league = $1 AND team_name = 'Away FC'`, league); err != nil {
		t.Fatal(err)
	}
	games, err := queryGamesByLeagues(ctx, []string{league}, 10, nil, false)
	if err != nil || len(games) != 1 {
		t.Fatalf("requery: %v (%d games)", err, len(games))
	}
	if games[0].AwayStanding != nil {
		t.Errorf("away with no standings row came back %+v; want nil", *games[0].AwayStanding)
	}
	if games[0].HomeStanding == nil {
		t.Error("home lost its standings when away had none")
	}
}
