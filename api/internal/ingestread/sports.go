package ingestread

// The sports widget source, folded in from channels/sports/api per
// ADR-0002 (REL-15). Route shapes, cache keys, and response bodies are
// identical to the proxied originals. The Rust ingester
// (channels/sports/service) is unchanged — it still polls api-sports
// and writes games/standings/teams/tracked_leagues; INTERNAL_SPORTS_URL
// points at it for health probes.

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"slices"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
)

const (
	// CacheKeySports is the Redis key for cached game data (all games, public).
	CacheKeySports = "cache:sports"

	// CacheKeySportsPrefix is the Redis key prefix for per-user game
	// caches. Must stay in sync with widgetUserCacheKeys (redis.go).
	CacheKeySportsPrefix = "cache:sports:"

	// CacheKeySportsCatalog is the Redis key for the cached league catalog.
	CacheKeySportsCatalog = "cache:sports:catalog"

	// SportsCacheTTL is how long game data is cached.
	SportsCacheTTL = 10 * time.Second

	// SportsCatalogCacheTTL is how long the league catalog is cached.
	// 60s because game activity status changes frequently.
	SportsCatalogCacheTTL = 60 * time.Second

	// StandingsCacheTTL is how long standings data is cached.
	StandingsCacheTTL = 1 * time.Hour

	// TeamsCacheTTL is how long teams data is cached.
	TeamsCacheTTL = 24 * time.Hour

	// DefaultSportsLimit caps the number of games returned for /sports
	// (authenticated full channel page + public route). High enough to fit
	// a week of MLB (~105 rows) plus other leagues with headroom. The full
	// channel page disables per-league fair share at this limit so users
	// see every game for every selected league.
	DefaultSportsLimit = 200

	// DashboardSportsLimit caps the number of games returned in the
	// /dashboard payload — the desktop's only sports data source. Raised
	// 20 → 60 for v1.1.3 Time Controls: finals now survive 7 days
	// server-side and the per-widget day window (up to 7 back + 7 ahead)
	// must find its games in this payload; at 20, a week of finals would
	// have starved the upcoming slate. The fair-share allocator
	// (MinPerLeagueShare) still guarantees every league visibility.
	DashboardSportsLimit = 60

	// SportsPollingStaleThreshold is the maximum acceptable age of the last
	// successful poll before a league is marked polling_healthy: false.
	// Set to 3× the schedule poll cadence (30 min × 3 = 90 min) — enough
	// slack for transient failures without hiding a real outage.
	SportsPollingStaleThreshold = 90 * time.Minute
)

// Game represents a sports game from the api-sports.io ingestion service.
type Game struct {
	ID             int       `json:"id"`
	League         string    `json:"league"`
	Sport          string    `json:"sport"`
	ExternalGameID string    `json:"external_game_id"`
	Link           string    `json:"link"`
	HomeTeamName   string    `json:"home_team_name"`
	HomeTeamLogo   string    `json:"home_team_logo"`
	HomeTeamScore  string    `json:"home_team_score"`
	HomeTeamCode   string    `json:"home_team_code"`
	AwayTeamName   string    `json:"away_team_name"`
	AwayTeamLogo   string    `json:"away_team_logo"`
	AwayTeamScore  string    `json:"away_team_score"`
	AwayTeamCode   string    `json:"away_team_code"`
	StartTime      time.Time `json:"start_time"`
	ShortDetail    string    `json:"short_detail"`
	State          string    `json:"state"`
	StatusShort    string    `json:"status_short,omitempty"`
	StatusLong     string    `json:"status_long,omitempty"`
	Timer          string    `json:"timer,omitempty"`
	Venue          string    `json:"venue,omitempty"`
	Season         string    `json:"season,omitempty"`
}

// TrackedLeague represents a league entry from the catalog, enriched with
// current game activity counts and polling-health for the dashboard league browser.
type TrackedLeague struct {
	Name              string     `json:"name"`
	SportAPI          string     `json:"sport_api"`
	Category          string     `json:"category"`
	Country           string     `json:"country"`
	LogoURL           string     `json:"logo_url"`
	GameCount         int        `json:"game_count"`
	LiveCount         int        `json:"live_count"`
	NextGame          *time.Time `json:"next_game,omitempty"`
	IsOffseason       bool       `json:"is_offseason"`
	LastPolledAt      *time.Time `json:"last_polled_at,omitempty"`
	LastPollSuccessAt *time.Time `json:"last_poll_success_at,omitempty"`
	PollingHealthy    bool       `json:"polling_healthy"`
	OffseasonMonths   []int32    `json:"-"` // internal, not serialized
}

