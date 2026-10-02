package ingestread

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/brandon-relentnet/myscrollr/api/internal/testsupport"
	"github.com/gofiber/fiber/v2"
)

// TestPublicFeedSharesLeaguesAndCarriesRSS pins SCROLLR-313: the public
// feed gives every enabled league its own share instead of one global
// LIMIT a busy league can fill, and carries the curated news feeds, capped
// per feed so a busy feed cannot crowd a slow one out.
func TestPublicFeedSharesLeaguesAndCarriesRSS(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	ctx := context.Background()
	const busy, quiet = "TestPublicBusy", "TestPublicQuiet"
	npr := widgetFeedURLs("news_npr", nil)[0]
	bbc := widgetFeedURLs("news_bbc", nil)[0]

	cleanup := func() {
		_, _ = platform.DBPool.Exec(ctx, `DELETE FROM games WHERE league = ANY($1)`, []string{busy, quiet})
		_, _ = platform.DBPool.Exec(ctx, `DELETE FROM tracked_leagues WHERE name = ANY($1)`, []string{busy, quiet})
		_, _ = platform.DBPool.Exec(ctx, `DELETE FROM rss_items WHERE guid LIKE 'scrollr-313-%'`)
		_ = platform.Rdb.Del(ctx, PublicFeedCacheKey, CacheKeySports).Err()
	}
	cleanup()
	defer cleanup()

	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := platform.DBPool.Exec(ctx, q, args...); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
	}
	exec(`INSERT INTO tracked_leagues (name, is_enabled) VALUES ($1, true), ($2, true)`, busy, quiet)
	now := time.Now()
	// busy: a college-football Saturday's worth of fixtures, plus finals.
	for i := 0; i < 60; i++ {
		exec(`INSERT INTO games (league, external_game_id, home_team_name, away_team_name, start_time, state)
			VALUES ($1, $2, 'H', 'A', $3, 'pre')`, busy, fmt.Sprintf("pre-%02d", i), now.Add(time.Duration(i+1)*time.Hour))
	}
	for i := 0; i < 30; i++ {
		exec(`INSERT INTO games (league, external_game_id, home_team_name, away_team_name, start_time, state)
			VALUES ($1, $2, 'H', 'A', $3, 'post')`, busy, fmt.Sprintf("post-%02d", i), now.Add(-time.Duration(i+3)*time.Hour))
	}
	for i := 0; i < 3; i++ {
		exec(`INSERT INTO games (league, external_game_id, home_team_name, away_team_name, start_time, state)
			VALUES ($1, $2, 'H', 'A', $3, 'pre')`, quiet, fmt.Sprintf("pre-%d", i), now.Add(time.Duration(i+100)*time.Hour))
	}

	for _, u := range []string{npr, bbc} {
		exec(`INSERT INTO tracked_feeds (url, name, is_default) VALUES ($1, $1, true) ON CONFLICT (url) DO NOTHING`, u)
	}
	for i := 0; i < 25; i++ {
		exec(`INSERT INTO rss_items (feed_url, guid, title, published_at) VALUES ($1, $2, 'npr', $3)`,
			npr, fmt.Sprintf("scrollr-313-npr-%02d", i), now.Add(-time.Duration(i)*time.Minute))
	}
	for i := 0; i < 2; i++ {
		exec(`INSERT INTO rss_items (feed_url, guid, title, published_at) VALUES ($1, $2, 'bbc', $3)`,
			bbc, fmt.Sprintf("scrollr-313-bbc-%d", i), now.Add(-48*time.Hour))
	}

	app := fiber.New()
	app.Get("/public/feed", HandlePublicFeed)
	res, err := app.Test(httptest.NewRequest("GET", "/public/feed", nil), 10_000)
	if err != nil || res.StatusCode != 200 {
		t.Fatalf("GET /public/feed: %v %v", res, err)
	}
	var body struct {
		Data struct {
			Sports SportsResponse `json:"sports"`
			RSS    []RssItem      `json:"rss"`
		} `json:"data"`
	}
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}

	count := map[string]int{}
	for _, g := range body.Data.Sports.Sports {
		count[g.League+"/"+g.State]++
		if g.League == busy && g.State == "pre" && g.ExternalGameID > "pre-19" {
			t.Errorf("busy league served %s; its share is the 20 soonest", g.ExternalGameID)
		}
	}
	if count[busy+"/pre"] != 20 || count[busy+"/post"] != 20 {
		t.Errorf("busy league = %d upcoming + %d finals, want 20 + 20", count[busy+"/pre"], count[busy+"/post"])
	}
	if count[quiet+"/pre"] != 3 {
		t.Errorf("quiet league = %d games, want all 3: a busy league must not crowd it out", count[quiet+"/pre"])
	}

	perFeed := map[string]int{}
	for _, it := range body.Data.RSS {
		if len(it.GUID) > 12 && it.GUID[:12] == "scrollr-313-" {
			perFeed[it.FeedURL]++
		}
	}
	if perFeed[npr] != PublicRSSPerFeed || perFeed[bbc] != 2 {
		t.Errorf("rss per feed = npr %d, bbc %d; want %d and 2", perFeed[npr], perFeed[bbc], PublicRSSPerFeed)
	}
}
