package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"golang.org/x/oauth2"
	"golang.org/x/sync/singleflight"
)

// =============================================================================
// Constants
// =============================================================================

const (
	// Redis key prefix for CDC subscriber resolution — all tables route via league_key
	RedisLeagueUsersPrefix = "fantasy:league_users:" // SET of logto_subs per league_key

	// OAuth state management
	RedisCSRFPrefix            = "csrf:"
	RedisYahooStateLogtoPrefix = "yahoo_state_logto:"

	// Timeouts and expiries
	YahooAPITimeout       = 10 * time.Second
	OAuthStateExpiry      = 10 * time.Minute
	OAuthStateBytes       = 16
	DefaultFrontendURL    = "https://myscrollr.com"
	AuthPopupCloseDelayMs = 1500
)

// =============================================================================
// App
// =============================================================================

// App holds the shared dependencies for all handlers.
type App struct {
	db          *pgxpool.Pool
	rdb         *redis.Client
	yahooConfig *oauth2.Config
	syncState   *syncHealth

	// leagueFlight collapses concurrent cache-miss requests for the same user.
	leagueFlight singleflight.Group
}

// resolveFrontendURL returns the URL to use for postMessage targetOrigin.
// Priority: FRONTEND_URL env > first origin in ALLOWED_ORIGINS > DefaultFrontendURL.
func resolveFrontendURL() string {
	if v := strings.TrimSpace(os.Getenv("FRONTEND_URL")); v != "" {
		return ValidateURL(v, DefaultFrontendURL)
	}

	// ALLOWED_ORIGINS is a comma-separated list of origins the core gateway
	// accepts (e.g. "https://myscrollr.com,https://api.myscrollr.com").
	// The first entry is typically the primary frontend.
	if origins := strings.TrimSpace(os.Getenv("ALLOWED_ORIGINS")); origins != "" {
		first := strings.SplitN(origins, ",", 2)[0]
		first = strings.TrimSpace(first)
		if first != "" {
			log.Printf("[FrontendURL] FRONTEND_URL not set, deriving from ALLOWED_ORIGINS: %s", first)
			return ValidateURL(first, DefaultFrontendURL)
		}
	}

	log.Printf("[Security Warning] FRONTEND_URL and ALLOWED_ORIGINS not set, using default %s", DefaultFrontendURL)
	return DefaultFrontendURL
}

// =============================================================================
// Shared League Data Fetcher (used by both dashboard & user handlers)
// =============================================================================

// LeagueCacheTTL controls how long assembled league data is cached in Redis.
const LeagueCacheTTL = 90 * time.Second
const LeagueCachePrefix = "fantasy:leagues:"

