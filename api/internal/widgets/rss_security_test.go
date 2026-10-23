package widgets

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/brandon-relentnet/myscrollr/api/internal/testsupport"
)

func TestRSSWriteBudgetPreservesWidgetAndAllowsToggles(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	mr, cleanup := testsupport.MiniRedis(t)
	defer cleanup()
	ctx := context.Background()
	user := fmt.Sprintf("rss-http-%d", time.Now().UnixNano())
	url := "https://example.com/" + user
	t.Cleanup(func() {
		_, _ = platform.DBPool.Exec(ctx, `DELETE FROM user_widgets WHERE logto_sub=$1`, user)
		_, _ = platform.DBPool.Exec(ctx, `DELETE FROM user_custom_feeds WHERE logto_sub=$1`, user)
		_, _ = platform.DBPool.Exec(ctx, `DELETE FROM tracked_feeds WHERE added_by=$1 AND is_default=false`, user)
	})
	app := logApp()
	body := `{"widget_type":"rss_custom","config":{"feeds":[{"url":"` + url + `","name":"Original"}]}}`
	if got := doRequest(t, app, "POST", "/users/me/widgets", user, body); got != 201 {
		t.Fatalf("normal create: %d", got)
	}
	var count int
	if err := platform.DBPool.QueryRow(ctx, `SELECT count(*) FROM user_custom_feeds WHERE logto_sub=$1`, user).Scan(&count); err != nil || count != 1 {
		t.Fatalf("feed not immediately saved: %d %v", count, err)
	}
	key := "rss:writes:{" + user + "}"
	mr.Set(key, "60")
	mr.SetTTL(key, time.Minute)
	edit := `{"config":{"feeds":[{"url":"` + url + `/blocked","name":"Blocked"}]}}`
	req := httptest.NewRequest("PUT", "/users/me/widgets/rss_custom", strings.NewReader(edit))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Test-User", user)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 429 || resp.Header.Get("Retry-After") == "" {
		t.Fatalf("limited response: %d", resp.StatusCode)
	}
	var saved string
	if err := platform.DBPool.QueryRow(ctx, `SELECT config->'feeds'->0->>'url' FROM user_widgets WHERE logto_sub=$1`, user).Scan(&saved); err != nil || saved != url {
		t.Fatalf("rejected edit changed config: %v", err)
	}
	if err := platform.DBPool.QueryRow(ctx, `SELECT count(*) FROM tracked_feeds WHERE url=$1`, url+"/blocked").Scan(&count); err != nil || count != 0 {
		t.Fatalf("rejected edit queued target: %d %v", count, err)
	}
	if got := doRequest(t, app, "PUT", "/users/me/widgets/rss_custom", user, `{"ticker_enabled":false}`); got != 200 {
		t.Fatalf("toggle blocked: %d", got)
	}
	if got := doRequest(t, app, "POST", "/users/me/widgets", user, `{"widget_type":"news_npr"}`); got != 201 {
		t.Fatalf("curated feed blocked: %d", got)
	}
	mr.FastForward(time.Minute)
	if got := doRequest(t, app, "PUT", "/users/me/widgets/rss_custom", user, edit); got != 200 {
		t.Fatalf("normal edit after cooldown: %d", got)
	}
}

func TestRSSWritesRejectPrivateFeedsBeforeDatabaseAccess(t *testing.T) {
	for _, widget := range []string{"rss_custom", "news_npr"} {
		create := `{"widget_type":"` + widget + `","config":{"feeds":[{"url":"http://169.254.169.254/metadata/v1/"}]}}`
		if status := doRequest(t, logApp(), http.MethodPost, "/users/me/widgets", "rss-security-test", create); status != http.StatusBadRequest {
			t.Fatalf("create %s returned %d", widget, status)
		}
		update := `{"config":{"feeds":[{"url":"http://127.0.0.1:8080/health"}]}}`
		if status := doRequest(t, logApp(), http.MethodPut, "/users/me/widgets/"+widget, "rss-security-test", update); status != http.StatusBadRequest {
			t.Fatalf("update %s returned %d", widget, status)
		}
	}
}
