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
		{"tauri scheme preserved", "tauri://localhost", "https://fallback.com", "tauri://localhost"},
		{"custom scheme preserved", "myscrollr://auth", "https://fallback.com", "myscrollr://auth"},
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

// The catalog's DefaultConfig is Go-typed; DefaultConfigFor must hand back the
// JSON-decoded shape ExtractFeedURLsFromConfig can read (SCROLLR-252).
func TestDefaultConfigForIsExtractable(t *testing.T) {
	got := ExtractFeedURLsFromConfig(DefaultConfigFor("news_npr"))
	if len(got) != 1 || got[0] != "https://feeds.npr.org/1001/rss.xml" {
		t.Fatalf("news_npr default feeds = %v", got)
	}
	// The typed literal itself does not match the extractor's assertions.
	def, _ := WidgetByID("news_npr")
	if raw := ExtractFeedURLsFromConfig(def.DefaultConfig); len(raw) != 0 {
		t.Fatalf("typed DefaultConfig unexpectedly extractable: %v", raw)
	}
	if DefaultConfigFor("no_such_widget") != nil {
		t.Error("unknown widget type should have no default config")
	}
}
