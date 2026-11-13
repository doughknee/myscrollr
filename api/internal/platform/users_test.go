package platform

import (
	"net/http/httptest"
	"testing"

	"github.com/gofiber/fiber/v2"
)

// SCROLLR-459 / UW-7: no name resolves to a profile, real or invented, and the
// answer is the same for all of them.
func TestProfileByUsernameIsNotFoundForEveryName(t *testing.T) {
	app := fiber.New()
	app.Get("/users/:username", GetProfileByUsername)
	for _, name := range []string{"zzz_does_not_exist_12345", "me", "admin"} {
		resp, err := app.Test(httptest.NewRequest("GET", "/users/"+name, nil))
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != 404 {
			t.Fatalf("/users/%s: status %d, want 404", name, resp.StatusCode)
		}
	}
}
