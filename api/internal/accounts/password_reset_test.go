package accounts

import (
	"bytes"
	"context"
	"log"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v2"
)

// The password-reset log line identifies the account, never the address
// (SECURITY-BACKEND minor: raw email in logs).
func TestPasswordResetLogOmitsEmail(t *testing.T) {
	resend := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	defer resend.Close()
	// The handler dials api.resend.com; route that to the test server, whose
	// certificate is issued for example.com.
	tr := resend.Client().Transport.(*http.Transport).Clone()
	tr.TLSClientConfig.ServerName = "example.com"
	addr := resend.Listener.Addr().String()
	tr.DialContext = func(ctx context.Context, network, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, network, addr)
	}
	previousTransport := http.DefaultTransport
	http.DefaultTransport = tr
	t.Cleanup(func() { http.DefaultTransport = previousTransport })
	t.Setenv("RESEND_API_KEY", "test")

	var logs bytes.Buffer
	log.SetOutput(&logs)
	t.Cleanup(func() { log.SetOutput(os.Stderr) })

	const email = "person@example.com"
	app := fiber.New()
	app.Post("/reset", func(c *fiber.Ctx) error {
		c.Locals("user_id", "sub-password-reset-log")
		c.Locals("user_email", email)
		return c.Next()
	}, HandleRequestPasswordReset)
	resp, err := app.Test(httptest.NewRequest(http.MethodPost, "/reset", nil), 15000)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != fiber.StatusNoContent {
		t.Fatalf("reset: got %d, want 204; logs: %s", resp.StatusCode, logs.String())
	}
	if strings.Contains(logs.String(), email) {
		t.Fatalf("log carries the email address: %s", logs.String())
	}
}
