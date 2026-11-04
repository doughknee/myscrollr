package widgets

import (
	"encoding/json"
	"testing"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
)

func TestElectionSettingsValidateBeforeWriting(t *testing.T) {
	t.Setenv("ELECTIONS_BETA_ENABLED", "true")
	app := logApp()
	for _, cfg := range []string{
		`{"race_ids":["87476"]}`, `{"race_ids":[87476,87476]}`,
		`{"race_ids":[1.5]}`, `{"race_ids":[0]}`, `{"race_ids":[2147483648]}`,
		`{"race_ids":[5]}`, `{"race_ids":null}`, `{"url":"https://example.invalid/"}`,
		`{"race_ids":[87476],"provider":"other"}`,
	} {
		body := `{"widget_type":"elections","config":` + cfg + `}`
		if status := doRequest(t, app, "POST", "/users/me/widgets?preview=elections", "test", body); status != 400 {
			t.Errorf("create %s: got %d", cfg, status)
		}
		if status := doRequest(t, app, "PUT", "/users/me/widgets/elections?preview=elections", "test", body); status != 400 {
			t.Errorf("update %s: got %d", cfg, status)
		}
	}
	for _, cfg := range []string{`{"race_ids":[]}`, `{"race_ids":[87476]}`} {
		var v map[string]any
		if err := json.Unmarshal([]byte(cfg), &v); err != nil {
			t.Fatal(err)
		}
		if err := validateElectionConfig(v); err != nil {
			t.Errorf("valid config %s: %v", cfg, err)
		}
	}
	if err := validateElectionConfig(configOrDefault("elections", nil)); err != nil {
		t.Fatalf("invalid default: %v", err)
	}
	for _, tc := range []struct{ method, path string }{
		{"POST", "/users/me/widgets"},
		{"PUT", "/users/me/widgets/elections"},
		{"DELETE", "/users/me/widgets/elections"},
	} {
		if status := doRequest(t, app, tc.method, tc.path, "test", `{"widget_type":"elections","config":{"race_ids":[]}}`); status != 400 {
			t.Errorf("stable client %s: got %d", tc.method, status)
		}
	}
	t.Setenv("ELECTIONS_BETA_ENABLED", "")
	if platform.IsKnownWidgetType("elections") {
		t.Fatal("disabled beta counts against the slot cap")
	}
	if status := doRequest(t, app, "POST", "/users/me/widgets?preview=elections", "test", `{"widget_type":"elections"}`); status != 400 {
		t.Errorf("disabled server accepted election create: %d", status)
	}
}