// fetchLeagueBundle fetches all leagues + standings + matchups + rosters for a
// user (identified by their Yahoo GUID). This is the single implementation of
// the 4-query sequence, eliminating duplication between handleInternalDashboard
// and GetMyYahooLeagues.
func (a *App) fetchLeagueBundle(ctx context.Context, guid string) ([]LeagueResponse, error) {
	// Fetch all leagues via the user_leagues junction table
	leagueRows, err := a.db.Query(ctx, `
		SELECT l.league_key, l.name, l.game_code, l.season, l.data,
		       ul.team_key, ul.team_name
		FROM yahoo_leagues l
		JOIN yahoo_user_leagues ul ON l.league_key = ul.league_key
		WHERE ul.guid = $1
		ORDER BY l.game_code, l.season DESC
	`, guid)
	if err != nil {
		return nil, fmt.Errorf("query leagues: %w", err)
	}
	defer leagueRows.Close()

	leagues := make([]LeagueResponse, 0)
	leagueKeys := make([]string, 0)
	for leagueRows.Next() {
		var lr LeagueResponse
		if err := leagueRows.Scan(
			&lr.LeagueKey, &lr.Name, &lr.GameCode, &lr.Season, &lr.Data,
			&lr.TeamKey, &lr.TeamName,
		); err != nil {
			log.Printf("[LeagueBundle] Scan error: %v", err)
			continue
		}
		leagues = append(leagues, lr)
		leagueKeys = append(leagueKeys, lr.LeagueKey)
	}

	if len(leagues) == 0 {
		return leagues, nil
	}

	// Batch-fetch standings
	standingsMap := make(map[string]json.RawMessage)
	standingsRows, err := a.db.Query(ctx,
		"SELECT league_key, data FROM yahoo_standings WHERE league_key = ANY($1)", leagueKeys)
	if err == nil {
		defer standingsRows.Close()
		for standingsRows.Next() {
			var lk string
			var data json.RawMessage
			if err := standingsRows.Scan(&lk, &data); err == nil {
				standingsMap[lk] = data
			}
		}
	}

	// Batch-fetch matchups for the two most recent weeks per league.
	// Current week (latest) is exposed as `matchups`; previous week (if any)
	// is exposed as `previous_matchups` so the UI can show last week's final
	// result alongside this week's live game.
	matchupsMap := make(map[string]json.RawMessage)
	prevMatchupsMap := make(map[string]json.RawMessage)
	matchupsRows, err := a.db.Query(ctx, `
		SELECT league_key, week, data, rank() OVER (PARTITION BY league_key ORDER BY week DESC) AS r
		FROM yahoo_matchups
		WHERE league_key = ANY($1)
	`, leagueKeys)
	if err == nil {
		defer matchupsRows.Close()
		for matchupsRows.Next() {
			var lk string
			var week int
			var data json.RawMessage
			var r int
			if err := matchupsRows.Scan(&lk, &week, &data, &r); err == nil {
				switch r {
				case 1:
					matchupsMap[lk] = data
				case 2:
					prevMatchupsMap[lk] = data
				}
			}
		}
	}

	// Batch-fetch all rosters grouped by league
	rostersMap := make(map[string]json.RawMessage)
	rostersRows, err := a.db.Query(ctx, `
		SELECT league_key,
		       json_agg(json_build_object('team_key', team_key, 'data', data)) AS rosters
		FROM yahoo_rosters
		WHERE league_key = ANY($1)
		GROUP BY league_key
	`, leagueKeys)
	if err == nil {
		defer rostersRows.Close()
		for rostersRows.Next() {
			var lk string
			var data json.RawMessage
			if err := rostersRows.Scan(&lk, &data); err == nil {
				rostersMap[lk] = data
			}
		}
	}

	// Attach associated data to each league
	for i := range leagues {
		lk := leagues[i].LeagueKey
		if s, ok := standingsMap[lk]; ok {
			leagues[i].Standings = s
		}
		if m, ok := matchupsMap[lk]; ok {
			leagues[i].Matchups = m
		}
		if pm, ok := prevMatchupsMap[lk]; ok {
			leagues[i].PreviousMatchups = pm
		}
		if r, ok := rostersMap[lk]; ok {
			leagues[i].Rosters = r
		}
	}

	return leagues, nil
}

// fetchLeagueBundleCached wraps fetchLeagueBundle with a Redis cache layer
// and singleflight to collapse concurrent cache-miss requests for the same user.
// Fantasy data only changes every ~120s (sync interval), so caching the
// assembled response eliminates redundant DB queries for concurrent requests.
func (a *App) fetchLeagueBundleCached(ctx context.Context, guid string) ([]LeagueResponse, error) {
	cacheKey := LeagueCachePrefix + guid

	// Try cache first
	cached, err := a.rdb.Get(ctx, cacheKey).Bytes()
	if err == nil {
		var leagues []LeagueResponse
		if json.Unmarshal(cached, &leagues) == nil {
			return leagues, nil
		}
	}

	// Cache miss — use singleflight to collapse concurrent requests for same guid.
	// If 100 requests hit this simultaneously for the same user, only 1 runs the
	// 4-query DB sequence; the other 99 wait and share the result.
	result, err, _ := a.leagueFlight.Do(guid, func() (any, error) {
		leagues, err := a.fetchLeagueBundle(ctx, guid)
		if err != nil {
			return nil, err
		}

		// Store in cache (best-effort)
		if data, marshalErr := json.Marshal(leagues); marshalErr == nil {
			a.rdb.Set(ctx, cacheKey, data, LeagueCacheTTL)
		}

		return leagues, nil
	})

	if err != nil {
		return nil, err
	}
	return result.([]LeagueResponse), nil
}

