package main

import (
	"encoding/json"
	"testing"
)

func TestExtractFavoritesFromConfig(t *testing.T) {
	tests := []struct {
		name  string
		input []byte
		want  []string
	}{
		{
			name:  "valid favorites",
			input: []byte(`{"favorites":["KXPRES","KXBTC","KXNFL"]}`),
			want:  []string{"KXPRES", "KXBTC", "KXNFL"},
		},
		{
			name:  "empty favorites array",
			input: []byte(`{"favorites":[]}`),
			want:  []string{},
		},
		{
			name:  "no favorites field",
			input: []byte(`{"categories":["Politics"]}`),
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
			input: []byte(`{"favorites":["KXPRES","","KXBTC",""]}`),
			want:  []string{"KXPRES", "KXBTC"},
		},
		{
			name:  "nil is treated as empty",
			input: []byte(`{"favorites":null}`),
			want:  []string{},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := extractFavoritesFromConfig(tc.input)
			assertStringSlice(t, "extractFavoritesFromConfig", got, tc.want)
		})
	}
}

func TestExtractCategoriesFromConfig(t *testing.T) {
	tests := []struct {
		name  string
		input []byte
		want  []string
	}{
		{
			name:  "valid categories",
			input: []byte(`{"categories":["Politics","Sports","Crypto"]}`),
			want:  []string{"Politics", "Sports", "Crypto"},
		},
		{
			name:  "empty categories array",
			input: []byte(`{"categories":[]}`),
			want:  []string{},
		},
		{
			name:  "no categories field",
			input: []byte(`{"favorites":["KXPRES"]}`),
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
			input: []byte(`{"categories":["Politics","","Weather",""]}`),
			want:  []string{"Politics", "Weather"},
		},
		{
			name:  "nil is treated as empty",
			input: []byte(`{"categories":null}`),
			want:  []string{},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := extractCategoriesFromConfig(tc.input)
			assertStringSlice(t, "extractCategoriesFromConfig", got, tc.want)
		})
	}
}

func TestExtractFavoritesFromChannelConfig(t *testing.T) {
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
			name:   "valid favorites via map",
			config: map[string]interface{}{"favorites": []interface{}{"KXPRES", "KXBTC"}},
			want:   []string{"KXPRES", "KXBTC"},
		},
		{
			name:   "empty config returns empty slice",
			config: map[string]interface{}{},
			want:   []string{},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := extractFavoritesFromChannelConfig(tc.config)
			if tc.want == nil {
				if got != nil {
					t.Errorf("extractFavoritesFromChannelConfig = %v, want nil", got)
				}
				return
			}
			assertStringSlice(t, "extractFavoritesFromChannelConfig", got, tc.want)
		})
	}
}

func TestExtractConfigRoundTrip(t *testing.T) {
	// Round-trip: full config shape → both parsers.
	original := map[string]interface{}{
		"categories": []interface{}{"Politics", "Sports"},
		"favorites":  []interface{}{"KXPRES", "KXBTC", "KXNFL"},
	}
	jsonBytes, _ := json.Marshal(original)

	favorites := extractFavoritesFromConfig(jsonBytes)
	if len(favorites) != 3 {
		t.Errorf("favorites: got %d, want 3", len(favorites))
	}

	categories := extractCategoriesFromConfig(jsonBytes)
	if len(categories) != 2 {
		t.Errorf("categories: got %d, want 2", len(categories))
	}
}

func assertStringSlice(t *testing.T, name string, got, want []string) {
	t.Helper()
	if len(got) != len(want) {
		t.Errorf("%s = %v, want %v", name, got, want)
		return
	}
	for i := range got {
		if got[i] != want[i] {
			t.Errorf("%s[%d] = %q, want %q", name, i, got[i], want[i])
		}
	}
}
