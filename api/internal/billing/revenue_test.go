package billing

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/stripe/stripe-go/v82"
)

func at(day int) time.Time { return time.Date(2026, 9, day, 12, 0, 0, 0, time.UTC) }

func TestClassifyTransactionsCountsFeesOnceAndExcludesMovements(t *testing.T) {
	txns := []BalanceTxn{
		{ID: "1", Type: "charge", ReportingCategory: "charge", Currency: "usd", Amount: 999, Fee: 59, Net: 940, Created: at(2)},
		{ID: "2", Type: "payment", ReportingCategory: "charge", Currency: "usd", Amount: 4999, Fee: 175, Net: 4824, Created: at(5)},
		{ID: "3", Type: "refund", ReportingCategory: "refund", Currency: "usd", Amount: -999, Fee: 0, Net: -999, Created: at(6)},
		{ID: "4", Type: "refund_failure", ReportingCategory: "refund_failure", Currency: "usd", Amount: 999, Fee: 0, Net: 999, Created: at(7)},
		{ID: "5", Type: "adjustment", ReportingCategory: "dispute", Currency: "usd", Amount: -4999, Fee: 1500, Net: -6499, Created: at(8)},
		{ID: "6", Type: "stripe_fee", ReportingCategory: "fee", Currency: "usd", Amount: -200, Fee: 0, Net: -200, Created: at(9)},
		{ID: "7", Type: "payout", ReportingCategory: "payout", Currency: "usd", Amount: -3000, Fee: 0, Net: -3000, Created: at(9)},
		{ID: "8", Type: "climate_order_purchase", ReportingCategory: "other_adjustment", Currency: "usd", Amount: -100, Fee: 0, Net: -100, Created: at(9)},
		{ID: "9", Type: "charge", ReportingCategory: "charge", Currency: "eur", Amount: 1000, Fee: 40, Net: 960, Created: at(9)},
		{ID: "10", Type: "charge", ReportingCategory: "charge", Currency: "usd", Amount: 999, Fee: 59, Net: 940, Created: at(10)}, // at the end boundary
	}
	got := ClassifyTransactions(txns, at(1), at(10))
	if len(got) != 2 || got[0].Currency != "eur" || got[1].Currency != "usd" {
		t.Fatalf("currencies = %+v", got)
	}
	usd := got[1]
	if usd.Payments.Count != 2 || usd.Payments.Net != 5764 {
		t.Fatalf("payments = %+v (id 10 sits on the end bound and must be out)", usd.Payments)
	}
	if usd.Refunds.Net != -999 || usd.RefundReversals.Net != 999 || usd.Disputes.Net != -6499 || usd.Fees.Net != -200 {
		t.Fatalf("lines = refunds %+v reversals %+v disputes %+v fees %+v", usd.Refunds, usd.RefundReversals, usd.Disputes, usd.Fees)
	}
	// 5764 − 999 + 999 − 6499 − 200 = −935. The payout and the unknown type
	// are listed, never summed; fees inside charges are not subtracted twice.
	if usd.Net != -935 {
		t.Fatalf("net = %d, want -935", usd.Net)
	}
	// Gross fees reconcile with net: per-transaction fees plus the standalone
	// fee row (whose fee is its own negative net).
	if usd.GrossFees != 59+175+1500+200 {
		t.Fatalf("gross fees = %d", usd.GrossFees)
	}
	if len(usd.Movements) != 1 || usd.Movements[0].Kind != "payout" || usd.Movements[0].Amount != -3000 {
		t.Fatalf("movements = %+v", usd.Movements)
	}
	if len(usd.Unclassified) != 1 || usd.Unclassified[0].Kind != "climate_order_purchase" {
		t.Fatalf("unclassified = %+v", usd.Unclassified)
	}
	if got[0].Net != 960 {
		t.Fatalf("eur kept apart: %+v", got[0])
	}
	// Lifetime (zero start) includes the boundary row.
	life := ClassifyTransactions(txns, time.Time{}, at(11))
	if life[1].Payments.Count != 3 {
		t.Fatalf("lifetime payments = %+v", life[1].Payments)
	}
	// The unknown reporting category with a known type falls back to type.
	if classify(BalanceTxn{Type: "refund", ReportingCategory: "something_new"}) != "refunds" {
		t.Fatal("type fallback broken")
	}
}

