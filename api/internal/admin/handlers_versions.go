package admin

import (
	"context"
	"log"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/gofiber/fiber/v2"
)

// The Versions page (REL-271) — three questions the counters can answer, and
// one they cannot.
//
// Everything here is built from `api_usage_daily`, which holds request counts
// keyed by (day, app version, platform, route pattern, status class) and
// nothing else. That bounds what this page is allowed to claim, and the
// Overview's honesty rule applies: a number that is a proxy says so in its
// own label rather than borrowing the authority of a headcount.
//
// The proxy that matters: these are REQUESTS, not installs. We deliberately
// store no user id, so "40% of installs are on 1.6.1" is not measurable here.
// What is measurable is "40% of desktop API traffic comes from 1.6.1", and
// since every install polls the dashboard on the same timer, that tracks
// adoption closely enough to answer "is anyone still on 1.4.0". The client
// labels it as traffic share. It must never be relabelled as installs.

// VersionRow is one build's share of desktop traffic, and how much of it went
// wrong. The error rate is the whole point of the page: it is what turns
// "some users report X" into "X is 1.5.x on Windows".
type VersionRow struct {
	Version      string  `json:"version"`
	Requests     int64   `json:"requests"`
	Share        float64 `json:"share"`         // of desktop traffic, 0..1
	ClientErrors int64   `json:"client_errors"` // 4xx
	ServerErrors int64   `json:"server_errors"` // 5xx
	ErrorRate    float64 `json:"error_rate"`    // (4xx+5xx)/requests, 0..1
}

// PlatformRow is the OS mix, over the same desktop traffic.
type PlatformRow struct {
	Platform string  `json:"platform"`
	Requests int64   `json:"requests"`
	Share    float64 `json:"share"`
}

type VersionsResponse struct {
	GeneratedAt string `json:"generated_at"`
	Days        int    `json:"days"`
	// The newest build that has actually called the API in the window. Derived
	// from the counters, not from GitHub — this is "what is out there", and a
	// release nobody has installed yet correctly does not appear.
	CurrentRelease string        `json:"current_release"`
	CurrentShare   float64       `json:"current_share"`
	Versions       []VersionRow  `json:"versions"`
	Platforms      []PlatformRow `json:"platforms"`
	DesktopTotal   int64         `json:"desktop_total"`
	// Requests whose user agent was not a recognisable Scrollr build: the
	// website, the extension, curl, k8s probes. Kept visible on purpose — if
	// desktop traffic ever stops being recognised, this is where it shows up,
	// and a silently empty adoption chart is exactly the failure this issue
	// exists to prevent.
	Unrecognized int64 `json:"unrecognized"`
}

// usageAgg is one grouped row out of the counters table.
type usageAgg struct {
	version     string
	platform    string
	statusClass string
	requests    int64
}

// HandleGetVersions — GET /admin/versions?days=N
func HandleGetVersions(c *fiber.Ctx) error {
	days := 30
	if raw := c.Query("days"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n >= 1 && n <= 365 {
			days = n
		}
	}
	since := time.Now().UTC().Truncate(24*time.Hour).AddDate(0, 0, -(days - 1))

	rows, err := platform.DBPool.Query(context.Background(),
		`SELECT app_version, platform, status_class, SUM(requests)
		   FROM api_usage_daily
		  WHERE day >= $1
		  GROUP BY app_version, platform, status_class`, since)
	if err != nil {
		log.Printf("[Admin] versions query: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(platform.ErrorResponse{
			Status: "error", Error: "Could not read the request counters",
		})
	}
	defer rows.Close()

	aggs := make([]usageAgg, 0, 256)
	for rows.Next() {
		var a usageAgg
		if err := rows.Scan(&a.version, &a.platform, &a.statusClass, &a.requests); err != nil {
			log.Printf("[Admin] versions scan: %v", err)
			continue
		}
		aggs = append(aggs, a)
	}

	return c.JSON(buildVersionsResponse(aggs, days))
}

