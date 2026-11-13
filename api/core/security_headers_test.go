package core

import (
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v2"
)

// SCROLLR-459 / CN-9: no path gets an inline-script allowance from the global
// header middleware (the old /yahoo/callback branch served a route that no
// longer exists).
func TestSecurityHeadersNeverAllowInlineScript(t *testing.T) {
	app := fiber.New()
	app.Use(securityHeaders)
	app.Get("/*", func(c *fiber.Ctx) error { return c.SendString("ok") })
	for _, path := range []string{"/", "/yahoo/callback", "/events"} {
		resp, err := app.Test(httptest.NewRequest("GET", path, nil))
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		csp := resp.Header.Get("Content-Security-Policy")
		if csp == "" || strings.Contains(csp, "unsafe-inline") {
			t.Fatalf("%s: CSP %q", path, csp)
		}
	}
}
