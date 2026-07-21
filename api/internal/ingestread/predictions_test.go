package ingestread

// Ported from channels/predictions/api/predictions_test.go when the
// predictions source was folded into core (ADR-0002, REL-15).

import "testing"

func TestExtractFavoritesFromConfig(t *testing.T) {
	tests := []struct {
		name  string
		input []byte
		want  []string
	}{
		{name: "valid favorites", input: []byte(`{"favorites":["KXWTAMATCH-A","KXBTC-B"]}`), want: []string{"KXWTAMATCH-A", "KXBTC-B"}},
		{name: "empty favorites", input: []byte(`{"favorites":[]}`), want: []string{}},
		{name: "no favorites field", input: []byte(`{"categories":["Politics"]}`), want: []string{}},
		{name: "empty strings filtered", input: []byte(`{"favorites":["A","","B"]}`), want: []string{"A", "B"}},
		{name: "invalid JSON", input: []byte(`nope`), want: nil},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := extractFavoritesFromConfig(tc.input)
			if tc.want == nil {
				if got != nil {
					t.Fatalf("want nil, got %v", got)
				}
				return
			}
			if len(got) != len(tc.want) {
				t.Fatalf("extractFavoritesFromConfig = %v, want %v", got, tc.want)
			}
			for i := range got {
				if got[i] != tc.want[i] {
					t.Errorf("[%d] = %q, want %q", i, got[i], tc.want[i])
				}
			}
		})
	}
}

func TestExtractCategoriesFromConfig(t *testing.T) {
	got := extractCategoriesFromConfig([]byte(`{"categories":["Politics","","Crypto"]}`))
	if len(got) != 2 || got[0] != "Politics" || got[1] != "Crypto" {
		t.Fatalf("extractCategoriesFromConfig = %v", got)
	}
	if extractCategoriesFromConfig([]byte(`bad`)) != nil {
		t.Error("invalid JSON should return nil")
	}
}
