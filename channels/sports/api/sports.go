package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

// =============================================================================
// Constants
// =============================================================================

const (
	// CacheKeySports is the Redis key for cached game data (all games, public).
	CacheKeySports = "cache:sports"

	// CacheKeySportsPrefix is the Redis key prefix for per-user game caches.
	CacheKeySportsPrefix = "cache:sports:"

	// CacheKeySportsCatalog is the Redis key for the cached league catalog.
	CacheKeySportsCatalog = "cache:sports:catalog"

	// SportsCacheTTL is how long game data is cached.
	// Reduced from 30s to 10s for faster score updates.
	SportsCacheTTL = 10 * time.Second

	// SportsCatalogCacheTTL is how long the league catalog is cached.
	// Reduced from 5min to 60s because game activity status changes frequently.
	SportsCatalogCacheTTL = 60 * time.Second

	// StandingsCacheTTL is how long standings data is cached.
	StandingsCacheTTL = 1 * time.Hour

	// TeamsCacheTTL is how long teams data is cached.
	TeamsCacheTTL = 24 * time.Hour

	// SportsLeagueSubscribersPrefix is the per-league subscriber set prefix.
	// Keys: sports:subscribers:league:{NFL}, sports:subscribers:league:{NBA}, etc.
	SportsLeagueSubscribersPrefix = "sports:subscribers:league:"

	// DefaultSportsLimit caps the number of games returned for the public route.
	DefaultSportsLimit = 50

	// DashboardSportsLimit caps the number of games returned for dashboard.
	DashboardSportsLimit = 20

	// PollingStaleThreshold is the maximum acceptable age of the last
	// successful poll before a league is marked polling_healthy: false.
	// Set to 3× the schedule poll cadence (30 min × 3 = 90 min) — enough
	// slack for transient failures without hiding a real outage.
	PollingStaleThreshold = 90 * time.Minute
)

// =============================================================================
// App
// =============================================================================

// App holds the shared dependencies for all handlers.
type App struct {
	db  *pgxpool.Pool
	rdb *redis.Client
}

// =============================================================================
// Public Routes (proxied by core gateway)
// =============================================================================

