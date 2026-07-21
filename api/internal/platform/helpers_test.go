package platform

import (
	"testing"
)

func TestValidateURL(t *testing.T) {
	tests := []struct {
		name     string
		url      string
		fallback string
		want     string
	}{
		{"empty uses fallback", "", "https://default.com", "https://default.com"},
		{"http preserved", "http://example.com", "https://fallback.com", "http://example.com"},
		{"https preserved", "https://example.com", "https://fallback.com", "https://example.com"},
		{"no scheme gets https prefix", "example.com", "https://fallback.com", "https://example.com"},
		{"trailing slash stripped", "https://example.com/", "https://fallback.com", "https://example.com"},
		{"whitespace trimmed", "  https://example.com  ", "https://fallback.com", "https://example.com"},
		{"empty fallback preserved", "", "", ""},
		{"no scheme no trailing slash", "example.com", "fallback.com", "https://example.com"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := ValidateURL(tc.url, tc.fallback)
			if got != tc.want {
				t.Errorf("ValidateURL(%q, %q) = %q, want %q", tc.url, tc.fallback, got, tc.want)
			}
		})
	}
}
