package platform

import (
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"
)

func TestSecuritySourceIsPrivateAndDayBounded(t *testing.T) {
	t.Setenv("SENTRY_USER_SALT", "fixture")
	day := time.Date(2026, 10, 26, 0, 0, 0, 0, time.UTC)
	a := securitySource("192.0.2.10", day)
	if len(a) != 32 || a != securitySource("192.0.2.10", day.Add(time.Hour)) || a == securitySource("192.0.2.10", day.AddDate(0, 0, 1)) || strings.Contains(a, "192.0") {
		t.Fatal("source correlation boundary failed")
	}
	t.Setenv("SENTRY_USER_SALT", "")
	if securitySource("192.0.2.10", day) != "" {
		t.Fatal("unsalted correlation")
	}
}

func TestAuditFailureAndFullSlotsDoNotBlockNormalRoutes(t *testing.T) {
	old := DBPool
	DBPool = nil
	defer func() { DBPool = old }()
	auditSlots <- struct{}{}
	auditSlots <- struct{}{}
	defer func() { <-auditSlots; <-auditSlots }()
	app := fiber.New()
	app.Use(RecordSecurityRequest)
	app.Post("/support/ticket/public", func(c *fiber.Ctx) error { return c.SendStatus(202) })
	app.Get("/public/feed", func(c *fiber.Ctx) error { return c.SendString("feed") })
	for _, route := range []struct {
		method, path string
		status       int
	}{{"POST", "/support/ticket/public", 202}, {"GET", "/public/feed", 200}, {"GET", "/unknown?secret=never-save", 404}} {
		started := time.Now()
		res, err := app.Test(httptest.NewRequest(route.method, route.path, nil), 1000)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != route.status || time.Since(started) > 500*time.Millisecond {
			t.Fatal("audit changed availability")
		}
	}
}
