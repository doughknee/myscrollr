package ingestread

// Ported from channels/finance/api/finance_test.go when the finance
// source was folded into core (ADR-0002, REL-14). Guards the config
// symbol extractor the finance dashboard and SSE topic subscription both
// rely on.

import (
	"testing"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
)

func TestExtractStringArraySymbols(t *testing.T) {
	tests := []struct {
		name   string
		config map[string]interface{}
		want   []string
	}{
		{
			name:   "nil config returns nil",
			config: nil,
			want:   nil,
		},
		{
			name:   "valid symbols",
			config: map[string]interface{}{"symbols": []interface{}{"AAPL", "GOOGL", "MSFT"}},
			want:   []string{"AAPL", "GOOGL", "MSFT"},
		},
		{
			name:   "empty symbols array",
			config: map[string]interface{}{"symbols": []interface{}{}},
			want:   []string{},
		},
		{
			name:   "no symbols field",
			config: map[string]interface{}{"other": "data"},
			want:   nil,
		},
		{
			name:   "empty strings filtered",
			config: map[string]interface{}{"symbols": []interface{}{"AAPL", "", "MSFT", ""}},
			want:   []string{"AAPL", "MSFT"},
		},
		{
			name:   "non-string entries filtered",
			config: map[string]interface{}{"symbols": []interface{}{"AAPL", 42, "MSFT"}},
			want:   []string{"AAPL", "MSFT"},
		},
		{
			name:   "symbols not an array",
			config: map[string]interface{}{"symbols": "AAPL"},
			want:   nil,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := platform.ExtractStringArray(tc.config, "symbols")
			if len(got) != len(tc.want) {
				t.Fatalf("extractStringArray = %v, want %v", got, tc.want)
			}
			for i := range got {
				if got[i] != tc.want[i] {
					t.Errorf("extractStringArray[%d] = %q, want %q", i, got[i], tc.want[i])
				}
			}
		})
	}
}