func TestFirstPaymentsIgnoreTrialsRenewalsAndFailures(t *testing.T) {
	charges := []ChargeLite{
		{ID: "c0", Customer: "cus_a", Amount: 0, Paid: true, Status: "succeeded", Created: at(1)},   // zero-value: not a payment
		{ID: "c1", Customer: "cus_a", Amount: 999, Paid: true, Status: "succeeded", Created: at(3)}, // first real payment
		{ID: "c2", Customer: "cus_a", Amount: 999, Paid: true, Status: "succeeded", Created: at(8)}, // renewal
		{ID: "c3", Customer: "cus_b", Amount: 999, Paid: false, Status: "failed", Created: at(4)},   // failed
		{ID: "c4", Customer: "cus_b", Amount: 4999, Paid: true, Status: "succeeded", Created: at(9)},
		{ID: "c5", Customer: "", Amount: 999, Paid: true, Status: "succeeded", Created: at(2)}, // no customer
	}
	first := FirstPayments(charges)
	if len(first) != 2 || !first["cus_a"].Equal(at(3)) || !first["cus_b"].Equal(at(9)) {
		t.Fatalf("first payments = %v", first)
	}
	if CountFirstPayments(first, at(2), at(5)) != 1 || CountFirstPayments(first, at(8), at(10)) != 1 || CountFirstPayments(first, time.Time{}, at(10)) != 2 {
		t.Fatal("window counts wrong")
	}
	if CountFirstPayments(first, at(3), at(3)) != 0 {
		t.Fatal("empty window must count nothing")
	}
}

func TestNetByBucketClipsToTheWindow(t *testing.T) {
	txns := []BalanceTxn{
		{Type: "charge", ReportingCategory: "charge", Currency: "usd", Net: 100, Created: at(1).Add(-time.Second)},
		{Type: "charge", ReportingCategory: "charge", Currency: "usd", Net: 200, Created: at(1)},
		{Type: "refund", ReportingCategory: "refund", Currency: "usd", Net: -50, Created: at(2).Add(3 * time.Hour)},
		{Type: "payout", ReportingCategory: "payout", Currency: "usd", Net: -900, Created: at(2)},
		{Type: "charge", ReportingCategory: "charge", Currency: "eur", Net: 700, Created: at(2)},
	}
	start, end := at(1), at(3)
	buckets := platform.Buckets(start, end, 24*time.Hour)
	NetByBucket(txns, "usd", buckets, start, end, 24*time.Hour)
	if buckets[0].Value != 200 || buckets[1].Value != -50 {
		t.Fatalf("buckets = %+v", buckets)
	}
}

func TestIsPayingAndPlanMixVocabulary(t *testing.T) {
	cases := []struct {
		plan, status string
		lifetime     bool
		want         bool
	}{
		{"free", "active", false, false},
		{"", "active", false, false},
		{"monthly", "active", false, true},
		{"monthly", "trialing", false, false},
		{"monthly", "past_due", false, false},
		{"monthly", "canceling", false, false},
		{"lifetime", "active", true, true},
		{"lifetime", "canceled", true, true},
		// Lifetime wins whatever the plan column says — exactly as PayingWhere
		// reads it in SQL (a lifetime purchase never has a subscription plan).
		{"free", "none", true, true},
		{"", "canceled", true, true},
		{" Pro_Annual ", " Active ", false, true},
	}
	for _, c := range cases {
		if got := IsPaying(c.plan, c.status, c.lifetime); got != c.want {
			t.Errorf("IsPaying(%q,%q,%v) = %v", c.plan, c.status, c.lifetime, got)
		}
	}
	for plan, want := range map[string][2]string{
		"monthly": {"uplink", "monthly"}, "annual": {"uplink", "annual"}, "pro_monthly": {"pro", "monthly"},
		"ultimate_annual": {"ultimate", "annual"}, "free": {"free", ""}, "unknown": {"unknown", "unknown"},
	} {
		tier, interval := planTierInterval(plan, false)
		if tier != want[0] || interval != want[1] {
			t.Errorf("planTierInterval(%q) = %s/%s, want %s/%s", plan, tier, interval, want[0], want[1])
		}
	}
	if tier, interval := planTierInterval("lifetime", true); tier != "ultimate" || interval != "lifetime" {
		t.Errorf("lifetime = %s/%s", tier, interval)
	}
}

