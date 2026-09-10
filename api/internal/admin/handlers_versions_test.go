package admin

import (
	"math"
	"testing"
)

func findVersion(t *testing.T, res VersionsResponse, version string) VersionRow {
	t.Helper()
	for _, v := range res.Versions {
		if v.Version == version {
			return v
		}
	}
	t.Fatalf("version %q missing from %+v", version, res.Versions)
	return VersionRow{}
}

func closeTo(a, b float64) bool { return math.Abs(a-b) < 0.0001 }

// The three surfaces the page exists for, off one set of counters: adoption
// share, platform mix, and error rate by version.
func TestBuildVersionsResponse(t *testing.T) {
	aggs := []usageAgg{
		// 1.6.1 on Windows: 800 good, no errors.
		{"1.6.1", "windows", "2xx", 800},
		// 1.6.1 on macOS: 200 good.
		{"1.6.1", "macos", "2xx", 200},
		// 1.5.0 on Windows: 600 good, 300 server errors, 100 client errors.
		// This is the shape REL-253 would have shown as.
		{"1.5.0", "windows", "2xx", 600},
		{"1.5.0", "windows", "5xx", 300},
		{"1.5.0", "windows", "4xx", 100},
		// The website and the k8s probes.
		{"unknown", "unknown", "2xx", 5000},
	}

	res := buildVersionsResponse(aggs, 30)

	if res.DesktopTotal != 2000 {
		t.Errorf("desktop total = %d, want 2000 (browser traffic must not be in the denominator)", res.DesktopTotal)
	}
	if res.Unrecognized != 5000 {
		t.Errorf("unrecognized = %d, want 5000", res.Unrecognized)
	}

	// Adoption: newest build first, and its share is over desktop traffic only.
	if res.CurrentRelease != "1.6.1" {
		t.Errorf("current release = %q, want 1.6.1", res.CurrentRelease)
	}
	if !closeTo(res.CurrentShare, 0.5) {
		t.Errorf("current share = %v, want 0.5", res.CurrentShare)
	}

	// Error rate by version — the number that scopes a bug report.
	newest := findVersion(t, res, "1.6.1")
	if !closeTo(newest.ErrorRate, 0) {
		t.Errorf("1.6.1 error rate = %v, want 0", newest.ErrorRate)
	}
	old := findVersion(t, res, "1.5.0")
	if old.Requests != 1000 || old.ServerErrors != 300 || old.ClientErrors != 100 {
		t.Errorf("1.5.0 = %+v, want 1000 requests / 300 5xx / 100 4xx", old)
	}
	if !closeTo(old.ErrorRate, 0.4) {
		t.Errorf("1.5.0 error rate = %v, want 0.4", old.ErrorRate)
	}

	// Platform mix, biggest first.
	if len(res.Platforms) != 2 {
		t.Fatalf("platforms = %+v, want windows and macos only", res.Platforms)
	}
	if res.Platforms[0].Platform != "windows" || res.Platforms[0].Requests != 1800 {
		t.Errorf("platforms[0] = %+v, want windows/1800", res.Platforms[0])
	}
	if !closeTo(res.Platforms[0].Share, 0.9) {
		t.Errorf("windows share = %v, want 0.9", res.Platforms[0].Share)
	}
}

// Nothing has called the API yet: empty lists and zeroes, never a divide by
// zero and never a fabricated "100% on the latest".
func TestBuildVersionsResponseEmpty(t *testing.T) {
	res := buildVersionsResponse(nil, 30)
	if res.CurrentRelease != "" || res.CurrentShare != 0 {
		t.Errorf("empty counters produced current release %q at %v", res.CurrentRelease, res.CurrentShare)
	}
	if len(res.Versions) != 0 || len(res.Platforms) != 0 {
		t.Errorf("empty counters produced rows: %+v %+v", res.Versions, res.Platforms)
	}
}

// Only the website has traffic. Every install is on nothing, so there is no
// adoption to report — and crucially the page must not divide by zero or
// claim the browser bucket as a build.
func TestBuildVersionsResponseUnknownOnly(t *testing.T) {
	res := buildVersionsResponse([]usageAgg{{"unknown", "unknown", "2xx", 42}}, 7)
	if res.DesktopTotal != 0 || len(res.Versions) != 0 {
		t.Errorf("unknown traffic leaked into the desktop views: %+v", res)
	}
	if res.Unrecognized != 42 {
		t.Errorf("unrecognized = %d, want 42", res.Unrecognized)
	}
}

func TestCompareVersions(t *testing.T) {
	tests := []struct {
		a, b string
		want int
	}{
		{"1.6.1", "1.6.0", 1},
		{"1.6.0", "1.6.1", -1},
		{"1.6.1", "1.6.1", 0},
		// The whole reason this is not strings.Compare.
		{"1.10.0", "1.9.0", 1},
		{"2.0.0", "1.99.99", 1},
		// Missing trailing parts count as zero, so these tie numerically. The
		// string tie-break then orders them anyway: two spellings of the same
		// version would otherwise sort arbitrarily against each other.
		{"1.6", "1.6.0", -1},
		{"1.6.0", "1.6", 1},
		{"1.6.1", "1.6", 1},
		// Semver: a prerelease sorts below its release.
		{"1.7.0-beta.1", "1.7.0", -1},
		{"1.7.0", "1.7.0-beta.1", 1},
		{"1.7.0-beta.2", "1.7.0-beta.1", 1},
	}
	for _, tt := range tests {
		if got := compareVersions(tt.a, tt.b); got != tt.want {
			t.Errorf("compareVersions(%q, %q) = %d, want %d", tt.a, tt.b, got, tt.want)
		}
	}
}
