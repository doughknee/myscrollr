package ingestread

// Ported from channels/rss/api/rss_test.go when the rss source was
// folded into core (ADR-0002, REL-16). Guards the feed-URL extractor the
// rss dashboard, lifecycle sync, and SSE topic subscription rely on.

import (
	"testing"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
)

func TestExtractFeedURLsFromConfig(t *testing.T) {
	tests := []struct {
		name   string
		config map[string]interface{}
		want   []string
	}{
		{name: "nil config", config: nil, want: nil},
		{
			name: "valid feeds",
			config: map[string]interface{}{"feeds": []interface{}{
				map[string]interface{}{"url": "https://a.example/rss", "name": "A"},
				map[string]interface{}{"url": "https://b.example/rss"},
			}},
			want: []string{"https://a.example/rss", "https://b.example/rss"},
		},
		{
			name: "empty urls and non-map entries filtered",
			config: map[string]interface{}{"feeds": []interface{}{
				map[string]interface{}{"url": ""},
				"not-a-map",
				map[string]interface{}{"name": "no url"},
				map[string]interface{}{"url": "https://c.example/rss"},
			}},
			want: []string{"https://c.example/rss"},
		},
		{name: "no feeds field", config: map[string]interface{}{"other": 1}, want: nil},
		{name: "feeds not an array", config: map[string]interface{}{"feeds": "nope"}, want: nil},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := platform.ExtractFeedURLsFromConfig(tc.config)
			if len(got) != len(tc.want) {
				t.Fatalf("extractFeedURLsFromConfig = %v, want %v", got, tc.want)
			}
			for i := range got {
				if got[i] != tc.want[i] {
					t.Errorf("[%d] = %q, want %q", i, got[i], tc.want[i])
				}
			}
		})
	}
}
