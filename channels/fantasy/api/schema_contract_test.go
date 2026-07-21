package main

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Fantasy no longer runs migrations — core-api owns every shared table
// (VISION 4.3). The Rust ingesters get their drift guard from sqlx's
// compile-time query checking; Go has no equivalent, so this test is
// fantasy's: it asserts every column this service reads or writes still
// exists, with a compatible type.
//
// Skips without TEST_DATABASE_URL, like the other integration tests. CI
// provides one (.github/workflows/backend-tests.yml), so a core migration
// that drops a column fantasy depends on fails the build there.
//
// When you add a column to a query in this service, add it here too.
var schemaContract = map[string][]string{
	"yahoo_users":        {"guid", "logto_sub", "refresh_token", "last_sync", "created_at"},
	"yahoo_leagues":      {"league_key", "name", "game_code", "season", "data", "updated_at"},
	"yahoo_user_leagues": {"guid", "league_key", "team_key", "team_name", "created_at"},
	"yahoo_matchups":     {"league_key", "week", "data", "updated_at"},
	"yahoo_rosters":      {"team_key", "league_key", "data", "updated_at"},
	"yahoo_standings":    {"league_key", "data", "updated_at"},
}

func TestSchemaContract(t *testing.T) {
	dbURL := os.Getenv("TEST_DATABASE_URL")
	if dbURL == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping schema contract test")
	}

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dbURL)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer pool.Close()

	// This module no longer depends on a migration tool, and CI hands each
	// job a fresh empty database. Apply core's baseline when the schema
	// isn't there yet so the test asserts against real DDL rather than
	// skipping. Applying it twice errors harmlessly — the column checks
	// below are the actual assertion either way.
	var present bool
	if err := pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM information_schema.tables
			WHERE table_schema = 'public' AND table_name = 'yahoo_users'
		)`).Scan(&present); err != nil {
		t.Fatalf("probe schema: %v", err)
	}
	if !present {
		baseline, err := os.ReadFile(filepath.Join("..", "..", "..", "api", "migrations", "000001_baseline.up.sql"))
		if err != nil {
			t.Fatalf("read core baseline (core owns the schema — VISION 4.3): %v", err)
		}
		if _, err := pool.Exec(ctx, string(baseline)); err != nil {
			t.Fatalf("apply core baseline: %v", err)
		}
	}

	for table, columns := range schemaContract {
		t.Run(table, func(t *testing.T) {
			for _, col := range columns {
				var exists bool
				err := pool.QueryRow(ctx, `
					SELECT EXISTS (
						SELECT 1 FROM information_schema.columns
						WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
					)`, table, col).Scan(&exists)
				if err != nil {
					t.Fatalf("query information_schema for %s.%s: %v", table, col, err)
				}
				if !exists {
					t.Errorf("%s.%s is missing — fantasy reads or writes it, but core's "+
						"migrations no longer create it. Add it back in api/migrations, "+
						"or update this service and the contract above.", table, col)
				}
			}
		})
	}
}
