package billing

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"sort"
	"strings"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/stripe/stripe-go/v82"
	"github.com/stripe/stripe-go/v82/balancetransaction"
	"github.com/stripe/stripe-go/v82/charge"
	"golang.org/x/sync/singleflight"
)

// =============================================================================
// Revenue reporting from Stripe's own ledger (SCROLLR-210)
// =============================================================================
//
// stripe_customers is a snapshot of who has access; it holds no amounts, fees
// or refunds and never will. Earnings therefore come from Stripe's balance
// transactions — the ledger Stripe itself reconciles — read through the
// existing global client and cached for ten minutes. Nothing here creates,
// refunds or moves money.
//
// Net earnings = customer payments − refunds − Stripe fees, by transaction
// time: a refund today lowers today, whatever month the purchase was. Each
// transaction's `net` is already `amount − fee`, so fees are subtracted
// exactly once. Payouts are movements of funds and are listed but excluded.

const (
	stripeLedgerCacheKey = "scrollr:admin:stripe:ledger"
	stripeLedgerCacheTTL = 10 * time.Minute
	// stripeLedgerMaxRows bounds one walk. Ten thousand transactions is years
	// of this account; past it the ledger reports itself partial.
	stripeLedgerMaxRows = 10000
)

var (
	listBalanceTransactions = fetchBalanceTransactions
	listCharges             = fetchCharges
	ledgerGroup             singleflight.Group
)

// PayingWhere is the one paying-customer predicate, on alias s. Lifetime
// counts whatever its subscription status says; a subscription counts only
// while Stripe calls it active. Trials, overdue and cancelling rows are
// entitled but not paying and are reported as their own rows.
const PayingWhere = "(s.lifetime OR (s.plan <> 'free' AND s.status = 'active'))"

// IsPaying is PayingWhere in Go, for rows already in hand: lifetime first,
// whatever the plan column says, exactly as the SQL reads.
func IsPaying(plan, status string, lifetime bool) bool {
	if lifetime {
		return true
	}
	p := strings.ToLower(strings.TrimSpace(plan))
	if p == "" || p == "free" {
		return false
	}
	return strings.EqualFold(strings.TrimSpace(status), "active")
}

// BalanceTxn is the slice of a Stripe balance transaction the report reads.
type BalanceTxn struct {
	ID                string    `json:"id"`
	Type              string    `json:"type"`
	ReportingCategory string    `json:"reporting_category"`
	Currency          string    `json:"currency"`
	Amount            int64     `json:"amount"`
	Fee               int64     `json:"fee"`
	Net               int64     `json:"net"`
	Created           time.Time `json:"created"`
	Source            string    `json:"source"`
}

// ChargeLite is what first-payment classification needs from a charge.
type ChargeLite struct {
	ID       string    `json:"id"`
	Customer string    `json:"customer"`
	Amount   int64     `json:"amount"`
	Currency string    `json:"currency"`
	Paid     bool      `json:"paid"`
	Status   string    `json:"status"`
	Created  time.Time `json:"created"`
}

// Ledger is the cached read of Stripe's history. Stripe lists newest first,
// so a walk that hits the row cap is missing the OLDEST rows: Partial covers
// either list, and the two flags say which, because they hurt different
// figures (transactions → lifetime earnings; charges → first-payment dates).
type Ledger struct {
	Transactions        []BalanceTxn `json:"transactions"`
	Charges             []ChargeLite `json:"charges"`
	Partial             bool         `json:"partial"`
	PartialTransactions bool         `json:"partial_transactions"`
	PartialCharges      bool         `json:"partial_charges"`
	FetchedAt           time.Time    `json:"fetched_at"`
}

// LoadLedger returns the full transaction and charge history, from Redis
// when fresh, else from Stripe once (coalesced across concurrent callers).
func LoadLedger(ctx context.Context) (Ledger, bool, error) {
	if stripe.Key == "" {
		return Ledger{}, false, errors.New("Stripe is not configured on this API")
	}
	if platform.Rdb != nil {
		if raw, err := platform.Rdb.Get(ctx, stripeLedgerCacheKey).Bytes(); err == nil {
			var l Ledger
			if json.Unmarshal(raw, &l) == nil {
				return l, true, nil
			}
		}
	}
	r := ledgerGroup.DoChan(stripeLedgerCacheKey, func() (any, error) {
		fctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancel()
		txns, partialT, err := listBalanceTransactions(fctx)
		if err != nil {
			return nil, fmt.Errorf("balance transactions: %w", err)
		}
		charges, partialC, err := listCharges(fctx)
		if err != nil {
			return nil, fmt.Errorf("charges: %w", err)
		}
		l := Ledger{Transactions: txns, Charges: charges, Partial: partialT || partialC,
			PartialTransactions: partialT, PartialCharges: partialC, FetchedAt: time.Now().UTC()}
		if l.Transactions == nil {
			l.Transactions = []BalanceTxn{}
		}
		if l.Charges == nil {
			l.Charges = []ChargeLite{}
		}
		if platform.Rdb != nil {
			if raw, err := json.Marshal(l); err == nil {
				_ = platform.Rdb.Set(context.Background(), stripeLedgerCacheKey, raw, stripeLedgerCacheTTL).Err()
			}
		}
		return l, nil
	})
	select {
	case <-ctx.Done():
		return Ledger{}, false, ctx.Err()
	case res := <-r:
		if res.Err != nil {
			return Ledger{}, false, res.Err
		}
		return res.Val.(Ledger), false, nil
	}
}

