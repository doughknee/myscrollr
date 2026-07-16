package core

import (
	"testing"
)

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
