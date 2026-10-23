package admin

import (
	"context"
	"fmt"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/brandon-relentnet/myscrollr/api/internal/testsupport"
	"github.com/gofiber/fiber/v2"
)

func TestConcurrentCrossRevocationPreservesAnAuthorizedAdmin(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	for attempt := 0; attempt < 10; attempt++ {
		resetAdmins(t)
		testsupport.MustExec(t, `INSERT INTO admin_users (email,logto_sub) VALUES ('a@example.test','a'),('b@example.test','b')`)
		ids := []int64{adminID(t, "b@example.test"), adminID(t, "a@example.test")}
		var reached sync.WaitGroup
		reached.Add(2)
		app := fiber.New()
		app.Delete("/admins/:id", func(c *fiber.Ctx) error { c.Locals("user_id", c.Get("Actor")); return c.Next() }, RequireAdmin,
			func(c *fiber.Ctx) error { reached.Done(); reached.Wait(); return c.Next() }, HandleRemoveAdmin)
		results := make(chan int, 2)
		for i, sub := range []string{"a", "b"} {
			go func(id int64, actor string) {
				req := httptest.NewRequest("DELETE", fmt.Sprintf("/admins/%d", id), nil)
				req.Header.Set("Actor", actor)
				resp, err := app.Test(req, 10000)
				if err != nil {
					results <- 0
					return
				}
				defer resp.Body.Close()
				results <- resp.StatusCode
			}(ids[i], sub)
		}
		first, second := <-results, <-results
		if !((first == 200 && second == 403) || (first == 403 && second == 200)) {
			t.Fatalf("cross-removal statuses: %d, %d", first, second)
		}
		var count int
		if err := platform.DBPool.QueryRow(context.Background(), `SELECT count(*) FROM admin_users WHERE logto_sub IN ('a','b')`).Scan(&count); err != nil {
			t.Fatal(err)
		}
		if count != 1 {
			t.Fatalf("remaining authorized admins: %d", count)
		}
	}
}

func TestAlreadyAuthorizedButRevokedActorCannotGrantOrRevoke(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	resetAdmins(t)
	testsupport.MustExec(t, `INSERT INTO admin_users (email,logto_sub) VALUES ('a@example.test','a'),('b@example.test','b')`)
	app := fiber.New()
	app.Use(func(c *fiber.Ctx) error {
		c.Locals("user_id", "revoked")
		c.Locals(adminEmailLocal, "revoked@example.test")
		return c.Next()
	})
	app.Post("/admins", HandleAddAdmin)
	app.Delete("/admins/:id", HandleRemoveAdmin)
	for _, method := range []string{"POST", "DELETE"} {
		path := "/admins"
		if method == "DELETE" {
			path += fmt.Sprintf("/%d", adminID(t, "a@example.test"))
		}
		req := httptest.NewRequest(method, path, strings.NewReader(`{"email":"intruder@example.test"}`))
		req.Header.Set("Content-Type", "application/json")
		resp, err := app.Test(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != 403 {
			t.Fatalf("revoked %s returned %d", method, resp.StatusCode)
		}
	}
}