// LeagueMeta is the per-league summary attached to dashboard + public
// sports responses. Lets the desktop empty-state component explain WHY a
// league has no games right now (off-season, next game soon, polling
// stale, or genuinely nothing scheduled).
type LeagueMeta struct {
	Name           string     `json:"name"`
	IsOffseason    bool       `json:"is_offseason"`
	NextGame       *time.Time `json:"next_game,omitempty"`
	PollingHealthy bool       `json:"polling_healthy"`
}

// SportsResponse is the shape returned by /sports and /sports/public.
// Game array stays under "sports" for backwards compatibility; per-league
// context lives under "meta".
type SportsResponse struct {
	Sports []Game     `json:"sports"`
	Meta   SportsMeta `json:"meta"`
}

// SportsMeta wraps per-league context.
type SportsMeta struct {
	Leagues []LeagueMeta `json:"leagues"`
}

// Standing represents a league standing entry.
type Standing struct {
	League        string `json:"league"`
	TeamName      string `json:"team_name"`
	TeamCode      string `json:"team_code"`
	TeamLogo      string `json:"team_logo"`
	Rank          int    `json:"rank"`
	Wins          int    `json:"wins"`
	Losses        int    `json:"losses"`
	Draws         int    `json:"draws"`
	Points        int    `json:"points"`
	GamesPlayed   int    `json:"games_played"`
	GoalDiff      int    `json:"goal_diff"`
	Description   string `json:"description,omitempty"`
	Form          string `json:"form,omitempty"`
	GroupName     string `json:"group_name,omitempty"`
	SportAPI      string `json:"sport_api,omitempty"`
	Pct           string `json:"pct,omitempty"`
	GamesBehind   string `json:"games_behind,omitempty"`
	OTL           int    `json:"otl,omitempty"`
	GoalsFor      int    `json:"goals_for,omitempty"`
	GoalsAgainst  int    `json:"goals_against,omitempty"`
	PointsFor     int    `json:"points_for,omitempty"`
	PointsAgainst int    `json:"points_against,omitempty"`
	Streak        string `json:"streak,omitempty"`
}

// TeamInfo represents a team entry from the teams table.
type TeamInfo struct {
	League     string `json:"league"`
	ExternalID int    `json:"external_id"`
	Name       string `json:"name"`
	Code       string `json:"code"`
	Logo       string `json:"logo"`
	Country    string `json:"country,omitempty"`
}

// FavoriteTeam represents a user's favorite team for a specific league.
type FavoriteTeam struct {
	TeamID   int    `json:"teamId"`
	TeamName string `json:"teamName"`
}

var sportsSource = localSource{
	dashboard:      sportsDashboard,
	health:         sportsHealth,
	invalidateUser: invalidateSportsUserCache,
}

// RegisterSportsRoutes mounts the sports routes natively on core.
func RegisterSportsRoutes(app *fiber.App) {
	app.Get("/sports", platform.LogtoAuth, handleGetSports)
	app.Get("/sports/public", handleGetSportsPublic)
	app.Get("/sports/leagues", handleGetLeagueCatalog)
	app.Get("/sports/standings", platform.LogtoAuth, handleGetStandings)
	app.Get("/sports/teams", platform.LogtoAuth, handleGetTeams)
	app.Get("/sports/health", handleSportsHealth)
}

// handleGetSports returns the authenticated user's filtered games + meta
// for the full channel page. (The proxied original branched on the
// X-User-Sub header the gateway injected; natively the user comes from
// LogtoAuth — never from a client-supplied header.)
func handleGetSports(c *fiber.Ctx) error {
	userSub := platform.GetUserID(c)
	if userSub == "" {
		return handleGetSportsPublic(c)
	}

	cacheKey := CacheKeySportsPrefix + userSub
	ctx := context.Background()
	var resp SportsResponse
	if cacheGetJSON(ctx, cacheKey, &resp) {
		c.Set("X-Cache", "HIT")
		return c.JSON(resp)
	}

	leagues := getUserSportsLeagues(ctx, userSub)
	if len(leagues) == 0 {
		// Even with no leagues, return the shape — empty arrays both sides.
		return c.JSON(SportsResponse{Sports: []Game{}, Meta: SportsMeta{Leagues: []LeagueMeta{}}})
	}

	favoriteTeams := getUserFavoriteTeams(ctx, userSub)
	// /sports (full channel page) returns every game for every selected
	// league. The page already has league + status filter chips for the
	// user to narrow down — we surface all the data and let them control it.
	games, err := queryGamesByLeagues(ctx, leagues, DefaultSportsLimit, favoriteTeams, false)
	if err != nil {
		log.Printf("[Sports] getUserGames query failed: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(platform.ErrorResponse{
			Status: "error",
			Error:  "Internal server error",
		})
	}
	meta := loadLeagueMeta(ctx, leagues)

	resp = SportsResponse{Sports: games, Meta: SportsMeta{Leagues: meta}}
	cacheSetJSON(ctx, cacheKey, resp, SportsCacheTTL)
	c.Set("X-Cache", "MISS")
	return c.JSON(resp)
}

