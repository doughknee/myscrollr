package support

import (
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v2"
)

// SCROLLR-459 / SB-9: an authenticated ticket is filed under the account's
// verified email, and the `email` the client put in the body is never used.
func TestAuthenticatedTicketNeverUsesClientSuppliedEmail(t *testing.T) {
	var posted OSTicketPayload
	osticket := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(b, &posted)
		w.WriteHeader(201)
		_, _ = w.Write([]byte(`"123456"`))
	}))
	defer osticket.Close()
	t.Setenv("OSTICKET_URL", osticket.URL)
	t.Setenv("OSTICKET_API_KEY", "k")
	t.Setenv("ANTHROPIC_API_KEY", "")

	prev := lookupVerifiedEmail
	defer func() { lookupVerifiedEmail = prev }()

	for i, tc := range []struct {
		name   string
		lookup func(string) (string, error)
		claim  string
		want   string
	}{
		{"verified email wins", func(string) (string, error) { return "me@example.com", nil }, "", "me@example.com"},
		{"account has no email", func(string) (string, error) { return "", nil }, "claim@example.com", anonymousTicketEmail},
		{"logto unreachable falls back to the token's own claim", func(string) (string, error) { return "", errors.New("down") }, "claim@example.com", "claim@example.com"},
		{"logto unreachable and no claim", func(string) (string, error) { return "", errors.New("down") }, "", anonymousTicketEmail},
	} {
		t.Run(tc.name, func(t *testing.T) {
			lookupVerifiedEmail = tc.lookup
			posted = OSTicketPayload{}
			app := fiber.New()
			app.Post("/support/ticket", func(c *fiber.Ctx) error {
				c.Locals("user_id", "sub-sb9-"+string(rune('a'+i)))
				c.Locals("user_email", tc.claim)
				return HandleSubmitSupportTicket(c)
			})
			// A real listener, not app.Test: under app.Test c.Context() is
			// already cancelled, which would fail the osTicket call.
			ln, err := net.Listen("tcp", "127.0.0.1:0")
			if err != nil {
				t.Fatal(err)
			}
			go func() { _ = app.Listener(ln) }()
			defer func() { _ = app.Shutdown() }()
			body := `{"category":"feedback","description":"hello there","email":"victim@example.com"}`
			resp, err := http.Post("http://"+ln.Addr().String()+"/support/ticket", "application/json", strings.NewReader(body))
			if err != nil {
				t.Fatal(err)
			}
			resp.Body.Close()
			if resp.StatusCode != 200 {
				t.Fatalf("status %d", resp.StatusCode)
			}
			if posted.Email != tc.want {
				t.Fatalf("ticket email = %q, want %q", posted.Email, tc.want)
			}
		})
	}
}
