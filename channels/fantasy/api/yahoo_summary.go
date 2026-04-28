package main

import (
	"context"
	"database/sql"
	"log"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
)

// YahooSummaryResponse is the minimal account-overview payload consumed by
// the core API's GET /users/me/overview fan-out. It avoids any Yahoo API
// round-trips — connection state and league count are both Postgres reads.
type YahooSummaryResponse struct {
	YahooConnected bool `json:"yahoo_connected"`
	YahooSynced    bool `json:"yahoo_synced"`
	LeagueCount    int  `json:"league_count"`
}

// GetYahooSummary returns whether the user has Yahoo connected, whether
// their leagues have ever been synced, and how many leagues are currently
// imported. Mirrors the GetYahooStatus convention of treating "no row" as
// the unconnected happy path rather than an error.
func (a *App) GetYahooSummary(c *fiber.Ctx) error {
	userID := GetUserSub(c)
	if userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(ErrorResponse{
			Status: "unauthorized",
			Error:  "Authentication required",
		})
	}

	ctx, cancel := context.WithTimeout(c.Context(), 5*time.Second)
	defer cancel()

	// 1. Resolve guid + sync state for this logto_sub. yahoo_users does not
	//    have a boolean `synced` column; sync is recorded as a non-NULL
	//    `last_sync` timestamp, matching GetYahooStatus's derivation.
	var (
		guid     string
		lastSync sql.NullTime
	)
	err := a.db.QueryRow(ctx, `
		SELECT guid, last_sync
		FROM yahoo_users
		WHERE logto_sub = $1
	`, userID).Scan(&guid, &lastSync)
	if err != nil {
		if err == sql.ErrNoRows || strings.Contains(err.Error(), "no rows") {
			// User has never connected Yahoo — happy path, not an error.
			return c.JSON(YahooSummaryResponse{})
		}
		log.Printf("[GetYahooSummary] DB error for logto_sub=%s: %v", userID, err)
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Status: "error",
			Error:  "Failed to load Yahoo summary",
		})
	}

	// 2. Count imported leagues. Don't fail the request on a count error —
	//    connection state is more valuable than the count, so we degrade
	//    gracefully to 0 and log.
	var leagueCount int
	if err := a.db.QueryRow(ctx, `
		SELECT count(*) FROM yahoo_user_leagues WHERE guid = $1
	`, guid).Scan(&leagueCount); err != nil {
		log.Printf("[GetYahooSummary] count leagues failed for guid=%s: %v", guid, err)
		leagueCount = 0
	}

	return c.JSON(YahooSummaryResponse{
		YahooConnected: guid != "",
		YahooSynced:    lastSync.Valid,
		LeagueCount:    leagueCount,
	})
}
