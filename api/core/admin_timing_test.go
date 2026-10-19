package core

import (
	"bytes"
	"log"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"
)

func TestAdminTiming(t *testing.T) {
	var buf bytes.Buffer
	log.SetOutput(&buf)
	defer log.SetOutput(os.Stderr)

	app := fiber.New()
	app.Use("/admin", adminTiming(20*time.Millisecond))
	app.Get("/admin/fast", func(c *fiber.Ctx) error { return c.SendString("ok") })
	app.Get("/admin/slow/:id", func(c *fiber.Ctx) error {
		time.Sleep(40 * time.Millisecond)
		return c.SendString("ok")
	})
	app.Get("/admin/boom", func(c *fiber.Ctx) error { return c.SendStatus(503) })
	app.Get("/other", func(c *fiber.Ctx) error { return c.SendString("ok") })

	get := func(p string) {
		if _, err := app.Test(httptest.NewRequest("GET", p, nil), -1); err != nil {
			t.Fatal(err)
		}
	}

	get("/admin/fast")
	get("/other")
	if buf.Len() != 0 {
		t.Fatalf("fast/non-admin logged: %q", buf.String())
	}

	get("/admin/slow/secret-user?token=abc")
	out := buf.String()
	if !strings.Contains(out, "[Admin] GET /admin/slow/:id 200 ") || strings.Contains(out, "secret") || strings.Contains(out, "token") {
		t.Fatalf("slow line wrong: %q", out)
	}

	buf.Reset()
	get("/admin/boom")
	if !strings.Contains(buf.String(), "[Admin] GET /admin/boom 503 ") {
		t.Fatalf("5xx not logged: %q", buf.String())
	}
}