func fetchBalanceTransactions(ctx context.Context) ([]BalanceTxn, bool, error) {
	params := &stripe.BalanceTransactionListParams{}
	params.Context = ctx
	params.Limit = stripe.Int64(100)
	it := balancetransaction.List(params)
	var out []BalanceTxn
	for it.Next() {
		bt := it.BalanceTransaction()
		t := BalanceTxn{
			ID: bt.ID, Type: string(bt.Type), ReportingCategory: string(bt.ReportingCategory),
			Currency: strings.ToLower(string(bt.Currency)), Amount: bt.Amount, Fee: bt.Fee, Net: bt.Net,
			Created: time.Unix(bt.Created, 0).UTC(),
		}
		if bt.Source != nil {
			t.Source = bt.Source.ID
		}
		out = append(out, t)
		if len(out) >= stripeLedgerMaxRows {
			return out, true, nil
		}
	}
	return out, false, it.Err()
}

func fetchCharges(ctx context.Context) ([]ChargeLite, bool, error) {
	params := &stripe.ChargeListParams{}
	params.Context = ctx
	params.Limit = stripe.Int64(100)
	it := charge.List(params)
	var out []ChargeLite
	for it.Next() {
		ch := it.Charge()
		c := ChargeLite{
			ID: ch.ID, Amount: ch.Amount, Currency: strings.ToLower(string(ch.Currency)),
			Paid: ch.Paid, Status: string(ch.Status), Created: time.Unix(ch.Created, 0).UTC(),
		}
		if ch.Customer != nil {
			c.Customer = ch.Customer.ID
		}
		out = append(out, c)
		if len(out) >= stripeLedgerMaxRows {
			return out, true, nil
		}
	}
	return out, false, it.Err()
}

// ── Classification ───────────────────────────────────────────────────────────

// EarningsLine is a count of transactions and their summed net, in the
// currency's minor unit.
type EarningsLine struct {
	Count int   `json:"count"`
	Net   int64 `json:"net"`
}

// LedgerLine is a transaction kind that is reported but not part of net
// earnings: movements of funds, or something unclassified.
type LedgerLine struct {
	Kind   string `json:"kind"`
	Count  int    `json:"count"`
	Amount int64  `json:"amount"`
}

// Earnings is one currency's breakdown over a window.
type Earnings struct {
	Currency        string       `json:"currency"`
	Payments        EarningsLine `json:"payments"`
	Refunds         EarningsLine `json:"refunds"`
	RefundReversals EarningsLine `json:"refund_reversals"`
	Disputes        EarningsLine `json:"disputes"`
	Fees            EarningsLine `json:"fees"`
	// Net is payments + refunds + reversals + disputes + standalone fees, each
	// already net of the per-transaction Stripe fee.
	Net int64 `json:"net"`
	// GrossFees is every fee Stripe took in the window (per-transaction fees
	// plus standalone fee transactions), shown so the owner can reconcile.
	GrossFees    int64        `json:"gross_fees"`
	Movements    []LedgerLine `json:"movements"`
	Unclassified []LedgerLine `json:"unclassified"`
}

// classify names the bucket a transaction belongs in. reporting_category is
// Stripe's own grouping and is preferred; type is the fallback.
func classify(t BalanceTxn) (bucket string) {
	switch t.ReportingCategory {
	case "charge":
		return "payments"
	case "refund":
		return "refunds"
	case "refund_failure":
		return "refund_reversals"
	case "dispute", "dispute_reversal":
		return "disputes"
	case "fee", "tax":
		return "fees"
	case "payout", "payout_reversal", "transfer", "transfer_reversal", "topup", "topup_reversal",
		"connect_reserved_funds", "advance", "advance_funding", "anticipation_repayment",
		"issuing_authorization_hold", "issuing_authorization_release", "issuing_transaction",
		"payment_network_reserve", "reserved_funds":
		return "movements"
	}
	switch t.Type {
	case "charge", "payment":
		return "payments"
	case "refund", "payment_refund", "payment_failure_refund":
		return "refunds"
	case "refund_failure":
		return "refund_reversals"
	case "adjustment":
		return "disputes"
	case "stripe_fee", "stripe_fx_fee", "tax_fee", "application_fee":
		return "fees"
	case "payout", "payout_cancel", "payout_failure", "payout_minimum_balance_hold", "payout_minimum_balance_release",
		"transfer", "transfer_cancel", "transfer_failure", "transfer_refund", "topup", "topup_reversal",
		"reserve_transaction", "reserved_funds", "payment_network_reserve_hold", "payment_network_reserve_release",
		"obligation_outbound", "obligation_reversal_inbound", "advance", "advance_funding", "anticipation_repayment",
		"connect_collection_transfer", "contribution":
		return "movements"
	}
	return "unclassified"
}

