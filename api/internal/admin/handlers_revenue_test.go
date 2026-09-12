package admin

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/billing"
	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/brandon-relentnet/myscrollr/api/internal/testsupport"
	"github.com/stripe/stripe-go/v82"
)

// The ledger is cached in Redis for ten minutes; seeding that cache is how
// the report is exercised without a Stripe backend.
func seedLedger(t *testing.T, l billing.Ledger) {
	t.Helper()
	if platform.Rdb == nil {
		t.Skip("redis unavailable")
	}
	raw, _ := json.Marshal(l)
	if err := platform.Rdb.Set(context.Background(), "scrollr:admin:stripe:ledger", raw, time.Minute).Err(); err != nil {
		t.Fatal(err)
	}
	prev := stripe.Key
	stripe.Key = "sk_test_seeded"
	t.Cleanup(func() {
		stripe.Key = prev
		_ = platform.Rdb.Del(context.Background(), "scrollr:admin:stripe:ledger").Err()
	})
}

func TestRevenueReportUsesTheSharedPredicateAndTheLedger(t *testing.T) {
	if platform.DBPool == nil {
		t.Skip("TEST_DATABASE_URL not set")
	}
	testsupport.MustExec(t, `DELETE FROM stripe_customers`)
	testsupport.MustExec(t, `INSERT INTO stripe_customers (logto_sub, stripe_customer_id, plan, status, lifetime) VALUES
		('p1', 'cus_1', 'monthly', 'active', false),
		('p2', 'cus_2', 'lifetime', 'active', true),
		('deleted-x', 'cus_3', 'lifetime', 'canceled', true),
		('t1', 'cus_4', 'pro_annual', 'trialing', false),
		('o1', 'cus_5', 'ultimate_monthly', 'past_due', false),
		('c1', 'cus_6', 'annual', 'canceling', false),
		('x1', 'cus_7', 'free', 'canceled', false),
		('f1', 'cus_8', 'free', 'active', false)`)
	now := time.Date(2026, 9, 11, 12, 0, 0, 0, time.UTC)
	day := func(d int) time.Time { return time.Date(2026, 9, d, 10, 0, 0, 0, time.UTC) }
	seedLedger(t, billing.Ledger{
		FetchedAt: now,
		Transactions: []billing.BalanceTxn{
			{ID: "t1", Type: "charge", ReportingCategory: "charge", Currency: "usd", Amount: 999, Fee: 59, Net: 940, Created: day(10)},
			{ID: "t2", Type: "charge", ReportingCategory: "charge", Currency: "usd", Amount: 99900, Fee: 2927, Net: 96973, Created: day(6)},
			{ID: "t3", Type: "refund", ReportingCategory: "refund", Currency: "usd", Amount: -999, Net: -999, Created: day(9)},
			{ID: "t4", Type: "payout", ReportingCategory: "payout", Currency: "usd", Amount: -50000, Net: -50000, Created: day(9)},
			{ID: "t5", Type: "charge", ReportingCategory: "charge", Currency: "usd", Amount: 999, Fee: 59, Net: 940, Created: day(1)}, // previous window
			// Older than both windows: makes the ledger's coverage complete for
			// the comparison and counts only in lifetime.
			{ID: "t0", Type: "charge", ReportingCategory: "charge", Currency: "usd", Amount: 500, Fee: 0, Net: 500, Created: time.Date(2026, 8, 20, 10, 0, 0, 0, time.UTC)},
		},
		Charges: []billing.ChargeLite{
			{ID: "c1", Customer: "cus_1", Amount: 999, Paid: true, Status: "succeeded", Created: day(1)},  // first payment, previous window
			{ID: "c2", Customer: "cus_1", Amount: 999, Paid: true, Status: "succeeded", Created: day(10)}, // renewal
			{ID: "c3", Customer: "cus_2", Amount: 99900, Paid: true, Status: "succeeded", Created: day(6)},
			{ID: "c4", Customer: "cus_4", Amount: 0, Paid: true, Status: "succeeded", Created: day(9)}, // trial invoice
			{ID: "c0", Customer: "cus_9", Amount: 500, Paid: true, Status: "succeeded", Created: time.Date(2026, 8, 20, 10, 0, 0, 0, time.UTC)},
		},
	})
	period, _ := ParsePeriod("7d", now)
	out := loadRevenue(context.Background(), period, now)

	pn := out.PayingNow
	if pn.Paying != 3 || pn.Lifetime != 2 || pn.Trialing != 1 || pn.PastDue != 1 || pn.Canceling != 1 || pn.Canceled != 1 || pn.Free != 1 {
		t.Fatalf("paying now = %+v", pn)
	}
	if !out.Earnings.Available || out.Earnings.PrimaryCurrency != "usd" {
		t.Fatalf("earnings = %+v", out.Earnings)
	}
	// Window Sep 4–11: t1 + t2 + t3 = 940 + 96973 − 999 = 96914; payout excluded.
	if out.Earnings.Net.Value != 96914 || len(out.Earnings.Currencies) != 1 || out.Earnings.Currencies[0].Payments.Count != 2 {
		t.Fatalf("net = %v currencies %+v", out.Earnings.Net.Value, out.Earnings.Currencies)
	}
	if !out.Earnings.Net.Comparison.Comparable || *out.Earnings.Net.Comparison.Previous != 940 {
		t.Fatalf("net comparison = %+v", out.Earnings.Net.Comparison)
	}
	if len(out.Earnings.Lifetime) != 1 || out.Earnings.Lifetime[0].Net != 96914+940+500 {
		t.Fatalf("lifetime = %+v", out.Earnings.Lifetime)
	}
	// Daily buckets start at the window start (Sep 4 12:00): the 6th's
	// payment is bucket 1, the 9th's refund bucket 4, the 10th's payment
	// bucket 5; the payout appears nowhere.
	if len(out.Earnings.Curve) != 7 || out.Earnings.Curve[1].Value != 96973 || out.Earnings.Curve[4].Value != -999 || out.Earnings.Curve[5].Value != 940 || out.Earnings.Curve[6].Value != 0 {
		t.Fatalf("curve = %+v", out.Earnings.Curve)
	}
	// New paying: cus_2 first paid on the 6th (in window); cus_1's renewal is
	// not new; cus_4's zero-value trial invoice is not a payment.
	if !out.NewPaying.Available || out.NewPaying.InPeriod.Value != 1 || out.NewPaying.Lifetime != 3 || *out.NewPaying.InPeriod.Comparison.Previous != 1 {
		t.Fatalf("new paying = %+v", out.NewPaying)
	}
	if out.Earnings.Coverage.From == nil {
		t.Fatalf("coverage = %+v", out.Earnings.Coverage)
	}
}

func TestRevenueReportKeepsTheSnapshotWhenStripeIsDown(t *testing.T) {
	if platform.DBPool == nil {
		t.Skip("TEST_DATABASE_URL not set")
	}
	testsupport.MustExec(t, `DELETE FROM stripe_customers`)
	testsupport.MustExec(t, `INSERT INTO stripe_customers (logto_sub, stripe_customer_id, plan, status, lifetime) VALUES ('p1', 'cus_1', 'monthly', 'active', false)`)
	if platform.Rdb != nil {
		_ = platform.Rdb.Del(context.Background(), "scrollr:admin:stripe:ledger").Err()
	}
	prev := stripe.Key
	stripe.Key = ""
	t.Cleanup(func() { stripe.Key = prev })
	now := time.Date(2026, 9, 11, 12, 0, 0, 0, time.UTC)
	period, _ := ParsePeriod("30d", now)
	out := loadRevenue(context.Background(), period, now)
	if out.PayingNow.Paying != 1 {
		t.Fatalf("snapshot lost: %+v", out.PayingNow)
	}
	if out.Earnings.Available || out.Earnings.Net.Available || out.NewPaying.Available || out.Earnings.Note == "" {
		t.Fatalf("stripe down must be visible: %+v", out.Earnings)
	}
}