// buildVersionsResponse folds the grouped counters into the three views. Split
// out from the handler so the shares and the error rates are testable without
// a database.
func buildVersionsResponse(aggs []usageAgg, days int) VersionsResponse {
	res := VersionsResponse{
		GeneratedAt: time.Now().UTC().Format(time.RFC3339),
		Days:        days,
		Versions:    []VersionRow{},
		Platforms:   []PlatformRow{},
	}

	byVersion := map[string]*VersionRow{}
	byPlatform := map[string]int64{}

	for _, a := range aggs {
		// "unknown" is everything that is not a Scrollr desktop build. It is
		// counted and shown, but it is not part of any adoption denominator —
		// a browser has no app version to adopt.
		if a.version == "unknown" {
			res.Unrecognized += a.requests
			continue
		}

		v, ok := byVersion[a.version]
		if !ok {
			v = &VersionRow{Version: a.version}
			byVersion[a.version] = v
		}
		v.Requests += a.requests
		switch a.statusClass {
		case "4xx":
			v.ClientErrors += a.requests
		case "5xx":
			v.ServerErrors += a.requests
		}

		byPlatform[a.platform] += a.requests
		res.DesktopTotal += a.requests
	}

	for _, v := range byVersion {
		if res.DesktopTotal > 0 {
			v.Share = float64(v.Requests) / float64(res.DesktopTotal)
		}
		if v.Requests > 0 {
			v.ErrorRate = float64(v.ClientErrors+v.ServerErrors) / float64(v.Requests)
		}
		res.Versions = append(res.Versions, *v)
	}
	// Newest build first: the question is almost always "how much of the fleet
	// has moved up", which reads top-down.
	sort.Slice(res.Versions, func(i, j int) bool {
		return compareVersions(res.Versions[i].Version, res.Versions[j].Version) > 0
	})
	if len(res.Versions) > 0 {
		res.CurrentRelease = res.Versions[0].Version
		res.CurrentShare = res.Versions[0].Share
	}

	for p, n := range byPlatform {
		row := PlatformRow{Platform: p, Requests: n}
		if res.DesktopTotal > 0 {
			row.Share = float64(n) / float64(res.DesktopTotal)
		}
		res.Platforms = append(res.Platforms, row)
	}
	sort.Slice(res.Platforms, func(i, j int) bool {
		return res.Platforms[i].Requests > res.Platforms[j].Requests
	})

	return res
}

// compareVersions orders dotted numeric versions numerically, so 1.10.0 sorts
// above 1.9.0 where a string compare would not. A pre-release suffix
// ("1.7.0-beta.1") sorts below the same release without one, per semver.
// Returns -1, 0 or 1.
//
// Only identical strings return 0. Two spellings that tie numerically ("1.6"
// and "1.6.0") fall back to a string compare, because sort.Slice is not
// stable and a list that reorders itself between reads is worse than an
// arbitrary but fixed order.
func compareVersions(a, b string) int {
	aNum, aPre := splitPrerelease(a)
	bNum, bPre := splitPrerelease(b)
	for i := 0; i < len(aNum) || i < len(bNum); i++ {
		x, y := 0, 0
		if i < len(aNum) {
			x = aNum[i]
		}
		if i < len(bNum) {
			y = bNum[i]
		}
		if x != y {
			if x < y {
				return -1
			}
			return 1
		}
	}
	switch {
	case aPre == bPre:
		return strings.Compare(a, b)
	case aPre == "":
		return 1
	case bPre == "":
		return -1
	}
	return strings.Compare(aPre, bPre)
}

func splitPrerelease(v string) ([]int, string) {
	pre := ""
	if i := strings.IndexByte(v, '-'); i >= 0 {
		pre = v[i+1:]
		v = v[:i]
	}
	parts := strings.Split(v, ".")
	nums := make([]int, 0, len(parts))
	for _, p := range parts {
		n, _ := strconv.Atoi(p)
		nums = append(nums, n)
	}
	return nums, pre
}