// handleGetSportsPublic returns all games + meta for every enabled league.
func handleGetSportsPublic(c *fiber.Ctx) error {
	ctx := context.Background()
	var resp SportsResponse
	if cacheGetJSON(ctx, CacheKeySports, &resp) {
		c.Set("X-Cache", "HIT")
		return c.JSON(resp)
	}

	games, err := querySportsGames(ctx, DefaultSportsLimit, nil)
	if err != nil {
		log.Printf("[Sports] getSports query failed: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(platform.ErrorResponse{
			Status: "error",
			Error:  "Internal server error",
		})
	}
	meta := loadLeagueMeta(ctx, allEnabledLeagueNames(ctx))

	resp = SportsResponse{Sports: games, Meta: SportsMeta{Leagues: meta}}
	cacheSetJSON(ctx, CacheKeySports, resp, SportsCacheTTL)
	c.Set("X-Cache", "MISS")
	return c.JSON(resp)
}

// leagueStatus holds the per-league activity computed from the games table.
// Used by both the catalog endpoint and the dashboard meta payload.
type leagueStatus struct {
	GameCount int
	LiveCount int
	NextGame  *time.Time
}

// loadLeagueStatus returns activity counts and the next upcoming game per
// league. If `names` is empty, returns stats for every league that appears
// in the games table. The query is intentionally batched so we run one
// round-trip per call, not one query per league.
func loadLeagueStatus(ctx context.Context, names []string) (map[string]leagueStatus, error) {
	statusMap := make(map[string]leagueStatus)

	var rows pgx.Rows
	var err error
	if len(names) == 0 {
		rows, err = platform.DBPool.Query(ctx, `
			SELECT league,
			       COUNT(*) AS game_count,
			       COUNT(*) FILTER (WHERE state = 'in') AS live_count,
			       MIN(start_time) FILTER (WHERE state = 'pre') AS next_game
			FROM games
			GROUP BY league`)
	} else {
		rows, err = platform.DBPool.Query(ctx, `
			SELECT league,
			       COUNT(*) AS game_count,
			       COUNT(*) FILTER (WHERE state = 'in') AS live_count,
			       MIN(start_time) FILTER (WHERE state = 'pre') AS next_game
			FROM games
			WHERE league = ANY($1)
			GROUP BY league`, names)
	}
	if err != nil {
		return nil, fmt.Errorf("load league status: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var league string
		var s leagueStatus
		if err := rows.Scan(&league, &s.GameCount, &s.LiveCount, &s.NextGame); err != nil {
			log.Printf("[Sports] loadLeagueStatus scan error: %v", err)
			continue
		}
		statusMap[league] = s
	}
	return statusMap, nil
}

// loadLeagueMeta builds the per-league meta array attached to dashboard +
// public sports responses. Returns an empty slice (never nil) so callers
// can JSON-encode cleanly.
func loadLeagueMeta(ctx context.Context, names []string) []LeagueMeta {
	if len(names) == 0 {
		return []LeagueMeta{}
	}

	currentMonth := int32(time.Now().Month())

	rows, err := platform.DBPool.Query(ctx, `
		SELECT name, offseason_months, last_poll_success_at
		FROM tracked_leagues
		WHERE name = ANY($1)`, names)
	if err != nil {
		log.Printf("[Sports] loadLeagueMeta tracked_leagues query failed: %v", err)
		return []LeagueMeta{}
	}
	defer rows.Close()

	type leagueRow struct {
		Name              string
		OffseasonMonths   []int32
		LastPollSuccessAt *time.Time
	}
	leagueRows := make([]leagueRow, 0, len(names))
	for rows.Next() {
		var r leagueRow
		if err := rows.Scan(&r.Name, &r.OffseasonMonths, &r.LastPollSuccessAt); err != nil {
			log.Printf("[Sports] loadLeagueMeta scan error: %v", err)
			continue
		}
		leagueRows = append(leagueRows, r)
	}

	// Pull next_game alongside in a single batched query. Log on failure;
	// the function continues with nil statusMap (next_game stays nil).
	statusMap, statusErr := loadLeagueStatus(ctx, names)
	if statusErr != nil {
		log.Printf("[Sports] loadLeagueMeta: next_game enrichment failed: %v", statusErr)
	}

	meta := make([]LeagueMeta, 0, len(leagueRows))
	for _, r := range leagueRows {
		isOffseason := slices.Contains(r.OffseasonMonths, currentMonth)
		var nextGame *time.Time
		if s, ok := statusMap[r.Name]; ok {
			nextGame = s.NextGame
		}
		pollingHealthy := isOffseason ||
			(r.LastPollSuccessAt != nil && time.Since(*r.LastPollSuccessAt) < SportsPollingStaleThreshold)
		meta = append(meta, LeagueMeta{
			Name:           r.Name,
			IsOffseason:    isOffseason,
			NextGame:       nextGame,
			PollingHealthy: pollingHealthy,
		})
	}
	return meta
}

// allEnabledLeagueNames returns the names of every enabled tracked league.
// Errors are logged and a nil slice is returned so the public endpoint
// degrades to an empty meta rather than 500-ing.
func allEnabledLeagueNames(ctx context.Context) []string {
	rows, err := platform.DBPool.Query(ctx,
		`SELECT name FROM tracked_leagues WHERE is_enabled = true ORDER BY name`)
	if err != nil {
		log.Printf("[Sports] allEnabledLeagueNames query failed: %v", err)
		return nil
	}
	defer rows.Close()
	names := make([]string, 0)
	for rows.Next() {
		var n string
		if err := rows.Scan(&n); err != nil {
			log.Printf("[Sports] allEnabledLeagueNames scan error: %v", err)
			continue
		}
		names = append(names, n)
	}
	return names
}

// handleGetLeagueCatalog returns all enabled tracked leagues for the
// dashboard league browser, enriched with per-league game counts and
// activity status.
func handleGetLeagueCatalog(c *fiber.Ctx) error {
	ctx := context.Background()
	var catalog []TrackedLeague
	if cacheGetJSON(ctx, CacheKeySportsCatalog, &catalog) {
		c.Set("X-Cache", "HIT")
		return c.JSON(catalog)
	}

	currentMonth := int32(time.Now().Month())

	rows, err := platform.DBPool.Query(ctx,
		`SELECT name, COALESCE(sport_api, ''), COALESCE(category, 'Other'), COALESCE(country, ''), COALESCE(logo_url, ''),
		        offseason_months, last_polled_at, last_poll_success_at
		 FROM tracked_leagues WHERE is_enabled = true ORDER BY category, name`)
	if err != nil {
		log.Printf("[Sports] Catalog query failed: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(platform.ErrorResponse{
			Status: "error",
			Error:  "Failed to fetch league catalog",
		})
	}
	defer rows.Close()

	catalog = make([]TrackedLeague, 0)
	for rows.Next() {
		var l TrackedLeague
		if err := rows.Scan(
			&l.Name, &l.SportAPI, &l.Category, &l.Country, &l.LogoURL,
			&l.OffseasonMonths, &l.LastPolledAt, &l.LastPollSuccessAt,
		); err != nil {
			log.Printf("[Sports] Catalog scan error: %v", err)
			continue
		}
		// Compute is_offseason from offseason_months (default false if nil/empty).
		l.IsOffseason = slices.Contains(l.OffseasonMonths, currentMonth)
		// polling_healthy: last_poll_success_at is non-null AND within threshold.
		// Off-season leagues are exempt — we don't poll them, so they can't be "stale".
		l.PollingHealthy = l.IsOffseason ||
			(l.LastPollSuccessAt != nil && time.Since(*l.LastPollSuccessAt) < SportsPollingStaleThreshold)
		catalog = append(catalog, l)
	}

	// Enrich with per-league game activity counts.
	statusMap, statusErr := loadLeagueStatus(ctx, nil)
	if statusErr != nil {
		log.Printf("[Sports] League status query failed (non-fatal): %v", statusErr)
	}
	for i := range catalog {
		if s, ok := statusMap[catalog[i].Name]; ok {
			catalog[i].GameCount = s.GameCount
			catalog[i].LiveCount = s.LiveCount
			catalog[i].NextGame = s.NextGame
		}
	}

	cacheSetJSON(ctx, CacheKeySportsCatalog, catalog, SportsCatalogCacheTTL)
	c.Set("X-Cache", "MISS")
	return c.JSON(catalog)
}

