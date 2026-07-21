package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Fantasy no longer runs migrations — core-api owns every shared table
// (VISION 4.3), so a core migration can silently remove something this
// service depends on. This test is how it finds out.
//
// The header here used to say the Rust ingesters were covered by "sqlx's
// compile-time query checking". They are not: they use runtime
// `sqlx::query`, not the `query!` macro, so nothing is checked at compile
// time. They now have tests/schema_contract.rs, built on this file's shape.
//
// Skips without TEST_DATABASE_URL, like the other integration tests. CI
// provides one (.github/workflows/backend-tests.yml), so a core migration
// that drops a column fantasy depends on fails the build there.
//
// When you add a column to a query in this service, add it here too.
//
// Columns carry their expected information_schema.data_type. Existence alone
// is not enough: widening `week` from smallint or retyping `data` off jsonb
// breaks this service just as surely as dropping the column, and an
// existence-only check waves both through.
var schemaContract = map[string]map[string]string{
	"yahoo_users": {
		"guid": "character varying", "logto_sub": "character varying",
		"refresh_token": "text", "last_sync": "timestamp with time zone",
		"created_at": "timestamp with time zone",
	},
	"yahoo_leagues": {
		"league_key": "character varying", "name": "character varying",
		"game_code": "character varying", "season": "character varying",
		"data": "jsonb", "updated_at": "timestamp with time zone",
	},
	"yahoo_user_leagues": {
		"guid": "character varying", "league_key": "character varying",
		"team_key": "character varying", "team_name": "character varying",
		"created_at": "timestamp with time zone",
	},
	"yahoo_matchups": {
		"league_key": "character varying", "week": "smallint",
		"data": "jsonb", "updated_at": "timestamp with time zone",
	},
	"yahoo_rosters": {
		"team_key": "character varying", "league_key": "character varying",
		"data": "jsonb", "updated_at": "timestamp with time zone",
	},
	"yahoo_standings": {
		"league_key": "character varying", "data": "jsonb",
		"updated_at": "timestamp with time zone",
	},
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
			for col, wantType := range columns {
				var gotType string
				err := pool.QueryRow(ctx, `
					SELECT data_type FROM information_schema.columns
					WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
				`, table, col).Scan(&gotType)
				if errors.Is(err, pgx.ErrNoRows) {
					t.Errorf("%s.%s is missing — fantasy reads or writes it, but core's "+
						"migrations no longer create it. Add it back in api/migrations, "+
						"or update this service and the contract above.", table, col)
					continue
				}
				if err != nil {
					t.Fatalf("query information_schema for %s.%s: %v", table, col, err)
				}
				if gotType != wantType {
					t.Errorf("%s.%s is %q, expected %q — a core migration retyped a column "+
						"fantasy depends on.", table, col, gotType, wantType)
				}
			}
		})
	}
}
