package core

import (
	"context"
	"testing"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/brandon-relentnet/myscrollr/api/internal/testsupport"
)

func TestIntegrationProductAnalyticsSchemaAndCascade(t *testing.T) {
	setupIntegrationDB(t)
	ctx := context.Background()
	const sub = "analytics_schema_user"

	testsupport.MustExec(t, `
		INSERT INTO product_analytics_enrollments (logto_sub)
		VALUES ($1)`, sub)
	testsupport.MustExec(t, `
		INSERT INTO product_activity_daily
			(logto_sub, day, sports, markets, news, fantasy, predictions, utilities)
		VALUES ($1, DATE '2026-09-10', true, false, true, false, false, true)`, sub)

	var enrolledAtNotNull, defaultsOff bool
	err := platform.DBPool.QueryRow(ctx, `
		SELECT enrolled_at IS NOT NULL,
		       NOT markets AND NOT fantasy AND NOT predictions
		  FROM product_analytics_enrollments e
		  JOIN product_activity_daily d USING (logto_sub)
		 WHERE e.logto_sub = $1`, sub).Scan(&enrolledAtNotNull, &defaultsOff)
	if err != nil {
		t.Fatalf("read product analytics rows: %v", err)
	}
	if !enrolledAtNotNull || !defaultsOff {
		t.Fatalf("schema defaults: enrolled_at=%v defaults_off=%v", enrolledAtNotNull, defaultsOff)
	}

	testsupport.MustExec(t, `DELETE FROM product_analytics_enrollments WHERE logto_sub = $1`, sub)
	if n := queryCount(t, `SELECT count(*) FROM product_activity_daily WHERE logto_sub = $1`, sub); n != 0 {
		t.Fatalf("daily facts after enrollment delete = %d, want 0", n)
	}
}

func TestIntegrationProductActivityPrunesOnlyExpiredFacts(t *testing.T) {
	setupIntegrationDB(t)
	const sub = "analytics_prune_user"
	testsupport.MustExec(t, `
		INSERT INTO product_analytics_enrollments (logto_sub, first_active_day)
		VALUES ($1, DATE '2026-01-01')`, sub)
	testsupport.MustExec(t, `
		INSERT INTO product_activity_daily (logto_sub, day)
		VALUES ($1, DATE '2026-06-12'), ($1, DATE '2026-06-13')`, sub)

	platform.PruneProductActivity(context.Background(), time.Date(2026, 9, 10, 12, 0, 0, 0, time.UTC))

	if n := queryCount(t, `SELECT count(*) FROM product_activity_daily WHERE logto_sub = $1`, sub); n != 1 {
		t.Fatalf("daily facts after prune = %d, want boundary row only", n)
	}
	if n := queryCount(t, `SELECT count(*) FROM product_analytics_enrollments WHERE logto_sub = $1`, sub); n != 1 {
		t.Fatalf("enrollment rows after prune = %d, want cohort metadata preserved", n)
	}
}
