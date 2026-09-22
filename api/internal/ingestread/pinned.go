package ingestread

// Pinned subjects (SCROLLR-9).
//
// A pin is the strongest signal a user can give about what they want on
// the bar, and until now it was the only one the dashboard payload did
// not guarantee to satisfy: the sports section is a fair-shared preview
// (~60 rows), so pinning a team whose fixture fell outside it left the
// fixed zone empty and nothing explained why.
//
// The client sends its pinned subjects with the dashboard request (they
// stay in desktop prefs -- no server storage) and each local source
// guarantees ONE row per pinned subject it does not already carry:
// sports = live game, else next fixture, else last result, unbounded by
// the horizon; finance = the symbol's latest quote; rss = the feed's
// newest item; predictions = the market's latest state.
//
// These rows are merged AFTER the per-user dashboard cache, not into it.
// That keeps cache:dashboard:<sub> on one key -- the key every
// invalidation path already deletes by name (platform.InvalidateUserCaches)
// -- and means a just-set pin shows up on the next poll instead of after
// the 30s TTL. The cost is at most MaxPinnedSubjects indexed single-row
// queries per request, which is why the cap is small and enforced here
// rather than trusted from the client.

import (
	"context"
	"encoding/json"
	"log"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
)

// MaxPinnedSubjects bounds how many pinned subjects one request may ask
// to be guaranteed. The client's own cap is MAX_PINS = 2 (preferences.ts,
// measured against the narrowest bar); this leaves headroom for a future
// multi-row bar and refuses anything past it, so a hand-rolled request
// cannot turn one poll into an unbounded fan of queries.
const MaxPinnedSubjects = 4

// maxPinSubjectLen bounds one subject string. The longest real subject is
// a feed URL.
const maxPinSubjectLen = 512

// pinSubjectFields maps a data source to the row field(s) that carry a
// pin's subject (CHIP_SPEC 8.5). A game is about both teams, so sports
// has two.
var pinSubjectFields = map[string][]string{
	"sports":      {"home_team_name", "away_team_name"},
	"finance":     {"symbol"},
	"rss":         {"feed_url"},
	"predictions": {"ticker"},
}

