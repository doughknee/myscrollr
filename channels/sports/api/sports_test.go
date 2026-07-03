package main

import (
	"encoding/json"
	"testing"
)

func TestFairShareSideSplit(t *testing.T) {
	tests := []struct {
		perLeague, wantUp, wantDown int
	}{
		{60, 30, 30}, // single-league widget at the dashboard limit
		{10, 5, 5},   // six leagues at limit 60
		{5, 3, 2},    // odd share — the extra slot goes to upcoming
		{3, 2, 1},
		{2, 1, 1}, // MinPerLeagueShare floor — both sides stay visible
		{1, 1, 0}, // degenerate: upcoming wins the only slot
	}
	for _, tt := range tests {
		up, down := fairShareSideSplit(tt.perLeague)
		if up != tt.wantUp || down != tt.wantDown {
			t.Errorf("fairShareSideSplit(%d) = (%d, %d), want (%d, %d)",
				tt.perLeague, up, down, tt.wantUp, tt.wantDown)
		}
		if up+down != tt.perLeague {
			t.Errorf("fairShareSideSplit(%d): sides sum to %d, must equal the share",
				tt.perLeague, up+down)
		}
	}
}

func TestExtractLeaguesFromConfig(t *testing.T) {
	tests := []struct {
		name  string
		input []byte
		want  []string
	}{
		{
			name:  "valid leagues",
			input: []byte(`{"leagues":["NFL","NBA","MLB"]}`),
			want:  []string{"NFL", "NBA", "MLB"},
		},
		{
			name:  "single league",
			input: []byte(`{"leagues":["NHL"]}`),
			want:  []string{"NHL"},
		},
		{
			name:  "empty leagues array",
			input: []byte(`{"leagues":[]}`),
			want:  []string{},
		},
		{
			name:  "no leagues field",
			input: []byte(`{"other":"data"}`),
			want:  []string{},
		},
		{
			name:  "empty JSON",
			input: []byte(`{}`),
			want:  []string{},
		},
		{
			name:  "invalid JSON",
			input: []byte(`not json`),
			want:  nil,
		},
		{
			name:  "empty strings filtered",
			input: []byte(`{"leagues":["NFL","","NBA",""]}`),
			want:  []string{"NFL", "NBA"},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := extractLeaguesFromConfig(tc.input)
			if tc.want == nil {
				if got != nil {
					t.Errorf("extractLeaguesFromConfig = %v, want nil", got)
				}
				return
			}
			if len(got) != len(tc.want) {
				t.Errorf("extractLeaguesFromConfig = %v, want %v", got, tc.want)
				return
			}
			for i := range got {
				if got[i] != tc.want[i] {
					t.Errorf("extractLeaguesFromConfig[%d] = %q, want %q", i, got[i], tc.want[i])
				}
			}
		})
	}
}

func TestExtractLeaguesFromChannelConfig(t *testing.T) {
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
			name:   "valid leagues via map",
			config: map[string]interface{}{"leagues": []interface{}{"NFL", "NBA"}},
			want:   []string{"NFL", "NBA"},
		},
		{
			name:   "empty config returns empty slice",
			config: map[string]interface{}{},
			want:   []string{},
		},
		{
			name:   "non-array leagues type",
			config: map[string]interface{}{"leagues": "NFL"},
			want:   nil,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := extractLeaguesFromChannelConfig(tc.config)
			if tc.want == nil {
				if got != nil {
					t.Errorf("extractLeaguesFromChannelConfig = %v, want nil", got)
				}
				return
			}
			if len(got) != len(tc.want) {
				t.Errorf("extractLeaguesFromChannelConfig = %v, want %v", got, tc.want)
				return
			}
			for i := range got {
				if got[i] != tc.want[i] {
					t.Errorf("extractLeaguesFromChannelConfig[%d] = %q, want %q", i, got[i], tc.want[i])
				}
			}
		})
	}
}

func TestExtractLeaguesRoundTrip(t *testing.T) {
	original := []string{"NFL", "NBA", "MLB", "NHL"}
	config := map[string]interface{}{"leagues": interfaceStrSlice(original)}
	got := extractLeaguesFromChannelConfig(config)
	if len(got) != len(original) {
		t.Fatalf("got %d, want %d", len(got), len(original))
	}
	for i := range got {
		if got[i] != original[i] {
			t.Errorf("got[%d]=%q, want %q", i, got[i], original[i])
		}
	}
}

func interfaceStrSlice(strs []string) []interface{} {
	result := make([]interface{}, len(strs))
	for i, s := range strs {
		result[i] = s
	}
	return result
}

func TestExtractLeaguesFromConfigJSON(t *testing.T) {
	original := map[string]interface{}{
		"leagues": []interface{}{"Premier League", "La Liga"},
	}
	jsonBytes, _ := json.Marshal(original)
	got := extractLeaguesFromConfig(jsonBytes)
	if len(got) != 2 {
		t.Errorf("got %d, want 2", len(got))
	}
}
