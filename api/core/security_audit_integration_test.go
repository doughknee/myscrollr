package core

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/brandon-relentnet/myscrollr/api/internal/testsupport"
	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestSecurityAuditDurabilityPrivacyAndPurgeBoundary(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	ctx := context.Background()
	t.Setenv("SENTRY_USER_SALT", "fixture-393")
	testsupport.MustExec(t, `DELETE FROM security_request_audit`)
	app := fiber.New()
	app.Use(platform.RecordSecurityRequest)
	app.Get("/admin/cases/:id", func(c *fiber.Ctx) error { c.Locals("user_id", "audit-fixture"); return c.SendStatus(200) })
	req := httptest.NewRequest("GET", "/admin/cases/PRIVATE_CASE?token=PRIVATE_TOKEN", nil)
	req.Header.Set("Authorization", "Bearer PRIVATE_CREDENTIAL")
	req.Header.Set("User-Agent", "PRIVATE_AGENT")
	res, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	// A new connection reads the evidence; no pod-local buffer is involved.
	pool, err := pgxpool.New(ctx, platform.DBPool.Config().ConnString())
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	var raw []byte
	if err := pool.QueryRow(ctx, `SELECT row_to_json(a) FROM security_request_audit a WHERE actor=$1`, platform.HashUserSub("audit-fixture")).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	for _, private := range []string{"PRIVATE_", "audit-fixture", "Authorization", "192.0.2."} {
		if strings.Contains(string(raw), private) {
			t.Fatalf("private data persisted: %s", private)
		}
	}
	var row map[string]any
	if err := json.Unmarshal(raw, &row); err != nil {
		t.Fatal(err)
	}
	if row["endpoint"] != "/admin/cases/:id" {
		t.Fatal("route not normalized")
	}
	testsupport.MustExec(t, `INSERT INTO user_deletion_requests(logto_sub,purge_at,status) VALUES('audit-fixture',now(),'purged') ON CONFLICT(logto_sub) DO UPDATE SET status='purged'`)
	defer testsupport.MustExec(t, `DELETE FROM user_deletion_requests WHERE logto_sub='audit-fixture'`)
	testsupport.MustExec(t, `DELETE FROM security_request_audit WHERE actor=$1`, platform.HashUserSub("audit-fixture"))
	res, err = app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	var count int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM security_request_audit WHERE actor=$1`, platform.HashUserSub("audit-fixture")).Scan(&count); err != nil || count != 0 {
		t.Fatalf("late audit write after purge: %d %v", count, err)
	}
	// Saturate the audit lock while a public feed stays independent of audit storage.
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(39320261026)`); err != nil {
		t.Fatal(err)
	}
	app.Get("/public/feed", func(c *fiber.Ctx) error { return c.SendStatus(200) })
	done := make(chan struct{})
	go func() {
		defer close(done)
		r, _ := app.Test(httptest.NewRequest("GET", "/bad", nil))
		if r != nil {
			r.Body.Close()
		}
	}()
	start := time.Now()
	res, err = app.Test(httptest.NewRequest("GET", "/public/feed", nil))
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 200 || time.Since(start) > time.Second {
		t.Fatal("audit contention blocks feeds")
	}
	<-done
}