// handleSportsHealth proxies the Rust sports service's full health
// payload for operators.
func handleSportsHealth(c *fiber.Ctx) error {
	return proxyIngestionHealth(c, os.Getenv("INTERNAL_SPORTS_URL"))
}

// sportsHealth reports the sports ingestion status for /health.
func sportsHealth(ctx context.Context) (string, bool) {
	internalURL := os.Getenv("INTERNAL_SPORTS_URL")
	if internalURL == "" {
		return "healthy", true
	}
	code, err := probeIngestion(ctx, internalURL)
	if err != nil || code != http.StatusOK {
		return "down", false
	}
	return "healthy", true
}

// sportsDashboard returns the "sports" + "sports_meta" dashboard sections
// for a user. Home dashboard uses fair-share so every selected league is
// visible within the 60-row payload, regardless of relative volume.
func sportsDashboard(ctx context.Context, userSub string) map[string]interface{} {
	empty := map[string]interface{}{
		"sports":      []Game{},
		"sports_meta": SportsMeta{Leagues: []LeagueMeta{}},
	}

	cacheKey := CacheKeySportsPrefix + userSub
	var resp SportsResponse
	if cacheGetJSON(ctx, cacheKey, &resp) {
		return map[string]interface{}{
			"sports":      resp.Sports,
			"sports_meta": resp.Meta,
		}
	}

	leagues := getUserSportsLeagues(ctx, userSub)
	if len(leagues) == 0 {
		return empty
	}

	favoriteTeams := getUserFavoriteTeams(ctx, userSub)
	// Each league's share splits between soonest-upcoming and newest-finals
	// (v1.1.4, fairShareSideSplit) so the day-window always has both sides.
	games, err := queryGamesByLeagues(ctx, leagues, DashboardSportsLimit, favoriteTeams, true)
	if err != nil {
		log.Printf("[Sports] Dashboard query failed: %v", err)
		return empty
	}
	meta := loadLeagueMeta(ctx, leagues)

	resp = SportsResponse{Sports: games, Meta: SportsMeta{Leagues: meta}}
	cacheSetJSON(ctx, cacheKey, resp, SportsCacheTTL)

	// Dashboard envelope uses sibling key `sports_meta` (not nested `meta`)
	// so multi-channel dashboard responses merge cleanly.
	return map[string]interface{}{
		"sports":      resp.Sports,
		"sports_meta": resp.Meta,
	}
}

