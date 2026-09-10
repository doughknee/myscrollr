package platform

import (
	"context"
	"fmt"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v2"
)

func resetUsage() {
	usageMu.Lock()
	usageCounts = make(map[usageKey]int64)
	usageMu.Unlock()
}

func snapshotUsage() map[usageKey]int64 {
	usageMu.Lock()
	defer usageMu.Unlock()
	out := make(map[usageKey]int64, len(usageCounts))
	for k, v := range usageCounts {
		out[k] = v
	}
	return out
}

func TestParseClientUA(t *testing.T) {
	tests := []struct {
		name, ua, version, platform string
	}{
		{"windows release", "Scrollr/1.6.1 (windows)", "1.6.1", "windows"},
		{"macos release", "Scrollr/1.6.1 (macos)", "1.6.1", "macos"},
		{"linux release", "Scrollr/2.0.0 (linux)", "2.0.0", "linux"},
		{"two-part version", "Scrollr/1.6 (linux)", "1.6", "linux"},
		{"four-part version", "Scrollr/1.6.1.2 (linux)", "1.6.1.2", "linux"},
		{"prerelease", "Scrollr/1.7.0-beta.1 (macos)", "1.7.0-beta.1", "macos"},
		{"trailing junk ignored", "Scrollr/1.6.1 (windows) extra/1", "1.6.1", "windows"},

		{"empty", "", "unknown", "unknown"},
		{"a browser", "Mozilla/5.0 (Windows NT 10.0) Chrome/140", "unknown", "unknown"},
		{"curl", "curl/8.4.0", "unknown", "unknown"},
		{"kube probe", "kube-probe/1.29", "unknown", "unknown"},
		{"unknown platform", "Scrollr/1.6.1 (freebsd)", "unknown", "unknown"},
		{"no platform", "Scrollr/1.6.1", "unknown", "unknown"},
		{"not anchored at start", "x Scrollr/1.6.1 (windows)", "unknown", "unknown"},
		{"letters in version", "Scrollr/abc (windows)", "unknown", "unknown"},
		{"absurd version length", "Scrollr/" + strings.Repeat("1", 40) + " (linux)", "unknown", "unknown"},
		{"too many segments", "Scrollr/1.2.3.4.5 (linux)", "unknown", "unknown"},
		// The closing paren has to follow the platform immediately, so an
		// attempt to smuggle a field into the user agent is rejected whole
		// rather than half-accepted.
		{"platform injection", "Scrollr/1.6.1 (windows; user=alice)", "unknown", "unknown"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			v, p := ParseClientUA(tt.ua)
			if v != tt.version || p != tt.platform {
				t.Errorf("ParseClientUA(%q) = (%q, %q), want (%q, %q)", tt.ua, v, p, tt.version, tt.platform)
			}
		})
	}
}

// TestUsageKeyHasNoPersonalFields is the erosion guard.
//
// The privacy promise for REL-271 is not a policy sentence, it is the absence
// of fields: a counter keyed by four bounded dimensions cannot carry what a
// user watches even if someone later wants it to. This test fails the moment
// a field is added to usageKey, so adding one is a deliberate act with a code
// review attached rather than a quiet afternoon of convenience.
func TestUsageKeyHasNoPersonalFields(t *testing.T) {
	want := []string{"Day", "AppVersion", "Platform", "Endpoint", "StatusClass"}
	typ := reflect.TypeOf(usageKey{})
	var got []string
	for i := 0; i < typ.NumField(); i++ {
		got = append(got, typ.Field(i).Name)
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("usageKey fields = %v, want exactly %v.\n"+
			"A new dimension on the request counters is a privacy decision: it must not be able to\n"+
			"carry a user id, an IP, a symbol, a team, a feed URL or anything else off a user's screen.\n"+
			"See api/internal/platform/usage.go and REL-271 before changing this.", got, want)
	}
}

// TestUsageStoresNothingPersonal drives real requests carrying every kind of
// thing that must never be kept — a username in the path, a ticker symbol and
// a feed URL in the query string, a bearer token, a client IP — and asserts
// none of it survives into a counter.
func TestUsageStoresNothingPersonal(t *testing.T) {
	resetUsage()

	app := fiber.New()
	app.Use(RecordUsage)
	app.Get("/users/:username", func(c *fiber.Ctx) error { return c.SendString("ok") })
	app.Get("/public/feed", func(c *fiber.Ctx) error { return c.SendString("ok") })

	req := httptest.NewRequest("GET", "/users/alice-secret?symbol=NVDA&team=packers&feed=https://example.com/rss.xml", nil)
	req.Header.Set("User-Agent", "Scrollr/1.6.1 (windows)")
	req.Header.Set("Authorization", "Bearer tok_supersecret")
	req.Header.Set("X-Forwarded-For", "203.0.113.42")
	if _, err := app.Test(req); err != nil {
		t.Fatalf("request: %v", err)
	}

	req2 := httptest.NewRequest("GET", "/public/feed?symbols=AAPL,TSLA", nil)
	req2.Header.Set("User-Agent", "Scrollr/1.6.1 (windows)")
	if _, err := app.Test(req2); err != nil {
		t.Fatalf("request: %v", err)
	}

	forbidden := []string{
		"alice-secret", "NVDA", "AAPL", "TSLA", "packers",
		"example.com", "rss.xml", "tok_supersecret", "203.0.113.42", "?",
	}

	keys := snapshotUsage()
	if len(keys) != 2 {
		t.Fatalf("got %d counters, want 2 (one per route)", len(keys))
	}
	for k := range keys {
		v := reflect.ValueOf(k)
		for i := 0; i < v.NumField(); i++ {
			f := v.Field(i)
			if f.Kind() != reflect.String {
				continue
			}
			for _, bad := range forbidden {
				if strings.Contains(f.String(), bad) {
					t.Errorf("counter field %s = %q contains %q — nothing about what a user watches may be stored",
						v.Type().Field(i).Name, f.String(), bad)
				}
			}
		}
		if k.Endpoint != "/users/:username" && k.Endpoint != "/public/feed" {
			t.Errorf("endpoint %q is not a registered route pattern", k.Endpoint)
		}
	}
}

