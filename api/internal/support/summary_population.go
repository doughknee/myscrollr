package support

import (
	"context"
	"strings"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/jackc/pgx/v5"
)

// Scope every summary read (including provenance, medians and queue buckets)
// to the same authenticated cases. Email-only matches are not account evidence.
// This context is set only on the analytics summary endpoint, never actions.
func summaryPopulationSQL(ctx context.Context, query string, args []any) (string, []any) {
	population := platform.PopulationFromContext(ctx)
	if !population.Active() {
		return query, args
	}
	caseWhere := population.Predicate("sc.logto_sub", &args)
	customerWhere := population.Predicate("sc.logto_sub", &args)
	prefix := `WITH analytics_cases AS (
		SELECT * FROM support_cases sc
		WHERE sc.account_source = 'authenticated' AND sc.logto_sub <> '' AND ` + caseWhere + `),
		analytics_drafts AS (
		SELECT * FROM support_drafts sd WHERE sd.ticket_number IN (SELECT ticket_number FROM analytics_cases)),
		analytics_customers AS (SELECT * FROM stripe_customers sc WHERE ` + customerWhere + `)`
	query = strings.NewReplacer("support_cases", "analytics_cases", "support_drafts", "analytics_drafts", "stripe_customers", "analytics_customers").Replace(strings.TrimSpace(query))
	if strings.HasPrefix(query, "WITH ") {
		return prefix + ", " + strings.TrimPrefix(query, "WITH "), args
	}
	return prefix + " " + query, args
}

func summaryQuery(ctx context.Context, query string, args ...any) (pgx.Rows, error) {
	query, args = summaryPopulationSQL(ctx, query, args)
	return platform.DBPool.Query(ctx, query, args...)
}

func summaryQueryRow(ctx context.Context, query string, args ...any) pgx.Row {
	query, args = summaryPopulationSQL(ctx, query, args)
	return platform.DBPool.QueryRow(ctx, query, args...)
}