// invalidateSportsUserCache drops the per-user games cache after a sports
// widget config change.
func invalidateSportsUserCache(userSub string) {
	if err := platform.Rdb.Del(context.Background(), CacheKeySportsPrefix+userSub).Err(); err != nil {
		log.Printf("[Sports] Failed to invalidate cache for %s: %v", userSub, err)
	}
}

// querySportsGames fetches games prioritized by relevance: live games
// first, then soonest upcoming, then most recently finished. If
// favoriteTeams is provided, those teams' games are prioritized.
func querySportsGames(ctx context.Context, limit int, favoriteTeams map[string]FavoriteTeam) ([]Game, error) {
	favNames := extractFavoriteTeamNames(favoriteTeams)

	rows, err := platform.DBPool.Query(ctx, fmt.Sprintf(`
		SELECT id, league, COALESCE(sport, ''), external_game_id, COALESCE(link, ''),
			home_team_name, COALESCE(home_team_logo, ''), COALESCE(home_team_score::text, ''), COALESCE(home_team_code, ''),
			away_team_name, COALESCE(away_team_logo, ''), COALESCE(away_team_score::text, ''), COALESCE(away_team_code, ''),
			start_time, COALESCE(short_detail, ''), state,
			COALESCE(status_short, ''), COALESCE(status_long, ''),
			COALESCE(timer, ''), COALESCE(venue, ''), COALESCE(season, '')
		FROM games
		ORDER BY
			CASE state WHEN 'in' THEN 0 WHEN 'pre' THEN 1 ELSE 2 END,
			CASE WHEN home_team_name = ANY($1) OR away_team_name = ANY($1) THEN 0 ELSE 1 END,
			CASE WHEN state = 'pre' THEN start_time END ASC,
			CASE WHEN state != 'pre' THEN start_time END DESC
		LIMIT %d`, limit), favNames)
	if err != nil {
		return nil, fmt.Errorf("sports query failed: %w", err)
	}
	defer rows.Close()

	return scanGames(rows), nil
}

// MinPerLeagueShare is the minimum number of candidate games each selected
// league gets before the global LIMIT applies. Used only in fair-share mode
// (home dashboard). Prevents one high-volume league (e.g. MLB with ~15
// games/day) from monopolizing the response and hiding leagues with fewer
// fixtures (e.g. Premier League, F1).
const MinPerLeagueShare = 2

