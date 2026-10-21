package admin

import (
	"context"
	"testing"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/accounts"
	"github.com/brandon-relentnet/myscrollr/api/internal/billing"
	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/brandon-relentnet/myscrollr/api/internal/testsupport"
)

func TestPopulationMatchesSameSessionAndFiltersGrowthAndCustomers(t *testing.T) {
	resetPresenceTables(t)
	now := time.Now().UTC()
	hour := now.Add(-time.Hour).Truncate(time.Hour)
	// A has Windows/v1 and macOS/v2. It must NOT match Windows/v2.
	for _, sub := range []string{"a", "b", "old"} {
		enroll(t, sub, false, hour.Format("2006-01-02"))
	}
	hourly(t, "a", "a-win", "windows", "v1", false, hour, 60, 60, 60, 1)
	hourly(t, "a", "a-mac", "macos", "v2", false, hour, 60, 60, 60, 1)
	hourly(t, "b", "b-win", "windows", "v2", false, hour, 60, 60, 60, 1)
	hourly(t, "old", "old-win", "windows", "v2", false, hour.AddDate(0, 0, -100), 60, 60, 60, 1)
	testsupport.MustExec(t, `INSERT INTO stripe_customers (logto_sub,stripe_customer_id,plan,status)
		VALUES ('a','cus_a','monthly','active'), ('b','cus_b','monthly','active')`)
	testsupport.MustExec(t, `DELETE FROM user_preferences`)
	testsupport.MustExec(t, `INSERT INTO user_preferences(logto_sub) VALUES ('a'),('b')`)
	withLogtoAccounts(t, 4, false,
		accounts.LogtoAccount{ID: "a", CreatedAt: now.Add(-time.Hour).UnixMilli()},
		accounts.LogtoAccount{ID: "b", CreatedAt: now.Add(-2 * time.Hour).UnixMilli()},
		accounts.LogtoAccount{ID: "old", CreatedAt: now.Add(-3 * time.Hour).UnixMilli()},
		accounts.LogtoAccount{ID: "no-device", CreatedAt: now.Add(-4 * time.Hour).UnixMilli()},
	)
	ctx, _ := platform.WithAnalyticsPopulation(context.Background(), "windows", "v2", "monthly")
	period, _ := ParsePeriod("7d", now)
	got := loadAudience(ctx, period, true, now)
	if !got.Available || got.Total != 1 || got.New.Value != 1 || got.SetUp != 1 {
		t.Fatalf("filtered audience: %+v", got)
	}
	paying, err := billing.LoadPayingNow(ctx)
	if err != nil || !paying.Available || paying.Paying != 1 {
		t.Fatalf("paying=%+v err=%v", paying, err)
	}
	seedLedger(t, billing.Ledger{
		FetchedAt: now,
		Charges: []billing.ChargeLite{
			{ID: "ch_a", Customer: "cus_a", Paid: true, Status: "succeeded", Amount: 1000, Created: hour},
			{ID: "ch_b", Customer: "cus_b", Paid: true, Status: "succeeded", Amount: 200, Created: hour},
		},
		Transactions: []billing.BalanceTxn{
			{ID: "txn_a", Source: "ch_a", Type: "charge", Currency: "usd", Net: 1000, Created: hour},
			{ID: "txn_b", Source: "ch_b", Type: "charge", Currency: "usd", Net: 200, Created: hour},
			{ID: "refund_b", SourceCharge: "ch_b", Type: "refund", Currency: "usd", Net: -50, Created: hour},
		},
	})
	revenue := loadRevenue(ctx, period, now)
	if !revenue.Earnings.Available || revenue.Earnings.Net.Value != 150 || revenue.NewPaying.InPeriod.Value != 1 || revenue.PayingNow.Paying != 1 {
		t.Fatalf("filtered revenue=%+v", revenue)
	}
	free, _ := platform.WithAnalyticsPopulation(context.Background(), "", "", "free")
	got = loadAudience(free, period, true, now)
	if !got.Available || got.Total != 2 {
		t.Fatalf("free includes accounts without Stripe/device records: %+v", got)
	}
	none, _ := platform.WithAnalyticsPopulation(context.Background(), "windows", "v2' OR true --", "")
	got = loadAudience(none, period, true, now)
	if !got.Available || got.Total != 0 {
		t.Fatalf("filter must remain a bound value: %+v", got)
	}
}
