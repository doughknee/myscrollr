package admin

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
)

// Downloads per release, from the GitHub Releases API.
//
// This is the closest thing to an install count that actually exists, and the
// distance between the two is real: a download is one person fetching a file
// once. It says nothing about whether the app was installed, kept, or ever
// opened, and one person upgrading through five releases is five downloads.
// So the field is named downloads, the tile is labelled downloads, and
// OverviewResponse.Installs separately says installs are not measurable.
const (
	releasesURL       = "https://api.github.com/repos/brandon-relentnet/myscrollr/releases?per_page=30"
	downloadsCacheKey = "scrollr:admin:downloads"
	downloadsCacheTTL = 15 * time.Minute
	downloadsTimeout  = 8 * time.Second
	overviewTimeout   = 15 * time.Second
)

type DownloadsTile struct {
	Total    int            `json:"total"`
	Releases []ReleaseCount `json:"releases"`
	// Stale marks a response served from cache after a failed refresh, so the
	// page can say the numbers are older than they look.
	Stale bool   `json:"stale"`
	Error string `json:"error,omitempty"`
}

type ReleaseCount struct {
	Tag         string `json:"tag"`
	Name        string `json:"name"`
	PublishedAt string `json:"published_at"`
	Downloads   int    `json:"downloads"`
	Prerelease  bool   `json:"prerelease"`
}

// githubToken mirrors the lookup in internal/support: optional, and only
// there to lift the unauthenticated rate limit.
func githubToken() string {
	for _, k := range []string{"GITHUB_TOKEN", "GH_TOKEN"} {
		if v := strings.TrimSpace(os.Getenv(k)); v != "" {
			return v
		}
	}
	return ""
}

func downloadsTile(ctx context.Context) DownloadsTile {
	if cached, ok := readDownloadsCache(ctx); ok {
		return cached
	}

	tile, err := fetchDownloads(ctx)
	if err != nil {
		log.Printf("[Admin] downloads fetch: %v", err)
		// GitHub rate limits are routine. Rather than blanking the tile, serve
		// the last good answer and mark it stale.
		if stale, ok := readDownloadsCache(ctx, true); ok {
			stale.Stale = true
			return stale
		}
		return DownloadsTile{Error: "GitHub releases are unavailable right now."}
	}

	writeDownloadsCache(ctx, tile)
	return tile
}

func fetchDownloads(ctx context.Context) (DownloadsTile, error) {
	var tile DownloadsTile

	reqCtx, cancel := context.WithTimeout(ctx, downloadsTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, "GET", releasesURL, nil)
	if err != nil {
		return tile, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	if token := githubToken(); token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return tile, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return tile, &githubError{status: resp.StatusCode}
	}

	var releases []struct {
		TagName     string `json:"tag_name"`
		Name        string `json:"name"`
		PublishedAt string `json:"published_at"`
		Prerelease  bool   `json:"prerelease"`
		Assets      []struct {
			DownloadCount int `json:"download_count"`
		} `json:"assets"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&releases); err != nil {
		return tile, err
	}

	for _, r := range releases {
		count := 0
		for _, a := range r.Assets {
			count += a.DownloadCount
		}
		tile.Releases = append(tile.Releases, ReleaseCount{
			Tag:         r.TagName,
			Name:        r.Name,
			PublishedAt: r.PublishedAt,
			Downloads:   count,
			Prerelease:  r.Prerelease,
		})
		tile.Total += count
	}
	return tile, nil
}

type githubError struct{ status int }

func (e *githubError) Error() string {
	return "github releases returned " + http.StatusText(e.status)
}

// readDownloadsCache returns the cached tile. With ignoreTTL the value is
// returned however old it is, which is what the stale fallback wants.
func readDownloadsCache(ctx context.Context, ignoreTTL ...bool) (DownloadsTile, bool) {
	var tile DownloadsTile
	if platform.Rdb == nil {
		return tile, false
	}
	key := downloadsCacheKey
	if len(ignoreTTL) > 0 && ignoreTTL[0] {
		key = downloadsCacheKey + ":last"
	}
	raw, err := platform.Rdb.Get(ctx, key).Result()
	if err != nil || raw == "" {
		return tile, false
	}
	if err := json.Unmarshal([]byte(raw), &tile); err != nil {
		return DownloadsTile{}, false
	}
	return tile, true
}

func writeDownloadsCache(ctx context.Context, tile DownloadsTile) {
	if platform.Rdb == nil {
		return
	}
	raw, err := json.Marshal(tile)
	if err != nil {
		return
	}
	_ = platform.Rdb.Set(ctx, downloadsCacheKey, raw, downloadsCacheTTL).Err()
	// A second, long-lived copy so a GitHub outage degrades to "these numbers
	// are stale" instead of "no numbers".
	_ = platform.Rdb.Set(ctx, downloadsCacheKey+":last", raw, 7*24*time.Hour).Err()
}