// fairShareSideSplit divides a league's candidate share between the
// UPCOMING side (live + pre, soonest first) and the PAST side (finals,
// newest first). v1.1.4: ranking every pre row ahead of every final let
// a high-volume league (MLB: ~15 fixtures/day x 8 days ingested) fill
// its whole share with the future slate, starving the desktop's
// "days back" window of finals. Upcoming gets the odd slot (ceil) —
// when in doubt, tonight's game beats last week's score.
//
// No cross-side redistribution: if a side has fewer rows than its
// share (early season, off day), the payload simply comes up short of
// the global limit rather than backfilling — simpler, and the desktop
// only windows what exists anyway.
func fairShareSideSplit(perLeague int) (upcoming, past int) {
	upcoming = (perLeague + 1) / 2
	past = perLeague / 2
	return upcoming, past
}

// queryGamesByLeagues fetches games for specific leagues.
//
// When `fairShare` is true (used by the dashboard with limit=60): each
// league gets max(MinPerLeagueShare, ceil(limit/N)) candidate rows via a
// window function — split between soonest-upcoming and newest-finals (see
// fairShareSideSplit), favorites boosted within each side. The global
// LIMIT then trims.
//
// When `fairShare` is false (used by /sports with limit=200 for the full
// channel page): a simple ORDER BY priority LIMIT query, no per-league cap.
func queryGamesByLeagues(ctx context.Context, leagues []string, limit int, favoriteTeams map[string]FavoriteTeam, fairShare bool) ([]Game, error) {
	if len(leagues) == 0 {
		return make([]Game, 0), nil
	}

	favNames := extractFavoriteTeamNames(favoriteTeams)

	var query string
	if fairShare {
		// Per-league candidate share. ceil(limit / N_leagues), floored by
		// MinPerLeagueShare so small leagues are always visible.
		perLeague := (limit + len(leagues) - 1) / len(leagues)
		if perLeague < MinPerLeagueShare {
			perLeague = MinPerLeagueShare
		}
		// v1.1.4: rank within (league, side) where side = upcoming
		// (live+pre) vs past (finals/postponed), then take each side's
		// split of the share. Within the upcoming side live games always
		// lead; the past side is newest-first. Favorites boost inside
		// their side, never across it.
		upShare, downShare := fairShareSideSplit(perLeague)
		query = fmt.Sprintf(`
			WITH ranked AS (
				SELECT id, league, sport, external_game_id, link,
					home_team_name, home_team_logo, home_team_score, home_team_code,
					away_team_name, away_team_logo, away_team_score, away_team_code,
					start_time, short_detail, state, status_short, status_long,
					timer, venue, season,
					(state IN ('in', 'pre')) AS upcoming_side,
					ROW_NUMBER() OVER (
						PARTITION BY league, (state IN ('in', 'pre'))
						ORDER BY
							CASE state WHEN 'in' THEN 0 ELSE 1 END,
							CASE WHEN home_team_name = ANY($2) OR away_team_name = ANY($2) THEN 0 ELSE 1 END,
							CASE WHEN state = 'pre' THEN start_time END ASC,
							CASE WHEN state != 'pre' THEN start_time END DESC
					) AS side_rn
				FROM games
				WHERE league = ANY($1)
			)
			SELECT id, league, COALESCE(sport, ''), external_game_id, COALESCE(link, ''),
				home_team_name, COALESCE(home_team_logo, ''), COALESCE(home_team_score::text, ''), COALESCE(home_team_code, ''),
				away_team_name, COALESCE(away_team_logo, ''), COALESCE(away_team_score::text, ''), COALESCE(away_team_code, ''),
				start_time, COALESCE(short_detail, ''), state,
				COALESCE(status_short, ''), COALESCE(status_long, ''),
				COALESCE(timer, ''), COALESCE(venue, ''), COALESCE(season, '')
			FROM ranked
			WHERE (upcoming_side AND side_rn <= %d)
			   OR (NOT upcoming_side AND side_rn <= %d)
			ORDER BY
				CASE state WHEN 'in' THEN 0 WHEN 'pre' THEN 1 ELSE 2 END,
				CASE WHEN home_team_name = ANY($2) OR away_team_name = ANY($2) THEN 0 ELSE 1 END,
				CASE WHEN state = 'pre' THEN start_time END ASC,
				CASE WHEN state != 'pre' THEN start_time END DESC
			LIMIT %d`, upShare, downShare, limit)
	} else {
		// No per-league cap. Show every game for every selected league.
		query = fmt.Sprintf(`
			SELECT id, league, COALESCE(sport, ''), external_game_id, COALESCE(link, ''),
				home_team_name, COALESCE(home_team_logo, ''), COALESCE(home_team_score::text, ''), COALESCE(home_team_code, ''),
				away_team_name, COALESCE(away_team_logo, ''), COALESCE(away_team_score::text, ''), COALESCE(away_team_code, ''),
				start_time, COALESCE(short_detail, ''), state,
				COALESCE(status_short, ''), COALESCE(status_long, ''),
				COALESCE(timer, ''), COALESCE(venue, ''), COALESCE(season, '')
			FROM games
			WHERE league = ANY($1)
			ORDER BY
				CASE state WHEN 'in' THEN 0 WHEN 'pre' THEN 1 ELSE 2 END,
				CASE WHEN home_team_name = ANY($2) OR away_team_name = ANY($2) THEN 0 ELSE 1 END,
				CASE WHEN state = 'pre' THEN start_time END ASC,
				CASE WHEN state != 'pre' THEN start_time END DESC
			LIMIT %d`, limit)
	}

	rows, err := platform.DBPool.Query(ctx, query, leagues, favNames)
	if err != nil {
		return nil, fmt.Errorf("sports league query failed: %w", err)
	}
	defer rows.Close()

	return scanGames(rows), nil
}

