package core

import (
	"encoding/json"
	"io"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/brandon-relentnet/myscrollr/api/internal/ingestread"
	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/brandon-relentnet/myscrollr/api/internal/testsupport"
	"github.com/brandon-relentnet/myscrollr/api/internal/widgets"
	"github.com/gofiber/fiber/v2"
)

func TestElectionDashboardAcrossOldAndPreviewClients(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	t.Setenv("ELECTIONS_BETA_ENABLED", "true")
	const user = "test-election-dashboard"
	app := fiber.New()
	app.Use(func(c *fiber.Ctx) error { c.Locals("user_id", user); return c.Next() })
	app.Get("/dashboard", (&Server{}).getDashboard)
	app.Get("/users/me/widgets", widgets.GetWidgets)
	app.Post("/users/me/widgets", widgets.CreateWidget)
	app.Put("/users/me/widgets/:type", widgets.UpdateWidget)
	app.Delete("/users/me/widgets/:type", widgets.DeleteWidget)
	request := func(method, path, body string, status int) ([]byte, string) {
		t.Helper()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		resp, err := app.Test(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		data, err := io.ReadAll(resp.Body)
		if err != nil || resp.StatusCode != status {
			t.Fatalf("%s %s: status=%d err=%v body=%s", method, path, resp.StatusCode, err, data)
		}
		return data, resp.Header.Get("X-Cache")
	}
	dashboard := func(path, cache string) (int, []ingestread.ElectionResult) {
		t.Helper()
		b, hit := request("GET", path, "", 200)
		var response struct {
			Widgets []platform.Widget `json:"widgets"`
			Data    struct {
				Elections []ingestread.ElectionResult `json:"elections"`
			} `json:"data"`
		}
		if err := json.Unmarshal(b, &response); err != nil || hit != cache {
			t.Fatalf("dashboard cache=%q want=%q err=%v", hit, cache, err)
		}
		return len(response.Widgets), response.Data.Elections
	}
	request("POST", "/users/me/widgets?preview=elections", `{"widget_type":"elections","config":{"race_ids":[87476]}}`, 201)

	stable, _ := request("GET", "/users/me/widgets", "", 200)
	beta, _ := request("GET", "/users/me/widgets?preview=elections", "", 200)
	if strings.Contains(string(stable), "elections") || !strings.Contains(string(beta), "elections") {
		t.Fatalf("widget capability filter failed: stable=%s beta=%s", stable, beta)
	}
	if n, r := dashboard("/dashboard", "MISS"); n != 0 || r != nil {
		t.Fatalf("stable leaked races: %d %+v", n, r)
	}
	const preview = "/dashboard?preview=elections"
	if n, r := dashboard(preview, "HIT"); n != 1 || len(r) != 1 || r[0].SourceUpdatedAt != nil {
		t.Fatalf("missing waiting race: %d %+v", n, r)
	}
	// Commit a new snapshot while Redis still holds the same base dashboard.
	// Deliberately skip PubSub so this exercises lost-message recovery.
	testsupport.MustExec(t, `INSERT INTO election_results (race_id,snapshot,source_updated_at,next_poll_at,verified_until)
      VALUES (87476,'{"id":87476,"name":"Tennessee Governor","source_updated_at":"2026-11-04T02:00:00Z","candidates":[{"id":1,"name":"A","votes":10}]}',now(),now(),now()+interval '1 hour')`)
	if _, r := dashboard(preview, "HIT"); len(r) != 1 || len(r[0].Candidates) != 1 || r[0].Candidates[0].Votes != 10 {
		t.Fatalf("warm cache hid committed tally: %+v", r)
	}
	if n, r := dashboard("/dashboard", "HIT"); n != 0 || r != nil {
		t.Fatalf("stable read after preview leaked races: %d %+v", n, r)
	}
	request("PUT", "/users/me/widgets/elections?preview=elections", `{"config":{"race_ids":[]}}`, 200)
	if n, r := dashboard(preview, "MISS"); n != 1 || r == nil || len(r) != 0 {
		t.Fatalf("unfollow still returned race data: %d %+v", n, r)
	}
	request("PUT", "/users/me/widgets/elections?preview=elections", `{"enabled":false}`, 200)
	if n, r := dashboard(preview, "MISS"); n != 1 || r != nil {
		t.Fatalf("disabled widget returned data: %d %+v", n, r)
	}
	request("DELETE", "/users/me/widgets/elections?preview=elections", "", 200)
	if n, r := dashboard(preview, "MISS"); n != 0 || r != nil {
		t.Fatalf("deleted widget remains: %d %+v", n, r)
	}
}