// invalidateLeagueCache removes the cached league data for a user.
// Called when CDC events arrive or after league import/disconnect.
func (a *App) invalidateLeagueCache(ctx context.Context, guid string) {
	a.rdb.Del(ctx, LeagueCachePrefix+guid)
}

// =============================================================================
// Internal Routes (called by core gateway)
// =============================================================================

// handleInternalCDC receives CDC records from the core gateway and returns the
// list of users who should receive these records.
//
// All fantasy tables route via league_key → fantasy:league_users:{league_key}.
// yahoo_leagues uses league_key as its PK; standings/matchups/rosters have it
// as a column.  Zero SQL JOINs in the hot path — all lookups are Redis SMEMBERS.
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

	for _, record := range req.Records {
		var leagueKey string

		switch record.Metadata.TableName {
		case "yahoo_leagues":
			// league_key is the PK of yahoo_leagues
			lk, ok := record.Record["league_key"].(string)
			if !ok || lk == "" {
				continue
			}
			leagueKey = lk

		case "yahoo_standings", "yahoo_matchups", "yahoo_rosters":
			// All have a league_key column
			lk, ok := record.Record["league_key"].(string)
			if !ok || lk == "" {
				continue
			}
			leagueKey = lk

		default:
			continue
		}

		subs, err := GetSubscribers(a.rdb, ctx, RedisLeagueUsersPrefix+leagueKey)
		if err != nil {
			log.Printf("[Fantasy CDC] Failed to get subscribers for league=%s: %v", leagueKey, err)
			continue
		}
		for _, sub := range subs {
			userSet[sub] = struct{}{}
		}
	}

	users := make([]string, 0, len(userSet))
	for sub := range userSet {
		users = append(users, sub)
	}

	// Invalidate cached league bundles for all affected users (best-effort)
	for _, sub := range users {
		var guid string
		if err := a.db.QueryRow(ctx,
			"SELECT guid FROM yahoo_users WHERE logto_sub = $1", sub).Scan(&guid); err == nil {
			a.invalidateLeagueCache(ctx, guid)
		}
	}

	return c.JSON(fiber.Map{"users": users})
}

// handleInternalDashboard returns fantasy data for a user's dashboard.
// Uses the shared fetchLeagueBundleCached to avoid query duplication.
// Query param: user={logto_sub}
func (a *App) handleInternalDashboard(c *fiber.Ctx) error {
	userSub := c.Query("user")
	if userSub == "" {
		return c.JSON(fiber.Map{"fantasy": nil})
	}

	// Resolve logto_sub → guid
	var guid string
	err := a.db.QueryRow(context.Background(),
		"SELECT guid FROM yahoo_users WHERE logto_sub = $1", userSub).Scan(&guid)
	if err != nil {
		return c.JSON(fiber.Map{"fantasy": nil})
	}

	leagues, err := a.fetchLeagueBundleCached(context.Background(), guid)
	if err != nil {
		log.Printf("[Dashboard] fetchLeagueBundle error for guid=%s: %v", guid, err)
		return c.JSON(fiber.Map{"fantasy": nil})
	}

	return c.JSON(fiber.Map{"fantasy": MyLeaguesResponse{Leagues: leagues}})
}

// healthHandler returns the health status of the Fantasy API including sync state.
func (a *App) healthHandler(c *fiber.Ctx) error {
	health := fiber.Map{
		"status": "healthy",
	}
	if a.syncState != nil {
		for k, v := range a.syncState.snapshot() {
			health[k] = v
		}
	}
	return c.JSON(health)
}
