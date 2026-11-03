package core

import (
	"io"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v2"
)

func TestReleaseWebhookIgnoresNonStableTags(t *testing.T) {
	t.Setenv("GITHUB_PR_WEBHOOK_SECRET", "fixture-secret")
	app := fiber.New()
	app.Post("/release", HandleGitHubReleasePublished)
	for _, tag := range []string{"desktop-v1.8.0-beta.1", "server-2026.11.03.1", "desktop-vbanana"} {
		req := httptest.NewRequest("POST", "/release", strings.NewReader(`{"version":"`+tag+`"}`))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-GitHub-Webhook-Secret", "fixture-secret")
		res, err := app.Test(req)
		if err != nil {
			t.Fatal(err)
		}
		if res.StatusCode != 200 {
			t.Fatalf("status %d", res.StatusCode)
		}
		buf := new(strings.Builder)
		_, _ = io.Copy(buf, res.Body)
		res.Body.Close()
		if !strings.Contains(buf.String(), `"ignored"`) {
			t.Fatalf("non-stable accepted: %s", buf.String())
		}
	}
}
