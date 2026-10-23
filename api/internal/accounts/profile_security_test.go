package accounts

import (
	"encoding/json"
	"github.com/brandon-relentnet/myscrollr/api/internal/testsupport"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"
)

func TestProfileEmailChangesNeverReachIdentityProvider(t *testing.T) {
	var calls atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1); w.WriteHeader(500) }))
	defer upstream.Close()
	t.Setenv("LOGTO_ENDPOINT", upstream.URL)
	app := fiber.New()
	app.Put("/profile", func(c *fiber.Ctx) error { c.Locals("user_id", "ordinary-user"); return c.Next() }, HandleUpdateProfile)
	for _, body := range []string{`{"email":"staff@example.test"}`, `{"name":"Partial change","email":"staff@example.test"}`, `{"email":""}`} {
		req := httptest.NewRequest("PUT", "/profile", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		resp, err := app.Test(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != 403 {
			t.Fatalf("email write status = %d, want 403", resp.StatusCode)
		}
	}
	if calls.Load() != 0 {
		t.Fatal("rejected email request contacted identity provider")
	}
}

func TestProfileDisplayNameStillUpdates(t *testing.T) {
	_, cleanup := testsupport.MiniRedis(t)
	defer cleanup()
	var calls atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "PATCH" || r.URL.Path != "/api/users/ordinary-user" {
			t.Errorf("unexpected identity request: %s %s", r.Method, r.URL.Path)
			w.WriteHeader(500)
			return
		}
		var payload map[string]string
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Error(err)
		}
		if len(payload) != 1 || payload["name"] != "Updated name" {
			t.Errorf("unexpected name payload: %v", payload)
		}
		calls.Add(1)
		w.Write([]byte(`{}`))
	}))
	defer upstream.Close()
	t.Setenv("LOGTO_ENDPOINT", upstream.URL)
	m2mMu.Lock()
	m2mToken = "fixture"
	m2mTokenExpiry = time.Now().Add(time.Hour)
	m2mMu.Unlock()
	defer ResetM2MTokenCache()
	app := fiber.New()
	app.Put("/profile", func(c *fiber.Ctx) error { c.Locals("user_id", "ordinary-user"); return c.Next() }, HandleUpdateProfile)
	req := httptest.NewRequest("PUT", "/profile", strings.NewReader(`{"name":"Updated name"}`))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 200 || calls.Load() != 1 {
		t.Fatalf("name update failed: status=%d calls=%d", resp.StatusCode, calls.Load())
	}
}
