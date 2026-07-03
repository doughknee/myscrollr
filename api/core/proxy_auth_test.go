package core

import (
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/gofiber/fiber/v2"
)

// Regression tests for the dynamic-proxy fail-open (2026-07-03): ValidateAuth
// used to return c.JSON's nil after writing a 401, so `err != nil` callers
// treated a rendered 401 as success — the proxy forwarded unauthenticated
// requests and the upstream response overwrote the 401, making every
// Auth:true channel route effectively public.

// seedTestChannel installs a fake channel in the discovery registry and
// returns a restore func. Tests using it must not run in parallel.
func seedTestChannel(t *testing.T, info *ChannelInfo) func() {
	t.Helper()
	globalDiscovery.mu.Lock()
	prev := globalDiscovery.channels
	globalDiscovery.channels = map[string]*ChannelInfo{info.Name: info}
	globalDiscovery.mu.Unlock()
	return func() {
		globalDiscovery.mu.Lock()
		globalDiscovery.channels = prev
		globalDiscovery.mu.Unlock()
	}
}

func TestDynamicProxyRejectsUnauthenticated(t *testing.T) {
	var upstreamHits atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		upstreamHits.Add(1)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"leaked":true}`))
	}))
	defer upstream.Close()

	restore := seedTestChannel(t, &ChannelInfo{
		Name:        "testchan",
		InternalURL: upstream.URL,
		Routes: []ChannelRoute{
			{Method: "GET", Path: "/testchan/private", Auth: true},
			{Method: "GET", Path: "/testchan/public", Auth: false},
		},
	})
	defer restore()

	app := fiber.New()
	SetupDynamicProxy(app)

	// Auth:true without a token must 401 and never reach the channel.
	req := httptest.NewRequest("GET", "/testchan/private", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("app.Test: %v", err)
	}
	if resp.StatusCode != fiber.StatusUnauthorized {
		t.Errorf("unauthenticated Auth:true route: got %d, want 401", resp.StatusCode)
	}
	if n := upstreamHits.Load(); n != 0 {
		t.Errorf("unauthenticated request reached the channel upstream (%d hits)", n)
	}

	// Auth:false still proxies straight through.
	req = httptest.NewRequest("GET", "/testchan/public", nil)
	resp, err = app.Test(req)
	if err != nil {
		t.Fatalf("app.Test: %v", err)
	}
	if resp.StatusCode != fiber.StatusOK {
		t.Errorf("public route: got %d, want 200", resp.StatusCode)
	}
	if n := upstreamHits.Load(); n != 1 {
		t.Errorf("public route upstream hits: got %d, want 1", n)
	}
}

func TestLogtoAuthBlocksHandlerWhenUnauthenticated(t *testing.T) {
	var handlerRan atomic.Bool

	app := fiber.New()
	app.Get("/protected", LogtoAuth, func(c *fiber.Ctx) error {
		handlerRan.Store(true)
		return c.SendString("secret")
	})

	resp, err := app.Test(httptest.NewRequest("GET", "/protected", nil))
	if err != nil {
		t.Fatalf("app.Test: %v", err)
	}
	if resp.StatusCode != fiber.StatusUnauthorized {
		t.Errorf("unauthenticated protected route: got %d, want 401", resp.StatusCode)
	}
	if handlerRan.Load() {
		t.Error("protected handler executed for an unauthenticated request")
	}
}