// scanGames scans a games result set into a slice of Game.
func scanGames(rows pgx.Rows) []Game {
	games := make([]Game, 0)
	for rows.Next() {
		var g Game
		if err := rows.Scan(
			&g.ID, &g.League, &g.Sport, &g.ExternalGameID, &g.Link,
			&g.HomeTeamName, &g.HomeTeamLogo, &g.HomeTeamScore, &g.HomeTeamCode,
			&g.AwayTeamName, &g.AwayTeamLogo, &g.AwayTeamScore, &g.AwayTeamCode,
			&g.StartTime, &g.ShortDetail, &g.State,
			&g.StatusShort, &g.StatusLong, &g.Timer, &g.Venue, &g.Season,
		); err != nil {
			log.Printf("[Sports] Row scan failed: %v", err)
			continue
		}
		games = append(games, g)
	}
	return games
}

// getUserSportsLeagues extracts the league list across a user's sports
// widget channels. Post-widget-split (migration 000014) a user has one row
// per league (widget_type = 'sports_nfl', …) rather than a single
// 'sports' row, so we gather every sports_* channel (plus any legacy
// coarse 'sports' row) and union their leagues.
func getUserSportsLeagues(ctx context.Context, logtoSub string) []string {
	rows, err := platform.DBPool.Query(ctx, `
		SELECT config FROM user_widgets
		WHERE logto_sub = $1
		  AND (widget_type = 'sports' OR widget_type LIKE 'sports\_%')
	`, logtoSub)
	if err != nil {
		return nil
	}
	defer rows.Close()
	seen := make(map[string]bool)
	var leagues []string
	for rows.Next() {
		var configJSON []byte
		if err := rows.Scan(&configJSON); err != nil {
			continue
		}
		var config map[string]interface{}
		if err := json.Unmarshal(configJSON, &config); err != nil {
			continue
		}
		for _, l := range platform.ExtractStringArray(config, "leagues") {
			if !seen[l] {
				seen[l] = true
				leagues = append(leagues, l)
			}
		}
	}
	return leagues
}

// getUserFavoriteTeams merges favorite teams across a user's sports widget
// channels (keyed by league, so per-widget entries don't collide).
func getUserFavoriteTeams(ctx context.Context, logtoSub string) map[string]FavoriteTeam {
	rows, err := platform.DBPool.Query(ctx, `
		SELECT config FROM user_widgets
		WHERE logto_sub = $1
		  AND (widget_type = 'sports' OR widget_type LIKE 'sports\_%')
	`, logtoSub)
	if err != nil {
		return nil
	}
	defer rows.Close()
	merged := make(map[string]FavoriteTeam)
	for rows.Next() {
		var configJSON []byte
		if err := rows.Scan(&configJSON); err != nil {
			continue
		}
		for k, v := range extractFavoriteTeamsFromConfig(configJSON) {
			merged[k] = v
		}
	}
	if len(merged) == 0 {
		return nil
	}
	return merged
}