// The Stripe walk itself: two pages of balance transactions and one of
// charges from a stub backend, mapped field for field.
func TestFetchLedgerPagesThroughStripe(t *testing.T) {
	var paths []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.URL.Path+"?"+r.URL.RawQuery)
		w.Header().Set("Content-Type", "application/json")
		switch {
		case strings.HasPrefix(r.URL.Path, "/v1/balance_transactions"):
			if strings.Contains(r.URL.RawQuery, "starting_after=txn_1") {
				_ = json.NewEncoder(w).Encode(map[string]any{"object": "list", "has_more": false, "data": []map[string]any{
					{"id": "txn_2", "object": "balance_transaction", "type": "refund", "reporting_category": "refund", "currency": "usd", "amount": -999, "fee": 0, "net": -999, "created": 1757600000, "source": "re_1"},
				}})
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"object": "list", "has_more": true, "data": []map[string]any{
				{"id": "txn_1", "object": "balance_transaction", "type": "charge", "reporting_category": "charge", "currency": "USD", "amount": 999, "fee": 59, "net": 940, "created": 1757500000, "source": "ch_1"},
			}})
		case strings.HasPrefix(r.URL.Path, "/v1/charges"):
			_ = json.NewEncoder(w).Encode(map[string]any{"object": "list", "has_more": false, "data": []map[string]any{
				{"id": "ch_1", "object": "charge", "amount": 999, "currency": "usd", "paid": true, "status": "succeeded", "created": 1757500000, "customer": "cus_1"},
			}})
		default:
			w.WriteHeader(404)
		}
	}))
	defer server.Close()
	prevKey, prevBackend := stripe.Key, stripe.GetBackend(stripe.APIBackend)
	stripe.Key = "sk_test_stub"
	stripe.SetBackend(stripe.APIBackend, stripe.GetBackendWithConfig(stripe.APIBackend, &stripe.BackendConfig{URL: stripe.String(server.URL)}))
	t.Cleanup(func() {
		stripe.Key = prevKey
		stripe.SetBackend(stripe.APIBackend, prevBackend)
	})

	txns, partial, err := fetchBalanceTransactions(t.Context())
	if err != nil || partial || len(txns) != 2 {
		t.Fatalf("txns = %+v partial=%v err=%v", txns, partial, err)
	}
	if txns[0].ID != "txn_1" || txns[0].Currency != "usd" || txns[0].Net != 940 || txns[0].Fee != 59 || txns[0].Source != "ch_1" || txns[0].ReportingCategory != "charge" {
		t.Fatalf("txn mapping = %+v", txns[0])
	}
	if txns[1].Net != -999 || txns[1].Created.Year() != 2025 {
		t.Fatalf("second txn = %+v", txns[1])
	}
	charges, _, err := fetchCharges(t.Context())
	if err != nil || len(charges) != 1 || charges[0].Customer != "cus_1" || !charges[0].Paid || charges[0].Status != "succeeded" {
		t.Fatalf("charges = %+v err=%v", charges, err)
	}
	for _, p := range paths {
		if !strings.Contains(p, "limit=100") {
			t.Fatalf("page size not pinned: %s", p)
		}
	}
}
