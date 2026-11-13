package core

import (
	"context"
	"encoding/json"
	"net"
	"net/http/httptest"
	"testing"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/brandon-relentnet/myscrollr/api/internal/testsupport"
	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/valyala/fasthttp"
)

// closedPool is a pool whose every query fails, standing in for a database
// that is down or failing over.
func closedPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	pool, err := pgxpool.New(context.Background(), platform.DBPool.Config().ConnString())
	if err != nil {
		t.Fatal(err)
	}
	pool.Close()
	return pool
}

// RB-5: a database error must reach the client as an error and must not be
// cached; once the database is back, an account with no widgets is a real,
// cached 200 with an empty list.
func TestDashboardDatabaseErrorIsNotAnEmptyAccount(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	mr, cleanup := testsupport.MiniRedis(t)
	defer cleanup()

	const sub = "t444-dashboard-user"
	t.Cleanup(func() { testsupport.MustExec(t, `DELETE FROM user_preferences WHERE logto_sub=$1`, sub) })

	s := NewServer()
	app := fiber.New()
	app.Get("/dashboard", func(c *fiber.Ctx) error {
		c.Locals("user_id", sub)
		return c.Next()
	}, s.getDashboard)

	real := platform.DBPool
	platform.DBPool = closedPool(t)
	resp, err := app.Test(httptest.NewRequest("GET", "/dashboard", nil))
	platform.DBPool = real
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode < 500 {
		t.Fatalf("database down: got %d, want 5xx", resp.StatusCode)
	}
	if mr.Exists(platform.RedisDashboardCachePrefix + sub) {
		t.Fatal("the failed answer was cached")
	}

	// Database back: a first-time user (preferences created on the fly) with
	// no widgets is a real empty account.
	resp, err = app.Test(httptest.NewRequest("GET", "/dashboard", nil))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != fiber.StatusOK {
		t.Fatalf("empty account: got %d, want 200", resp.StatusCode)
	}
	var body struct {
		Widgets     []any           `json:"widgets"`
		Preferences json.RawMessage `json:"preferences"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if len(body.Widgets) != 0 || len(body.Preferences) == 0 {
		t.Fatalf("empty account body wrong: widgets=%v prefs=%s", body.Widgets, body.Preferences)
	}
	if !mr.Exists(platform.RedisDashboardCachePrefix + sub) {
		t.Fatal("a complete answer should be cached")
	}
}

// RB-1 / SCROLLR-367: liveness is the process alone; readiness is Postgres
// and Redis only.
func TestProbesDoNotDependOnIngesters(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	mr, cleanup := testsupport.MiniRedis(t)
	defer cleanup()
	// An ingester that is down: /health reports it, the probes must not care.
	t.Setenv("INTERNAL_FINANCE_URL", "http://127.0.0.1:1")

	s := NewServer()
	s.setupRoutes()
	get := func(path string) int {
		t.Helper()
		resp, err := s.App.Test(httptest.NewRequest("GET", path, nil))
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		return resp.StatusCode
	}

	if got := get("/health"); got != fiber.StatusServiceUnavailable {
		t.Fatalf("/health with a dead ingester: got %d, want 503 (body and codes unchanged)", got)
	}
	if got := get("/health/live"); got != fiber.StatusOK {
		t.Fatalf("/health/live: got %d, want 200", got)
	}
	if got := get("/health/ready"); got != fiber.StatusOK {
		t.Fatalf("/health/ready with a dead ingester: got %d, want 200", got)
	}

	mr.Close()
	if got := get("/health/live"); got != fiber.StatusOK {
		t.Fatalf("/health/live with Redis down: got %d, want 200", got)
	}
	if got := get("/health/ready"); got != fiber.StatusServiceUnavailable {
		t.Fatalf("/health/ready with Redis down: got %d, want 503", got)
	}
}

// SB-3: the limiter key (c.IP()) comes from the header ingress-nginx writes,
// never from a forwarded chain the caller can fill in.
func TestClientIPIgnoresCallerSuppliedForwardedFor(t *testing.T) {
	s := NewServer()
	ipFrom := func(remote, realIP, forwarded string) string {
		var rc fasthttp.RequestCtx
		req := fasthttp.AcquireRequest()
		defer fasthttp.ReleaseRequest(req)
		req.Header.SetMethod(fiber.MethodGet)
		req.Header.Set("X-Real-IP", realIP)
		req.Header.Set("X-Forwarded-For", forwarded)
		rc.Init(req, &net.TCPAddr{IP: net.ParseIP(remote), Port: 1234}, nil)
		c := s.App.AcquireCtx(&rc)
		defer s.App.ReleaseCtx(c)
		return c.IP()
	}

	if got := ipFrom("10.244.0.2", "203.0.113.9", "6.6.6.6, 203.0.113.9"); got != "203.0.113.9" {
		t.Fatalf("behind ingress: got %q, want the X-Real-IP value", got)
	}
	if got := ipFrom("198.51.100.7", "6.6.6.6", "7.7.7.7"); got != "198.51.100.7" {
		t.Fatalf("direct caller: got %q, want its own address", got)
	}
}