// handleGetStandings returns league standings filtered by league query param.
func handleGetStandings(c *fiber.Ctx) error {
	league := c.Query("league")
	if league == "" {
		return c.Status(fiber.StatusBadRequest).JSON(platform.ErrorResponse{
			Status: "error", Error: "league query parameter is required",
		})
	}

	ctx := context.Background()
	cacheKey := "cache:sports:standings:" + league
	var standings []Standing
	if cacheGetJSON(ctx, cacheKey, &standings) {
		return c.JSON(fiber.Map{"standings": standings})
	}

	rows, err := platform.DBPool.Query(c.Context(), `
		SELECT league, team_name, COALESCE(team_code, ''), COALESCE(team_logo, ''),
			COALESCE(rank, 0), wins, losses, draws, COALESCE(points, 0),
			games_played, COALESCE(goal_diff, 0),
			COALESCE(description, ''), COALESCE(form, ''), COALESCE(group_name, ''),
			COALESCE(sport_api, ''), COALESCE(pct, ''), COALESCE(games_behind, ''),
			COALESCE(otl, 0), COALESCE(goals_for, 0), COALESCE(goals_against, 0),
			COALESCE(points_for, 0), COALESCE(points_against, 0), COALESCE(streak, '')
		FROM standings
		WHERE league = $1
		ORDER BY COALESCE(rank, 9999) ASC`, league)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(platform.ErrorResponse{
			Status: "error", Error: "failed to query standings",
		})
	}
	defer rows.Close()

	standings = make([]Standing, 0)
	for rows.Next() {
		var s Standing
		if err := rows.Scan(
			&s.League, &s.TeamName, &s.TeamCode, &s.TeamLogo,
			&s.Rank, &s.Wins, &s.Losses, &s.Draws, &s.Points,
			&s.GamesPlayed, &s.GoalDiff, &s.Description, &s.Form, &s.GroupName,
			&s.SportAPI, &s.Pct, &s.GamesBehind, &s.OTL,
			&s.GoalsFor, &s.GoalsAgainst, &s.PointsFor, &s.PointsAgainst, &s.Streak,
		); err != nil {
			log.Printf("[Sports] Standing row scan failed: %v", err)
			continue
		}
		standings = append(standings, s)
	}

	cacheSetJSON(ctx, cacheKey, standings, StandingsCacheTTL)
	return c.JSON(fiber.Map{"standings": standings})
}

// handleGetTeams returns teams for a given league.
func handleGetTeams(c *fiber.Ctx) error {
	league := c.Query("league")
	if league == "" {
		return c.Status(fiber.StatusBadRequest).JSON(platform.ErrorResponse{
			Status: "error", Error: "league query parameter is required",
		})
	}

	ctx := context.Background()
	cacheKey := "cache:sports:teams:" + league
	var teams []TeamInfo
	if cacheGetJSON(ctx, cacheKey, &teams) {
		return c.JSON(fiber.Map{"teams": teams})
	}

	rows, err := platform.DBPool.Query(c.Context(), `
		SELECT league, external_id, name, COALESCE(code, ''), COALESCE(logo, ''),
			COALESCE(country, '')
		FROM teams
		WHERE league = $1
		ORDER BY name ASC`, league)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(platform.ErrorResponse{
			Status: "error", Error: "failed to query teams",
		})
	}
	defer rows.Close()

	teams = make([]TeamInfo, 0)
	for rows.Next() {
		var t TeamInfo
		if err := rows.Scan(&t.League, &t.ExternalID, &t.Name, &t.Code, &t.Logo, &t.Country); err != nil {
			log.Printf("[Sports] Team row scan failed: %v", err)
			continue
		}
		teams = append(teams, t)
	}

	cacheSetJSON(ctx, cacheKey, teams, TeamsCacheTTL)
	return c.JSON(fiber.Map{"teams": teams})
}

// extractFavoriteTeamsFromConfig parses config JSON and returns favorite
// teams per league.
func extractFavoriteTeamsFromConfig(configJSON []byte) map[string]FavoriteTeam {
	if len(configJSON) == 0 {
		return nil
	}
	var config struct {
		FavoriteTeams map[string]FavoriteTeam `json:"favoriteTeams"`
	}
	if err := json.Unmarshal(configJSON, &config); err != nil {
		return nil
	}
	return config.FavoriteTeams
}

// extractFavoriteTeamNames extracts just the team names from a
// favoriteTeams map.
func extractFavoriteTeamNames(favs map[string]FavoriteTeam) []string {
	if len(favs) == 0 {
		return []string{}
	}
	names := make([]string, 0, len(favs))
	for _, f := range favs {
		if f.TeamName != "" {
			names = append(names, f.TeamName)
		}
	}
	return names
}