// ClassifyTransactions folds the ledger over [start, end) by currency. A
// zero start means all history.
func ClassifyTransactions(txns []BalanceTxn, start, end time.Time) []Earnings {
	byCurrency := map[string]*Earnings{}
	extra := map[string]map[string]*LedgerLine{}
	for _, t := range txns {
		if (!start.IsZero() && t.Created.Before(start)) || !t.Created.Before(end) {
			continue
		}
		e := byCurrency[t.Currency]
		if e == nil {
			e = &Earnings{Currency: t.Currency, Movements: []LedgerLine{}, Unclassified: []LedgerLine{}}
			byCurrency[t.Currency] = e
			extra[t.Currency] = map[string]*LedgerLine{}
		}
		e.GrossFees += t.Fee
		if classify(t) == "fees" {
			// A standalone fee row has no per-transaction fee; the fee IS
			// its (negative) net.
			e.GrossFees -= t.Net
		}
		switch classify(t) {
		case "payments":
			e.Payments.Count++
			e.Payments.Net += t.Net
		case "refunds":
			e.Refunds.Count++
			e.Refunds.Net += t.Net
		case "refund_reversals":
			e.RefundReversals.Count++
			e.RefundReversals.Net += t.Net
		case "disputes":
			e.Disputes.Count++
			e.Disputes.Net += t.Net
		case "fees":
			e.Fees.Count++
			e.Fees.Net += t.Net
		case "movements":
			line := extra[t.Currency]["movements:"+t.Type]
			if line == nil {
				line = &LedgerLine{Kind: t.Type}
				extra[t.Currency]["movements:"+t.Type] = line
			}
			line.Count++
			line.Amount += t.Amount
		default:
			line := extra[t.Currency]["unclassified:"+t.Type]
			if line == nil {
				line = &LedgerLine{Kind: t.Type}
				extra[t.Currency]["unclassified:"+t.Type] = line
			}
			line.Count++
			line.Amount += t.Net
		}
	}
	out := make([]Earnings, 0, len(byCurrency))
	for cur, e := range byCurrency {
		e.Net = e.Payments.Net + e.Refunds.Net + e.RefundReversals.Net + e.Disputes.Net + e.Fees.Net
		for key, line := range extra[cur] {
			if strings.HasPrefix(key, "movements:") {
				e.Movements = append(e.Movements, *line)
			} else {
				e.Unclassified = append(e.Unclassified, *line)
			}
		}
		sort.Slice(e.Movements, func(i, j int) bool { return e.Movements[i].Kind < e.Movements[j].Kind })
		sort.Slice(e.Unclassified, func(i, j int) bool { return e.Unclassified[i].Kind < e.Unclassified[j].Kind })
		out = append(out, *e)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Currency < out[j].Currency })
	return out
}

// NetByBucket sums net earnings per bucket for one currency, only over the
// classified kinds; buckets are aligned to start and clipped to end.
func NetByBucket(txns []BalanceTxn, currency string, buckets []platform.Bucket, start, end time.Time, step time.Duration) {
	for _, t := range txns {
		if t.Currency != currency {
			continue
		}
		switch classify(t) {
		case "payments", "refunds", "refund_reversals", "disputes", "fees":
		default:
			continue
		}
		if i := platform.BucketIndex(t.Created, start, end, step); i >= 0 && i < len(buckets) {
			buckets[i].Value += float64(t.Net)
		}
	}
}

// FirstPayments returns, per Stripe customer, the instant of their first
// successful charge with a positive amount. Renewals, upgrades and repeat
// purchases keep the first date; a trial, a zero-value invoice or a failed
// charge is not a payment.
func FirstPayments(charges []ChargeLite) map[string]time.Time {
	out := map[string]time.Time{}
	for _, c := range charges {
		if c.Customer == "" || !c.Paid || c.Status != "succeeded" || c.Amount <= 0 {
			continue
		}
		if prev, ok := out[c.Customer]; !ok || c.Created.Before(prev) {
			out[c.Customer] = c.Created
		}
	}
	return out
}

