package accounts

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"
)

func TestInviteLookupRequiresUniqueExactEmail(t *testing.T) {
	for _, tc := range []struct {
		body    string
		allowed bool
	}{
		{`[{"id":"wrong","primaryEmail":"firstXlast@example.test"}]`, false},
		{`[{"id":"wrong"}]`, false},
		{`[{"id":"one","primaryEmail":"first_last@example.test"},{"id":"two","primaryEmail":"first_last@example.test"}]`, false},
		{`[{"id":"right","primaryEmail":"FIRST_LAST@example.test","username":"existing"}]`, true},
	} {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Query().Get("mode.primaryEmail") != "exact" {
				t.Error("identity search did not request exact mode")
			}
			w.Write([]byte(tc.body))
		}))
		id, _, err := findUserByEmail(srv.URL, "fixture", "first_last@example.test")
		srv.Close()
		if tc.allowed {
			if err != nil || id != "right" {
				t.Fatalf("exact match failed: %q %v", id, err)
			}
		} else if err == nil || id != "" {
			t.Fatal("mismatched or ambiguous account accepted")
		}
	}
}

// SCROLLR-459 / SB-8: the username check no longer says which emails belong to
// super users. Without the invite's own one-time token every email gets the
// same answer, and with it the invitee still gets the real one.
func TestUsernameCheckIsIdenticalForEveryoneWithoutTheInviteToken(t *testing.T) {
	logto := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/api/one-time-tokens":
			w.Write([]byte(`[{"id":"t","email":"invitee@example.test","token":"good","status":"active"}]`))
		case r.URL.Path == "/api/users" && r.URL.Query().Get("search.primaryEmail") != "":
			e := r.URL.Query().Get("search.primaryEmail")
			w.Write([]byte(`[{"id":"u-` + e + `","primaryEmail":"` + e + `"}]`))
		case strings.HasSuffix(r.URL.Path, "/roles"):
			w.Write([]byte(`[{"id":"super-role"}]`))
		case r.URL.Path == "/api/users":
			w.Write([]byte(`[]`))
		default:
			w.WriteHeader(404)
		}
	}))
	defer logto.Close()
	t.Setenv("LOGTO_ENDPOINT", logto.URL)
	t.Setenv("LOGTO_SUPER_USER_ROLE_ID", "super-role")
	m2mMu.Lock()
	m2mToken, m2mTokenExpiry = "m2m", time.Now().Add(time.Hour)
	m2mMu.Unlock()
	defer ResetM2MTokenCache()

	app := fiber.New()
	app.Post("/invite/username-available", HandleCheckUsernameAvailable)
	call := func(body string) (int, string) {
		req := httptest.NewRequest("POST", "/invite/username-available", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		resp, err := app.Test(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		b, _ := io.ReadAll(resp.Body)
		return resp.StatusCode, string(b)
	}

	// A super user's email and a stranger's email, neither with a valid token.
	s1, b1 := call(`{"email":"invitee@example.test","token":"wrong","username":"someone"}`)
	s2, b2 := call(`{"email":"stranger@example.test","token":"wrong","username":"someone"}`)
	if s1 != 403 || s2 != 403 || b1 != b2 {
		t.Fatalf("responses differ without the token: %d %q vs %d %q", s1, b1, s2, b2)
	}
	// The invitee, holding their token, still gets a real answer.
	if s, b := call(`{"email":"invitee@example.test","token":"good","username":"someone"}`); s != 200 || !strings.Contains(b, `"available":true`) {
		t.Fatalf("invitee with token: %d %s", s, b)
	}
	// The token belongs to one address: another email with it is refused.
	if s, _ := call(`{"email":"stranger@example.test","token":"good","username":"someone"}`); s != 403 {
		t.Fatalf("token accepted for a different email: %d", s)
	}
}