// TestUsageAggregatesNotAccumulates is the "a day is a few hundred rows"
// promise: a thousand requests to the same route are one counter, not a
// thousand records.
func TestUsageAggregatesNotAccumulates(t *testing.T) {
	resetUsage()

	app := fiber.New()
	app.Use(RecordUsage)
	app.Get("/dashboard", func(c *fiber.Ctx) error { return c.SendString("ok") })

	for i := 0; i < 1000; i++ {
		req := httptest.NewRequest("GET", "/dashboard", nil)
		req.Header.Set("User-Agent", "Scrollr/1.6.1 (windows)")
		if _, err := app.Test(req); err != nil {
			t.Fatalf("request %d: %v", i, err)
		}
	}

	keys := snapshotUsage()
	if len(keys) != 1 {
		t.Fatalf("got %d counters for 1000 identical requests, want 1", len(keys))
	}
	for k, n := range keys {
		if n != 1000 {
			t.Errorf("counter = %d, want 1000", n)
		}
		if k.AppVersion != "1.6.1" || k.Platform != "windows" || k.Endpoint != "/dashboard" || k.StatusClass != "2xx" {
			t.Errorf("unexpected key %+v", k)
		}
	}
}

// TestUsageStatusClasses is what makes error rate by version work: a failing
// endpoint has to land in its own bucket, separate from the same endpoint's
// successes and from other builds.
func TestUsageStatusClasses(t *testing.T) {
	resetUsage()

	app := fiber.New()
	app.Use(RecordUsage)
	app.Get("/dashboard", func(c *fiber.Ctx) error { return c.SendString("ok") })
	app.Get("/boom", func(c *fiber.Ctx) error {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "boom"})
	})
	app.Get("/upstream", func(c *fiber.Ctx) error {
		return fiber.NewError(fiber.StatusBadGateway, "upstream")
	})

	for _, tc := range []struct{ path, ua string }{
		{"/dashboard", "Scrollr/1.6.1 (windows)"},
		{"/boom", "Scrollr/1.5.0 (windows)"},
		{"/upstream", "Scrollr/1.5.0 (windows)"},
		{"/nope", "Scrollr/1.5.0 (windows)"},
	} {
		req := httptest.NewRequest("GET", tc.path, nil)
		req.Header.Set("User-Agent", tc.ua)
		if _, err := app.Test(req); err != nil {
			t.Fatalf("%s: %v", tc.path, err)
		}
	}

	classes := map[string]string{}
	for k := range snapshotUsage() {
		classes[k.Endpoint] = k.StatusClass
	}
	for endpoint, want := range map[string]string{
		"/dashboard": "2xx", "/boom": "5xx", "/upstream": "5xx",
	} {
		if got := classes[endpoint]; got != want {
			t.Errorf("%s status class = %q, want %q", endpoint, got, want)
		}
	}
	// The 404 matched no route, so it is counted against "/" rather than
	// inventing a dimension value out of an unrouted path.
	if got := classes["/"]; got != "4xx" {
		t.Errorf("unrouted request status class = %q, want 4xx", got)
	}
}

// TestUsageKeyCap: a caller minting a fresh well-formed version on every
// request must not be able to grow the buffer, or the table, without limit.
func TestUsageKeyCap(t *testing.T) {
	resetUsage()
	defer resetUsage()

	for i := 0; i < usageMaxKeys+500; i++ {
		countUsage(usageKey{AppVersion: fmt.Sprintf("9.9.%d", i), Endpoint: "/dashboard"})
	}
	if n := len(snapshotUsage()); n != usageMaxKeys {
		t.Errorf("buffer holds %d keys, want it capped at %d", n, usageMaxKeys)
	}
}

// FlushUsage must be a no-op without a database rather than a panic — the
// unit-test runs and any pod that serves before the pool is up both hit it.
func TestFlushUsageWithoutDB(t *testing.T) {
	resetUsage()
	countUsage(usageKey{AppVersion: "1.6.1", Endpoint: "/dashboard"})
	FlushUsage(context.Background())
	if n := len(snapshotUsage()); n != 0 {
		t.Errorf("buffer still holds %d keys after flush, want 0", n)
	}
}