// ParsePinnedSubjects reads the `pins` query parameter: a JSON array of
// [source, subject] pairs, e.g. [["sports","Milwaukee Brewers"],["finance","AAPL"]].
//
// A pair shape rather than an object keeps the URL short, and JSON rather
// than a delimiter is what lets a feed URL be a subject without an
// escaping rule. Anything malformed yields no pins rather than an error:
// a bad parameter must degrade to today's behaviour, never fail the
// dashboard.
func ParsePinnedSubjects(raw string) map[string][]string {
	if raw == "" {
		return nil
	}
	var pairs [][]string
	if err := json.Unmarshal([]byte(raw), &pairs); err != nil {
		return nil
	}
	out := map[string][]string{}
	n := 0
	for _, p := range pairs {
		if n >= MaxPinnedSubjects {
			break
		}
		if len(p) != 2 {
			continue
		}
		source, subject := p[0], p[1]
		if subject == "" || len(subject) > maxPinSubjectLen {
			continue
		}
		if _, ok := pinSubjectFields[source]; !ok {
			continue
		}
		if containsString(out[source], subject) {
			continue
		}
		out[source] = append(out[source], subject)
		n++
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// MergePinnedRows appends, per source, one row for every pinned subject
// the payload does not already carry. `data` is the decoded
// DashboardResponse.Data; a source whose section is absent (the user does
// not have that widget) is skipped, which is also the enablement check.
//
// Nothing found for a subject appends nothing: CHIP_SPEC 8.5 rule 3 --
// render nothing, never a placeholder.
func MergePinnedRows(ctx context.Context, userSub string, pins map[string][]string, data map[string]interface{}) {
	if len(pins) == 0 || data == nil {
		return
	}
	// Leagues are only read if a sports pin actually needs them.
	var leagues []string
	leaguesLoaded := false

	for source, subjects := range pins {
		section, ok := data[source]
		if !ok {
			continue
		}
		rows, _ := section.([]interface{})
		fields := pinSubjectFields[source]
		changed := false
		for _, subject := range subjects {
			if rowsHaveSubject(rows, fields, subject) {
				continue
			}
			if source == "sports" && !leaguesLoaded {
				leagues = getUserSportsLeagues(ctx, userSub)
				leaguesLoaded = true
			}
			row := pinnedRow(ctx, source, subject, leagues)
			if row == nil {
				continue
			}
			rows = append(rows, row)
			changed = true
		}
		if changed {
			data[source] = rows
		}
	}
}

// rowsHaveSubject reports whether the already-selected rows cover this
// subject. The payload has been through JSON by this point, so rows are
// generic maps.
func rowsHaveSubject(rows []interface{}, fields []string, subject string) bool {
	for _, r := range rows {
		m, ok := r.(map[string]interface{})
		if !ok {
			continue
		}
		for _, f := range fields {
			if s, ok := m[f].(string); ok && s == subject {
				return true
			}
		}
	}
	return false
}

// pinnedRow fetches the one row that represents a pinned subject right
// now, or nil when the source has nothing for it.
func pinnedRow(ctx context.Context, source, subject string, leagues []string) interface{} {
	switch source {
	case "sports":
		return pinnedGame(ctx, leagues, subject)
	case "finance":
		trades := queryTradesBySymbols(ctx, []string{subject})
		if len(trades) == 0 {
			return nil
		}
		return trades[0]
	case "rss":
		return pinnedRSSItem(ctx, subject)
	case "predictions":
		return pinnedMarket(ctx, subject)
	}
	return nil
}

// pinnedGame returns a pinned team's live game, else its next fixture,
// else its last result -- with no horizon at all, because the pin IS the
// selection (CHIP_SPEC 8.5 rule 2). Bounded to the user's own leagues so
// a pin cannot widen the payload beyond the widgets they have.
//
// notStaleUpcoming still applies: a 'pre' row whose start time has passed
// is a fixture nobody re-read, and it sorts ahead of everything here.
func pinnedGame(ctx context.Context, leagues []string, team string) interface{} {
	if len(leagues) == 0 || team == "" {
		return nil
	}
	rows, err := platform.DBPool.Query(ctx, `
		SELECT id, league, COALESCE(sport, ''), external_game_id, COALESCE(link, ''),
			home_team_name, COALESCE(home_team_logo, ''), COALESCE(home_team_score::text, ''), COALESCE(home_team_code, ''),
			away_team_name, COALESCE(away_team_logo, ''), COALESCE(away_team_score::text, ''), COALESCE(away_team_code, ''),
			start_time, COALESCE(short_detail, ''), state,
			COALESCE(status_short, ''), COALESCE(status_long, ''),
			COALESCE(timer, ''), COALESCE(venue, ''), COALESCE(season, ''), g.updated_at`+standingsColumns+`
		FROM games g`+standingsJoin+`
		WHERE league = ANY($1)
		  AND (home_team_name = $2 OR away_team_name = $2)
		  AND `+notStaleUpcoming+`
		ORDER BY
			CASE state WHEN 'in' THEN 0 WHEN 'pre' THEN 1 ELSE 2 END,
			CASE WHEN state = 'pre' THEN start_time END ASC,
			CASE WHEN state != 'pre' THEN start_time END DESC
		LIMIT 1`, leagues, team)
	if err != nil {
		log.Printf("[Sports] Pinned team query failed: %v", err)
		return nil
	}
	defer rows.Close()
	games := scanGames(rows)
	if len(games) == 0 {
		return nil
	}
	return games[0]
}

// pinnedRSSItem returns a pinned feed's newest item, past the client's
// 6-hour ticker window (8.5 rule 2).
func pinnedRSSItem(ctx context.Context, feedURL string) interface{} {
	rows, err := platform.DBPool.Query(ctx, `
		SELECT id, feed_url, guid, title, link, description, source_name, published_at, created_at, updated_at
		FROM rss_items
		WHERE feed_url = $1
		ORDER BY published_at DESC NULLS LAST
		LIMIT 1
	`, feedURL)
	if err != nil {
		log.Printf("[RSS] Pinned feed query failed: %v", err)
		return nil
	}
	defer rows.Close()
	if !rows.Next() {
		return nil
	}
	var item RssItem
	if err := rows.Scan(
		&item.ID, &item.FeedURL, &item.GUID, &item.Title, &item.Link,
		&item.Description, &item.SourceName, &item.PublishedAt,
		&item.CreatedAt, &item.UpdatedAt,
	); err != nil {
		log.Printf("[RSS] Pinned feed scan failed: %v", err)
		return nil
	}
	return item
}

// pinnedMarket returns a pinned market's latest state -- deliberately
// without marketsLiveWhere. A market that left the sweep or settled is
// exactly the case the user pinned to keep watching, and the client
// already renders a resolved market as resolved rather than as live.
func pinnedMarket(ctx context.Context, ticker string) interface{} {
	rows, err := platform.DBPool.Query(ctx, `
		SELECT`+marketsSelectList+`
		FROM markets
		WHERE ticker = $1
		ORDER BY COALESCE(updated_at, created_at) DESC
		LIMIT 1
	`, ticker)
	markets := scanMarkets(rows, err)
	if len(markets) == 0 {
		return nil
	}
	return markets[0]
}

func containsString(list []string, want string) bool {
	for _, s := range list {
		if s == want {
			return true
		}
	}
	return false
}