// getSports retrieves the latest sports games.
// If X-User-Sub is set (authenticated), returns per-user filtered games.
// Otherwise returns all games (public).
func (a *App) getSports(c *fiber.Ctx) error {
	userSub := c.Get("X-User-Sub")

	// Authenticated: return per-user filtered games
	if userSub != "" {
		return a.getUserGames(c, userSub, DefaultSportsLimit)
	}

	// Public: return all games + meta for every enabled league.
	var resp SportsResponse
	if GetCache(a.rdb, CacheKeySports, &resp) {
		c.Set("X-Cache", "HIT")
		return c.JSON(resp)
	}

	ctx := context.Background()
	games, err := a.queryGames(ctx, DefaultSportsLimit, nil)
	if err != nil {
		log.Printf("[Sports] getSports query failed: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Status: "error",
			Error:  "Internal server error",
		})
	}
	meta := a.loadLeagueMeta(ctx, a.allEnabledLeagueNames(ctx))

	resp = SportsResponse{Sports: games, Meta: SportsMeta{Leagues: meta}}
	SetCache(a.rdb, CacheKeySports, resp, SportsCacheTTL)
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
// in the games table. If `names` is non-empty, the result is restricted to
// just those leagues (LEFT JOIN semantics in spirit — leagues with no games
// simply don't appear in the map).
//
// `game_count` is intentionally NOT "all rows for this league." A user
// scanning the catalog wants to know "how many games are happening today,"
// not "how many fixtures has the ingestion service ever stored." Without
// this filter, MLB shows ~100 (a full week × ~15/day) while Premier League
// shows ~10 — visually wildly out of proportion with what's relevant.
// The today-window is:
//   - state = 'in'                                    (live right now)
//   - state = 'pre' AND start_time < NOW() + 24h      (starting in next 24h)
//   - state IN ('final','postponed') AND start_time > NOW() - 12h  (just finished)
//
// The query is intentionally batched so we run one round-trip per call,
// not one query per league.
func (a *App) loadLeagueStatus(ctx context.Context, names []string) (map[string]leagueStatus, error) {
	statusMap := make(map[string]leagueStatus)

	const countFilter = `
		COUNT(*) FILTER (
			WHERE state = 'in'
			   OR (state = 'pre' AND start_time < NOW() + INTERVAL '24 hours')
			   OR (state IN ('final','postponed') AND start_time > NOW() - INTERVAL '12 hours')
		) AS game_count`

	var rows pgx.Rows
	var err error
	if len(names) == 0 {
		rows, err = a.db.Query(ctx, `
			SELECT league,`+countFilter+`,
			       COUNT(*) FILTER (WHERE state = 'in') AS live_count,
			       MIN(start_time) FILTER (WHERE state = 'pre') AS next_game
			FROM games
			GROUP BY league`)
	} else {
		rows, err = a.db.Query(ctx, `
			SELECT league,`+countFilter+`,
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
// public sports responses. `names` is the set of leagues to include —
// typically the user's selected leagues for /dashboard, or every enabled
// league for the public endpoint.
//
// For each league:
//   - is_offseason: derived from offseason_months and the current UTC month.
//   - next_game:    earliest start_time of any pre-state game.
//   - polling_healthy: same rule as catalog (90-min staleness threshold,
//     exempt for off-season leagues).
//
// Returns an empty slice (never nil) so callers can JSON-encode cleanly.
func (a *App) loadLeagueMeta(ctx context.Context, names []string) []LeagueMeta {
	if len(names) == 0 {
		return []LeagueMeta{}
	}

	currentMonth := int32(time.Now().Month())

	// Query tracked_leagues for off-season + polling-health columns.
	rows, err := a.db.Query(ctx, `
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

	// Pull next_game alongside in a single batched query. Log on failure
	// so operators see when next_game enrichment is broken; the function
	// continues with nil statusMap (every league's next_game stays nil).
	statusMap, statusErr := a.loadLeagueStatus(ctx, names)
	if statusErr != nil {
		log.Printf("[Sports] loadLeagueMeta: next_game enrichment failed: %v", statusErr)
	}

	meta := make([]LeagueMeta, 0, len(leagueRows))
	for _, r := range leagueRows {
		isOffseason := containsMonth(r.OffseasonMonths, currentMonth)
		var nextGame *time.Time
		if s, ok := statusMap[r.Name]; ok {
			nextGame = s.NextGame
		}
		pollingHealthy := isOffseason ||
			(r.LastPollSuccessAt != nil && time.Since(*r.LastPollSuccessAt) < PollingStaleThreshold)
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
// Used by the public /sports endpoint where there is no per-user filter.
// Errors are logged and a nil slice is returned so the public endpoint
// degrades to an empty meta rather than 500-ing.
func (a *App) allEnabledLeagueNames(ctx context.Context) []string {
	rows, err := a.db.Query(ctx,
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

// getLeagueCatalog returns all enabled tracked leagues for the dashboard
// league browser, enriched with per-league game counts and activity status.
func (a *App) getLeagueCatalog(c *fiber.Ctx) error {
	var catalog []TrackedLeague
	if GetCache(a.rdb, CacheKeySportsCatalog, &catalog) {
		c.Set("X-Cache", "HIT")
		return c.JSON(catalog)
	}

	ctx := context.Background()
	currentMonth := int32(time.Now().Month())

	rows, err := a.db.Query(ctx,
		`SELECT name, COALESCE(sport_api, ''), COALESCE(category, 'Other'), COALESCE(country, ''), COALESCE(logo_url, ''),
		        offseason_months, last_polled_at, last_poll_success_at
		 FROM tracked_leagues WHERE is_enabled = true ORDER BY category, name`)
	if err != nil {
		log.Printf("[Sports] Catalog query failed: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
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
		// Compute is_offseason from offseason_months (default false if nil/empty)
		l.IsOffseason = containsMonth(l.OffseasonMonths, currentMonth)
		// Compute polling_healthy: last_poll_success_at is non-null AND within threshold.
		// Off-season leagues are exempt — we don't poll them, so they can't be "stale".
		l.PollingHealthy = l.IsOffseason ||
			(l.LastPollSuccessAt != nil && time.Since(*l.LastPollSuccessAt) < PollingStaleThreshold)
		catalog = append(catalog, l)
	}

	// Enrich with per-league game activity counts.
	statusMap, statusErr := a.loadLeagueStatus(ctx, nil)
	if statusErr != nil {
		log.Printf("[Sports] League status query failed (non-fatal): %v", statusErr)
		// Continue without enrichment — the catalog is still useful.
	}
	for i := range catalog {
		if s, ok := statusMap[catalog[i].Name]; ok {
			catalog[i].GameCount = s.GameCount
			catalog[i].LiveCount = s.LiveCount
			catalog[i].NextGame = s.NextGame
		}
	}

	SetCache(a.rdb, CacheKeySportsCatalog, catalog, SportsCatalogCacheTTL)
	c.Set("X-Cache", "MISS")
	return c.JSON(catalog)
}

// containsMonth checks if the given month is in the offseason_months slice.
// Returns false if the slice is nil or empty (default to in-season).
func containsMonth(months []int32, month int32) bool {
	for _, m := range months {
		if m == month {
			return true
		}
	}
	return false
}

// healthHandler proxies a health check to the internal Rust sports service.
func (a *App) healthHandler(c *fiber.Ctx) error {
	return ProxyInternalHealth(c, os.Getenv("INTERNAL_SPORTS_URL"))
}

// =============================================================================
// Internal Routes (called by core gateway)
// =============================================================================

// handleInternalCDC receives CDC records from the core gateway and returns the
// list of users who should receive these records.
//
// Per-league routing: each CDC record contains a "league" field (e.g. "NFL",
// "NBA"). The handler looks up per-league subscriber sets to determine which
// users follow that league.
func (a *App) handleInternalCDC(c *fiber.Ctx) error {
	var req struct {
		Records []CDCRecord `json:"records"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Status: "error",
			Error:  "Invalid request body",
		})
	}

	ctx := context.Background()
	userSet := make(map[string]struct{})

	for _, rec := range req.Records {
		league, ok := rec.Record["league"].(string)
		if !ok || league == "" {
			continue
		}

		subs, err := GetSubscribers(a.rdb, ctx, SportsLeagueSubscribersPrefix+league)
		if err != nil {
			log.Printf("[Sports CDC] Failed to get league subscribers for %s: %v", league, err)
			continue
		}

		for _, sub := range subs {
			userSet[sub] = struct{}{}
		}
	}

	// Bust caches so the next request serves fresh data instead of stale scores.
	// Without this, CDC notifies clients of changes but re-fetches return cached data.
	DeleteCache(a.rdb, CacheKeySports) // public cache
	for sub := range userSet {
		DeleteCache(a.rdb, CacheKeySportsPrefix+sub) // per-user cache
	}

	users := make([]string, 0, len(userSet))
	for sub := range userSet {
		users = append(users, sub)
	}

	return c.JSON(fiber.Map{"users": users})
}

// handleInternalDashboard returns sports data for a user's dashboard.
// Query param: user={logto_sub}
func (a *App) handleInternalDashboard(c *fiber.Ctx) error {
	userSub := c.Query("user")
	if userSub == "" {
		return c.JSON(fiber.Map{
			"sports":      []Game{},
			"sports_meta": SportsMeta{Leagues: []LeagueMeta{}},
		})
	}

	cacheKey := CacheKeySportsPrefix + userSub
	var resp SportsResponse
	if GetCache(a.rdb, cacheKey, &resp) {
		return c.JSON(fiber.Map{
			"sports":      resp.Sports,
			"sports_meta": resp.Meta,
		})
	}

	ctx := context.Background()
	leagues := a.getUserSportsLeagues(userSub)
	if len(leagues) == 0 {
		return c.JSON(fiber.Map{
			"sports":      []Game{},
			"sports_meta": SportsMeta{Leagues: []LeagueMeta{}},
		})
	}

	favoriteTeams := a.getUserFavoriteTeams(userSub)
	games, err := a.queryGamesByLeagues(ctx, leagues, DashboardSportsLimit, favoriteTeams)
	if err != nil {
		log.Printf("[Sports] Dashboard query failed: %v", err)
		return c.JSON(fiber.Map{
			"sports":      []Game{},
			"sports_meta": SportsMeta{Leagues: []LeagueMeta{}},
		})
	}
	meta := a.loadLeagueMeta(ctx, leagues)

	resp = SportsResponse{Sports: games, Meta: SportsMeta{Leagues: meta}}
	SetCache(a.rdb, cacheKey, resp, SportsCacheTTL)

	// Dashboard envelope uses sibling key `sports_meta` (not nested `meta`)
	// so the core gateway can merge multi-channel responses cleanly.
	return c.JSON(fiber.Map{
		"sports":      resp.Sports,
		"sports_meta": resp.Meta,
	})
}

// handleInternalHealth is the endpoint the core gateway and k8s probes hit.
//
// It verifies that this API's own dependencies (Postgres, Redis) are reachable
// and that the downstream Rust ingestion service's /health/ready returns 200.
// Any failure returns HTTP 503 so the k8s readinessProbe can mark the pod
// NotReady and route traffic elsewhere. Until PR #106, the previous version
// of this handler returned a static `{"status":"healthy"}` no matter what,
// which is what let the sports-service outage stay invisible for 3 days.
func (a *App) handleInternalHealth(c *fiber.Ctx) error {
	ctx, cancel := context.WithTimeout(c.Context(), InternalHealthTimeout)
	defer cancel()

	result := fiber.Map{"status": "healthy"}
	degraded := false

	if err := a.db.Ping(ctx); err != nil {
		result["database"] = "unhealthy: " + err.Error()
		degraded = true
	} else {
		result["database"] = "healthy"
	}

	if err := a.rdb.Ping(ctx).Err(); err != nil {
		result["redis"] = "unhealthy: " + err.Error()
		degraded = true
	} else {
		result["redis"] = "healthy"
	}

	// Check the ingestion service's /health/ready. A 503 here means the Rust
	// service is alive-but-not-ingesting and we should refuse traffic.
	if internalURL := os.Getenv("INTERNAL_SPORTS_URL"); internalURL != "" {
		code, ingestErr := probeIngestion(ctx, internalURL)
		result["ingestion_http_status"] = code
		if ingestErr != nil {
			result["ingestion"] = "unreachable: " + ingestErr.Error()
			degraded = true
		} else if code != fiber.StatusOK {
			result["ingestion"] = fmt.Sprintf("not ready: HTTP %d", code)
			degraded = true
		} else {
			result["ingestion"] = "healthy"
		}
	}

	if degraded {
		result["status"] = "degraded"
		return c.Status(fiber.StatusServiceUnavailable).JSON(result)
	}
	return c.JSON(result)
}

// =============================================================================
// Channel Lifecycle
// =============================================================================

// handleChannelLifecycle handles channel lifecycle events dispatched by the core
// gateway. Events: created, updated, deleted, sync.
func (a *App) handleChannelLifecycle(c *fiber.Ctx) error {
	var req struct {
		Event     string                 `json:"event"`
		User      string                 `json:"user"`
		Config    map[string]interface{} `json:"config"`
		OldConfig map[string]interface{} `json:"old_config"`
		Enabled   bool                   `json:"enabled"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Status: "error",
			Error:  "Invalid request body",
		})
	}

	ctx := context.Background()

	switch req.Event {
	case "created":
		log.Printf("[Sports Lifecycle] Channel created for user %s", req.User)

	case "updated":
		a.onChannelUpdated(ctx, req.User, req.OldConfig, req.Config)

	case "deleted":
		a.onChannelDeleted(ctx, req.User, req.Config)

	case "sync":
		a.onSyncSubscriptions(ctx, req.User, req.Config, req.Enabled)

	default:
		log.Printf("[Sports Lifecycle] Unknown event: %s", req.Event)
	}

	return c.JSON(fiber.Map{"ok": true})
}

// onChannelUpdated handles league list changes when a channel is updated.
func (a *App) onChannelUpdated(ctx context.Context, userSub string, oldConfig, newConfig map[string]interface{}) {
	if newConfig == nil {
		return
	}

	oldLeagues := extractLeaguesFromChannelConfig(oldConfig)
	newLeagues := extractLeaguesFromChannelConfig(newConfig)
	newSet := make(map[string]bool, len(newLeagues))
	for _, l := range newLeagues {
		newSet[l] = true
	}
	for _, l := range oldLeagues {
		if !newSet[l] {
			RemoveSubscriber(a.rdb, ctx, SportsLeagueSubscribersPrefix+l, userSub)
		}
	}

	// Invalidate per-user cache
	DeleteCache(a.rdb, CacheKeySportsPrefix+userSub)
}

// onChannelDeleted removes the user from all league subscriber sets.
func (a *App) onChannelDeleted(ctx context.Context, userSub string, config map[string]interface{}) {
	leagues := extractLeaguesFromChannelConfig(config)
	for _, l := range leagues {
		RemoveSubscriber(a.rdb, ctx, SportsLeagueSubscribersPrefix+l, userSub)
	}
	DeleteCache(a.rdb, CacheKeySportsPrefix+userSub)
}

// onSyncSubscriptions adds or removes the user from per-league subscriber
// sets based on the enabled flag.
func (a *App) onSyncSubscriptions(ctx context.Context, userSub string, config map[string]interface{}, enabled bool) {
	leagues := extractLeaguesFromChannelConfig(config)
	for _, l := range leagues {
		if enabled {
			AddSubscriber(a.rdb, ctx, SportsLeagueSubscribersPrefix+l, userSub)
		} else {
			RemoveSubscriber(a.rdb, ctx, SportsLeagueSubscribersPrefix+l, userSub)
		}
	}
}

// =============================================================================
// Database Helpers
// =============================================================================

// queryGames fetches games from PostgreSQL prioritized by relevance:
// live games first, then soonest upcoming, then most recently finished.
// If favoriteTeams is provided, those teams' games are prioritized.
func (a *App) queryGames(ctx context.Context, limit int, favoriteTeams map[string]FavoriteTeam) ([]Game, error) {
	favNames := extractFavoriteTeamNames(favoriteTeams)

	rows, err := a.db.Query(ctx, fmt.Sprintf(`
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

	return games, nil
}

// MinPerLeagueShare is the minimum number of candidate games each selected
// league gets before the global LIMIT applies. Prevents one high-volume
// league (e.g. MLB with ~15 games/day) from monopolizing the response and
// hiding leagues with fewer fixtures (e.g. Premier League, F1).
const MinPerLeagueShare = 2

// queryGamesByLeagues fetches games for specific leagues with per-league
// fair share. Each league gets max(MinPerLeagueShare, ceil(limit/N))
// candidate rows ranked by the same priority (live > pre > final, favorites
// first, soonest upcoming first). The global LIMIT trims the pool.
//
// Without the share cap, an SQL "ORDER BY priority LIMIT 20" query against a
// games table dominated by one league (MLB during the season) returns 20
// rows from that league exclusively. Premier League rows score lower on the
// global ordering and never make it into the response — they then can't
// appear in the frontend's "edit preview" dropdown either, because the
// dropdown's group list is built from the games array.
//
// If favoriteTeams is provided, those teams' games are prioritized within
// the per-league ranking.
func (a *App) queryGamesByLeagues(ctx context.Context, leagues []string, limit int, favoriteTeams map[string]FavoriteTeam) ([]Game, error) {
	if len(leagues) == 0 {
		return make([]Game, 0), nil
	}

	favNames := extractFavoriteTeamNames(favoriteTeams)

	// Per-league candidate share. ceil(limit / N_leagues), capped below by
	// MinPerLeagueShare so small leagues are always visible even when the
	// user has many leagues selected.
	perLeague := (limit + len(leagues) - 1) / len(leagues)
	if perLeague < MinPerLeagueShare {
		perLeague = MinPerLeagueShare
	}

	rows, err := a.db.Query(ctx, fmt.Sprintf(`
		WITH ranked AS (
			SELECT id, league, sport, external_game_id, link,
				home_team_name, home_team_logo, home_team_score, home_team_code,
				away_team_name, away_team_logo, away_team_score, away_team_code,
				start_time, short_detail, state, status_short, status_long,
				timer, venue, season,
				ROW_NUMBER() OVER (
					PARTITION BY league
					ORDER BY
						CASE state WHEN 'in' THEN 0 WHEN 'pre' THEN 1 ELSE 2 END,
						CASE WHEN home_team_name = ANY($2) OR away_team_name = ANY($2) THEN 0 ELSE 1 END,
						CASE WHEN state = 'pre' THEN start_time END ASC,
						CASE WHEN state != 'pre' THEN start_time END DESC
				) AS rn
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
		WHERE rn <= %d
		ORDER BY
			CASE state WHEN 'in' THEN 0 WHEN 'pre' THEN 1 ELSE 2 END,
			CASE WHEN home_team_name = ANY($2) OR away_team_name = ANY($2) THEN 0 ELSE 1 END,
			CASE WHEN state = 'pre' THEN start_time END ASC,
			CASE WHEN state != 'pre' THEN start_time END DESC
		LIMIT %d`, perLeague, limit), leagues, favNames)
	if err != nil {
		return nil, fmt.Errorf("sports league query failed: %w", err)
	}
	defer rows.Close()

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

	return games, nil
}

// getUserGames returns per-user filtered games + meta (used by authenticated getSports).
func (a *App) getUserGames(c *fiber.Ctx, userSub string, limit int) error {
	cacheKey := CacheKeySportsPrefix + userSub
	var resp SportsResponse
	if GetCache(a.rdb, cacheKey, &resp) {
		c.Set("X-Cache", "HIT")
		return c.JSON(resp)
	}

	ctx := context.Background()
	leagues := a.getUserSportsLeagues(userSub)
	if len(leagues) == 0 {
		// Even with no leagues, return the new shape — empty arrays both sides.
		return c.JSON(SportsResponse{Sports: []Game{}, Meta: SportsMeta{Leagues: []LeagueMeta{}}})
	}

	favoriteTeams := a.getUserFavoriteTeams(userSub)
	games, err := a.queryGamesByLeagues(ctx, leagues, limit, favoriteTeams)
	if err != nil {
		log.Printf("[Sports] getUserGames query failed: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Status: "error",
			Error:  "Internal server error",
		})
	}
	meta := a.loadLeagueMeta(ctx, leagues)

	resp = SportsResponse{Sports: games, Meta: SportsMeta{Leagues: meta}}
	SetCache(a.rdb, cacheKey, resp, SportsCacheTTL)
	c.Set("X-Cache", "MISS")
	return c.JSON(resp)
}

// getUserSportsLeagues extracts the league list from a user's sports channel config.
func (a *App) getUserSportsLeagues(logtoSub string) []string {
	var configJSON []byte
	err := a.db.QueryRow(context.Background(), `
		SELECT config FROM user_channels
		WHERE logto_sub = $1 AND channel_type = 'sports'
	`, logtoSub).Scan(&configJSON)
	if err != nil {
		return nil
	}
	return extractLeaguesFromConfig(configJSON)
}

// getUserFavoriteTeams extracts favorite teams from a user's sports channel config.
func (a *App) getUserFavoriteTeams(logtoSub string) map[string]FavoriteTeam {
	var configJSON []byte
	err := a.db.QueryRow(context.Background(), `
		SELECT config FROM user_channels
		WHERE logto_sub = $1 AND channel_type = 'sports'
	`, logtoSub).Scan(&configJSON)
	if err != nil {
		return nil
	}
	return extractFavoriteTeamsFromConfig(configJSON)
}

// =============================================================================
// Standings & Teams
// =============================================================================

// getStandings returns league standings filtered by league query param.
func (a *App) getStandings(c *fiber.Ctx) error {
	league := c.Query("league")
	if league == "" {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Status: "error", Error: "league query parameter is required",
		})
	}

	cacheKey := "cache:sports:standings:" + league
	var standings []Standing
	if GetCache(a.rdb, cacheKey, &standings) {
		return c.JSON(fiber.Map{"standings": standings})
	}

	rows, err := a.db.Query(c.Context(), `
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
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
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

	SetCache(a.rdb, cacheKey, standings, StandingsCacheTTL)
	return c.JSON(fiber.Map{"standings": standings})
}

// getTeams returns teams for a given league.
func (a *App) getTeams(c *fiber.Ctx) error {
	league := c.Query("league")
	if league == "" {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Status: "error", Error: "league query parameter is required",
		})
	}

	cacheKey := "cache:sports:teams:" + league
	var teams []TeamInfo
	if GetCache(a.rdb, cacheKey, &teams) {
		return c.JSON(fiber.Map{"teams": teams})
	}

	rows, err := a.db.Query(c.Context(), `
		SELECT league, external_id, name, COALESCE(code, ''), COALESCE(logo, ''),
			COALESCE(country, '')
		FROM teams
		WHERE league = $1
		ORDER BY name ASC`, league)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
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

	SetCache(a.rdb, cacheKey, teams, TeamsCacheTTL)
	return c.JSON(fiber.Map{"teams": teams})
}

// =============================================================================
// Config Parsing Helpers
// =============================================================================

// extractLeaguesFromChannelConfig extracts leagues from a channel's config map.
func extractLeaguesFromChannelConfig(config map[string]interface{}) []string {
	if config == nil {
		return nil
	}
	configJSON, err := json.Marshal(config)
	if err != nil {
		return nil
	}
	return extractLeaguesFromConfig(configJSON)
}

// extractLeaguesFromConfig parses a config JSONB blob and returns league name strings.
func extractLeaguesFromConfig(configJSON []byte) []string {
	var config struct {
		Leagues []string `json:"leagues"`
	}
	if err := json.Unmarshal(configJSON, &config); err != nil {
		return nil
	}

	leagues := make([]string, 0, len(config.Leagues))
	for _, l := range config.Leagues {
		if l != "" {
			leagues = append(leagues, l)
		}
	}
	return leagues
}

// extractFavoriteTeamsFromConfig parses config JSON and returns favorite teams per league.
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

// extractFavoriteTeamNames extracts just the team names from a favoriteTeams map.
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