// CountFirstPayments counts customers whose first payment falls in the
// window. A zero start means all history.
func CountFirstPayments(first map[string]time.Time, start, end time.Time) int {
	n := 0
	for _, at := range first {
		if (start.IsZero() || !at.Before(start)) && at.Before(end) {
			n++
		}
	}
	return n
}

// EarliestTransaction is where Stripe's retained history begins.
func EarliestTransaction(txns []BalanceTxn) time.Time {
	var earliest time.Time
	for _, t := range txns {
		if earliest.IsZero() || t.Created.Before(earliest) {
			earliest = t.Created
		}
	}
	return earliest
}

// PlanMixRow is one current-plan row of stripe_customers, with the tier and
// the billing interval read out of the plan name.
type PlanMixRow struct {
	Plan     string `json:"plan"`
	Tier     string `json:"tier"`
	Interval string `json:"interval"`
	Status   string `json:"status"`
	Lifetime bool   `json:"lifetime"`
	Paying   bool   `json:"paying"`
	Count    int    `json:"count"`
}

// PayingNow is the current customer snapshot from stripe_customers under
// the shared predicate.
type PayingNow struct {
	// Available is true only after the snapshot was read in full; a failed
	// read must not render as "0 paying".
	Available  bool         `json:"available"`
	Paying     int          `json:"paying"`
	Lifetime   int          `json:"lifetime"`
	Trialing   int          `json:"trialing"`
	PastDue    int          `json:"past_due"`
	Canceling  int          `json:"canceling"`
	Canceled   int          `json:"canceled"`
	Free       int          `json:"free"`
	Rows       []PlanMixRow `json:"rows"`
	Definition string       `json:"definition"`
}

// LoadPayingNow reads the snapshot. deletedPlaceholders (lifetime rows of
// purged accounts, logto_sub 'deleted-…') still count as paying: the money
// was real and the access outlived the account only in the ledger.
func LoadPayingNow(ctx context.Context) (PayingNow, error) {
	out := PayingNow{Rows: []PlanMixRow{},
		Definition: "Paying is current paid access backed by a successful payment: lifetime purchases, or a subscription Stripe reports as active. Trials, overdue and cancelling subscriptions still have access and are shown on their own rows; canceled ones have lost it."}
	rows, err := platform.DBPool.Query(ctx, `
		SELECT s.plan, s.status, s.lifetime, count(*) FROM stripe_customers s GROUP BY 1, 2, 3 ORDER BY 4 DESC, 1, 2`)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var r PlanMixRow
		if err := rows.Scan(&r.Plan, &r.Status, &r.Lifetime, &r.Count); err != nil {
			return out, err
		}
		r.Tier, r.Interval = planTierInterval(r.Plan, r.Lifetime)
		r.Paying = IsPaying(r.Plan, r.Status, r.Lifetime)
		// A canceled row is usually plan 'free' too (subscription.deleted
		// resets the plan), so the status is read before the plan: someone who
		// lost access is not the same fact as someone who never paid.
		switch {
		case r.Paying:
			out.Paying += r.Count
			if r.Lifetime {
				out.Lifetime += r.Count
			}
		case r.Status == "canceled":
			out.Canceled += r.Count
		case r.Plan == "free" || r.Plan == "":
			out.Free += r.Count
		case r.Status == "trialing":
			out.Trialing += r.Count
		case r.Status == "past_due":
			out.PastDue += r.Count
		case r.Status == "canceling":
			out.Canceling += r.Count
		default:
			out.Canceled += r.Count
		}
		out.Rows = append(out.Rows, r)
	}
	if err := rows.Err(); err != nil {
		return out, err
	}
	out.Available = true
	return out, nil
}

func planTierInterval(plan string, lifetime bool) (tier, interval string) {
	if lifetime || plan == "lifetime" {
		return "ultimate", "lifetime"
	}
	switch {
	case isUltimatePlan(plan):
		tier = "ultimate"
	case isProPlan(plan):
		tier = "pro"
	case plan == "monthly" || plan == "annual":
		tier = "uplink"
	case plan == "free" || plan == "":
		return "free", ""
	default:
		tier = "unknown"
	}
	switch {
	case strings.HasSuffix(plan, "monthly"):
		interval = "monthly"
	case strings.HasSuffix(plan, "annual"):
		interval = "annual"
	default:
		interval = "unknown"
	}
	return tier, interval
}

// LogLedgerRead is a small breadcrumb for the ops log, without amounts.
func LogLedgerRead(l Ledger, cached bool) {
	log.Printf("[Billing] ledger read: %d transactions, %d charges, partial=%v cached=%v", len(l.Transactions), len(l.Charges), l.Partial, cached)
}
