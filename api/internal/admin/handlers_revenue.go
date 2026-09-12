package admin

import (
	"context"
	"log"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/billing"
	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/gofiber/fiber/v2"
)

// Revenue for the Overview and Analytics › Revenue (SCROLLR-210).
//
// The current customer snapshot comes from stripe_customers under the one
// shared predicate. Everything with a currency sign comes from Stripe's own
// ledger. The two never blank each other: Stripe down leaves the snapshot
// standing with the earnings block saying it is unavailable.

var revenueNow = time.Now

type EarningsReport struct {
	Available bool   `json:"available"`
	Note      string `json:"note,omitempty"`
	// Currencies holds one breakdown per currency seen in the window; the
	// page never adds two currencies together.
	Currencies []billing.Earnings `json:"currencies"`
	// Net is the primary currency's net over the window, with comparison.
	PrimaryCurrency string             `json:"primary_currency"`
	Net             Metric             `json:"net"`
	Lifetime        []billing.Earnings `json:"lifetime"`
	Curve           []Bucket           `json:"curve"`
	CurveStep       string             `json:"curve_step"`
	Coverage        Coverage           `json:"coverage"`
	Partial         bool               `json:"partial"`
	Cached          bool               `json:"cached"`
	FetchedAt       string             `json:"fetched_at,omitempty"`
	Definition      string             `json:"definition"`
}

type NewPayingReport struct {
	Available  bool   `json:"available"`
	Note       string `json:"note,omitempty"`
	InPeriod   Metric `json:"in_period"`
	Lifetime   int    `json:"lifetime"`
	Definition string `json:"definition"`
}

type RevenueResponse struct {
	GeneratedAt string  `json:"generated_at"`
	Period      Window  `json:"period"`
	Previous    *Window `json:"previous"`

	PayingNow     billing.PayingNow `json:"paying_now"`
	PayingNowNote string            `json:"paying_now_note,omitempty"`
	NewPaying     NewPayingReport   `json:"new_paying"`
	Earnings      EarningsReport    `json:"earnings"`
	AccountNote   string            `json:"account_note"`
}

const earningsDefinition = "Customer payments minus refunds minus Stripe fees, by transaction time, from Stripe balance transactions. Each transaction is counted once at its net (amount minus fee). Refund reversals and dispute adjustments are classified on their own rows and included; payouts and other movements of funds are listed and excluded; anything Stripe reports under a type this dashboard does not recognise is listed as unclassified and excluded."

// HandleGetRevenue - GET /admin/revenue?period=
func HandleGetRevenue(c *fiber.Ctx) error {
	now := revenueNow().UTC()
	period, err := ParsePeriod(c.Query("period"), now)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(platform.ErrorResponse{Status: "error", Error: err.Error()})
	}
	ctx, cancel := context.WithTimeout(context.Background(), 40*time.Second)
	defer cancel()
	return c.JSON(loadRevenue(ctx, period, now))
}

func loadRevenue(ctx context.Context, period Period, now time.Time) RevenueResponse {
	out := RevenueResponse{
		GeneratedAt: now.Format(time.RFC3339), Period: period.Window(),
		AccountNote: "Figures cover every transaction on the connected Stripe account. If that account ever serves anything besides Scrollr, those transactions are included too.",
		NewPaying:   NewPayingReport{Definition: "Accounts whose first successful, positive Stripe charge falls in the window. Renewals, upgrades and repeat purchases never count again; a trial or a zero-value invoice is not a payment."},
		Earnings:    EarningsReport{Definition: earningsDefinition, Currencies: []billing.Earnings{}, Lifetime: []billing.Earnings{}, Curve: []Bucket{}},
	}
	if prev, ok := period.Previous(); ok {
		w := prev.Window()
		out.Previous = &w
	}

	if platform.DBPool != nil {
		paying, err := billing.LoadPayingNow(ctx)
		if err != nil {
			log.Printf("[Admin] paying now: %v", err)
			out.PayingNowNote = "The customer snapshot could not be read."
		}
		out.PayingNow = paying
	}

	ledger, cached, err := billing.LoadLedger(ctx)
	if err != nil {
		log.Printf("[Admin] stripe ledger: %v", err)
		note := "Stripe could not be read: " + err.Error()
		out.Earnings.Note, out.NewPaying.Note = note, note
		out.Earnings.Net = Metric{Note: note}
		out.NewPaying.InPeriod = Metric{Note: note}
		return out
	}
	billing.LogLedgerRead(ledger, cached)
	from := billing.EarliestTransaction(ledger.Transactions)
	out.Earnings.Available, out.Earnings.Cached, out.Earnings.Partial = true, cached, ledger.PartialTransactions
	out.Earnings.FetchedAt = ledger.FetchedAt.Format(time.RFC3339)
	out.Earnings.Coverage = CoverageFor(period, from, "Stripe's ledger is complete from the account's first transaction.")
	if ledger.PartialTransactions {
		out.Earnings.Coverage.Partial = true
		out.Earnings.Coverage.Note = "The ledger walk stopped at 10,000 rows, so lifetime figures are incomplete."
	}

	start := EffectiveStart(period, from)
	end := period.End
	out.Earnings.Currencies = billing.ClassifyTransactions(ledger.Transactions, start, end)
	out.Earnings.Lifetime = billing.ClassifyTransactions(ledger.Transactions, time.Time{}, end)
	primary := "usd"
	if len(out.Earnings.Lifetime) > 0 {
		// The currency with the most lifetime payments is primary.
		best := -1
		for _, e := range out.Earnings.Lifetime {
			if e.Payments.Count > best {
				best, primary = e.Payments.Count, e.Currency
			}
		}
	}
	out.Earnings.PrimaryCurrency = primary
	netFor := func(list []billing.Earnings) float64 {
		for _, e := range list {
			if e.Currency == primary {
				return float64(e.Net)
			}
		}
		return 0
	}
	netNow := netFor(out.Earnings.Currencies)
	var netPrev float64
	if prev, ok := period.Previous(); ok {
		netPrev = netFor(billing.ClassifyTransactions(ledger.Transactions, prev.Start, prev.End))
	}
	out.Earnings.Net = Metric{Value: netNow, Available: true, Comparison: Compare(netNow, netPrev, period, from),
		Note: "Minor units of " + primary + " (cents for usd)."}
	if !start.IsZero() && !from.IsZero() {
		step := BucketStep(period, from)
		out.Earnings.CurveStep = step.String()
		out.Earnings.Curve = Buckets(start, end, step)
		billing.NetByBucket(ledger.Transactions, primary, out.Earnings.Curve, start, end, step)
	}

	if ledger.PartialCharges {
		// Stripe lists newest first, so a capped walk is missing the OLDEST
		// charges: a long-time subscriber's renewal would look like a first
		// payment. That is a wrong number, not a partial one.
		note := "The charge walk stopped at 10,000 rows, so first-payment dates before that point are unknown and new paying customers cannot be counted."
		out.NewPaying.Note = note
		out.NewPaying.InPeriod = Metric{Note: note}
		return out
	}
	first := billing.FirstPayments(ledger.Charges)
	out.NewPaying.Available = true
	nowCount := float64(billing.CountFirstPayments(first, start, end))
	var prevCount float64
	if prev, ok := period.Previous(); ok {
		prevCount = float64(billing.CountFirstPayments(first, prev.Start, prev.End))
	}
	out.NewPaying.InPeriod = Metric{Value: nowCount, Available: true, Comparison: Compare(nowCount, prevCount, period, from)}
	out.NewPaying.Lifetime = billing.CountFirstPayments(first, time.Time{}, end)
	return out
}
