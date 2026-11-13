package accounts

import (
	"net/http/httptest"
	"testing"

	"github.com/gofiber/fiber/v2"
)

// SCROLLR-459 / SB-5: the Logto token proxy has its own per-address budget.
// Ordinary use stays under it, a flood is cut off, and the cut-off is a 5xx
// because the desktop signs the user out on any 4xx from the refresh route.
func TestExtensionTokenLimiterCutsOffAFlood(t *testing.T) {
	app := fiber.New()
	app.Post("/extension/token/refresh", ExtensionTokenLimiter(nil), func(c *fiber.Ctx) error {
		return c.SendStatus(200)
	})
	post := func() int {
		resp, err := app.Test(httptest.NewRequest("POST", "/extension/token/refresh", nil))
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		return resp.StatusCode
	}
	for i := 0; i < ExtensionTokenMaxPerMinute; i++ {
		if got := post(); got != 200 {
			t.Fatalf("request %d: status %d, want 200", i+1, got)
		}
	}
	if got := post(); got != 503 {
		t.Fatalf("over the budget: status %d, want 503 (never a 4xx: the desktop treats those as a rejected refresh token)", got)
	}
}
