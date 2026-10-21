package billing

import (
	"encoding/json"
	"github.com/stripe/stripe-go/v82"
	"testing"
)

func TestLedgerPopulationIncludesLinkedRefundsAndDoesNotMutateCache(t *testing.T) {
	l := Ledger{
		Charges: []ChargeLite{{ID: "ch_win", Customer: "win"}, {ID: "ch_mac", Customer: "mac"}},
		Transactions: []BalanceTxn{
			{ID: "payment", Source: "ch_win", Type: "charge", Net: 970},
			{ID: "refund", SourceCharge: "ch_win", Type: "refund", Net: -500},
			{ID: "dispute", Customer: "win", Type: "adjustment", Net: -100},
			{ID: "other", Source: "ch_mac", Type: "charge", Net: 2000},
			{ID: "fee", Type: "stripe_fee", Net: -50},
			{ID: "payout", Type: "payout", Net: -5000},
		},
	}
	filtered, excluded := FilterLedger(l, map[string]bool{"win": true})
	if len(filtered.Transactions) != 3 || len(filtered.Charges) != 1 || excluded != 1 {
		t.Fatalf("filtered=%+v excluded=%d", filtered, excluded)
	}
	if len(l.Transactions) != 6 || len(l.Charges) != 2 {
		t.Fatal("shared ledger mutated")
	}
	for _, raw := range []string{
		`{"id":"ch_a","object":"charge","customer":"cus_a"}`,
		`{"id":"ch_a","object":"charge","customer":{"id":"cus_a"}}`,
	} {
		var source stripe.BalanceTransactionSource
		if err := json.Unmarshal([]byte(raw), &source); err != nil {
			t.Fatal(err)
		}
		customer, charge := transactionAccount(&source)
		if customer != "cus_a" || charge != "ch_a" {
			t.Fatalf("attribution %s: %s/%s", raw, customer, charge)
		}
	}
	for _, kind := range []string{"refund", "dispute"} {
		var source stripe.BalanceTransactionSource
		if err := json.Unmarshal([]byte(`{"id":"source_a","object":"`+kind+`","charge":"ch_a"}`), &source); err != nil {
			t.Fatal(err)
		}
		_, charge := transactionAccount(&source)
		if charge != "ch_a" {
			t.Fatalf("%s charge=%s", kind, charge)
		}
	}
}
