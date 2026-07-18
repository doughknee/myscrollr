package core

import (
	"net/http/httptest"
	"testing"

	"github.com/gofiber/fiber/v2"
)

// TestWidgetRouteAliases confirms the REL-40 /users/me/widgets aliases are
// registered alongside the legacy /users/me/channels wire routes with the
// same LogtoAuth gate: every verb on both paths must 401 (registered and
// auth-gated), never 404 or fall through to /users/:username.
func TestWidgetRouteAliases(t *testing.T) {
	s := NewServer()
	s.setupRoutes()

	for _, tc := range []struct{ method, path string }{
		{"GET", "/users/me/channels"},
		{"POST", "/users/me/channels"},
		{"PUT", "/users/me/channels/finance"},
		{"DELETE", "/users/me/channels/finance"},
		{"GET", "/users/me/widgets"},
		{"POST", "/users/me/widgets"},
		{"PUT", "/users/me/widgets/finance"},
		{"DELETE", "/users/me/widgets/finance"},
	} {
		resp, err := s.App.Test(httptest.NewRequest(tc.method, tc.path, nil))
		if err != nil {
			t.Fatalf("%s %s: %v", tc.method, tc.path, err)
		}
		if resp.StatusCode != fiber.StatusUnauthorized {
			t.Errorf("%s %s: got %d, want 401", tc.method, tc.path, resp.StatusCode)
		}
	}
}

func TestExtractStringArrayLeagues(t *testing.T) {
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
			name:   "empty config returns nil",
			config: map[string]interface{}{},
			want:   nil,
		},
		{
			name:   "no leagues key returns nil",
			config: map[string]interface{}{"symbols": []interface{}{"AAPL"}},
			want:   nil,
		},
		{
			name: "single league",
			config: map[string]interface{}{
				"leagues": []interface{}{"NFL"},
			},
			want: []string{"NFL"},
		},
		{
			name: "multiple leagues",
			config: map[string]interface{}{
				"leagues": []interface{}{"NFL", "NBA", "MLB"},
			},
			want: []string{"NFL", "NBA", "MLB"},
		},
		{
			name: "mixed valid and empty strings",
			config: map[string]interface{}{
				"leagues": []interface{}{"NFL", "", "NBA", "", "MLB"},
			},
			want: []string{"NFL", "NBA", "MLB"},
		},
		{
			name: "empty leagues array",
			config: map[string]interface{}{
				"leagues": []interface{}{},
			},
			want: []string{},
		},
		{
			name: "leagues is not an array type",
			config: map[string]interface{}{
				"leagues": "NFL", // should be []interface{} but is string
			},
			want: nil,
		},
		{
			name: "all empty strings",
			config: map[string]interface{}{
				"leagues": []interface{}{"", "", ""},
			},
			want: []string{},
		},
		{
			name: "additional config fields ignored",
			config: map[string]interface{}{
				"leagues":     []interface{}{"NFL", "NBA"},
				"other_field": "ignored",
				"count":       42,
			},
			want: []string{"NFL", "NBA"},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := extractStringArray(tc.config, "leagues")
			if tc.want == nil {
				if got != nil {
					t.Errorf("extractStringArray = %v, want nil", got)
				}
				return
			}
			if len(got) != len(tc.want) {
				t.Errorf("extractStringArray = %v, want %v", got, tc.want)
				return
			}
			for i := range got {
				if got[i] != tc.want[i] {
					t.Errorf("extractStringArray[%d] = %q, want %q", i, got[i], tc.want[i])
				}
			}
		})
	}
}
