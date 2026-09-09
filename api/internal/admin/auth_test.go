package admin

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/brandon-relentnet/myscrollr/api/internal/testsupport"
	"github.com/gofiber/fiber/v2"
)

// stubAuth stands in for platform.LogtoAuth: it puts on the context exactly
// what a validated token would, without minting one. That is what lets these
// tests hand RequireAdmin a token bearing the super_user role.
func stubAuth(sub string, roles ...string) fiber.Handler {
	return func(c *fiber.Ctx) error {
		c.Locals("user_id", sub)
		c.Locals("user_roles", roles)
		return c.Next()
	}
}

// adminApp wires the real middleware in front of a sentinel handler. The
// sentinel is the assertion: if it runs, the request got through.
func adminApp(auth fiber.Handler, reached *bool) *fiber.App {
	app := fiber.New()
	if auth != nil {
		app.Use(auth)
	}
	app.Get("/admin/ping", RequireAdmin, func(c *fiber.Ctx) error {
		*reached = true
		return c.JSON(fiber.Map{"admin": ActingAdmin(c)})
	})
	return app
}

// withVerifiedEmail swaps the Logto lookup for a fixed answer.
func withVerifiedEmail(t *testing.T, sub, email string) {
	t.Helper()
	prev := lookupVerifiedEmail
	lookupVerifiedEmail = func(s string) (string, error) {
		if s == sub {
			return email, nil
		}
		return "", nil
	}
	t.Cleanup(func() { lookupVerifiedEmail = prev })
}

func resetAdmins(t *testing.T, seed ...string) {
	t.Helper()
	testsupport.MustExec(t, `DELETE FROM admin_users`)
	for _, email := range seed {
		testsupport.MustExec(t,
			`INSERT INTO admin_users (email, added_by) VALUES ($1, 'test')`, email)
	}
}

func do(t *testing.T, app *fiber.App, method, path string, body string) (int, string) {
	t.Helper()
	var req *http.Request
	if body == "" {
		req = httptest.NewRequest(method, path, nil)
	} else {
		req = httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("app.Test: %v", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, string(raw)
}

// TestRequireAdminRejectsSuperUserNotOnTheList is the reason REL-260 exists.
//
// `super_user` is a PRODUCT tier - an invite-only early-access programme that
// grants Ultimate caps for free - and other people already hold it. If admin
// were ever derived from it, every one of those users would get the support
// console and with it every user's email and ticket history. This test fails
// the moment anyone reintroduces that shortcut.
func TestRequireAdminRejectsSuperUserNotOnTheList(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	resetAdmins(t, "bch713@pm.me")
	withVerifiedEmail(t, "sub-superuser", "someone-else@example.com")

	var reached bool
	app := adminApp(stubAuth("sub-superuser", "super_user", "uplink_ultimate"), &reached)

	status, body := do(t, app, "GET", "/admin/ping", "")
	if status != fiber.StatusForbidden {
		t.Fatalf("super_user not on the admin list: got %d, want 403 (body: %s)", status, body)
	}
	if reached {
		t.Fatal("a super_user token that is not on the admin list reached an admin handler")
	}
}

// A super_user who IS on the list gets in - but because of the list, not the
// role. The role is incidental; the row is what grants access.
func TestRequireAdminAllowsSeededEmail(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	resetAdmins(t, "bch713@pm.me")
	withVerifiedEmail(t, "sub-brandon", "bch713@pm.me")

	var reached bool
	app := adminApp(stubAuth("sub-brandon"), &reached)

	status, body := do(t, app, "GET", "/admin/ping", "")
	if status != fiber.StatusOK {
		t.Fatalf("seeded admin: got %d, want 200 (body: %s)", status, body)
	}
	if !reached {
		t.Fatal("seeded admin did not reach the handler")
	}

	// The sub must now be pinned, so the next request needs no Logto call.
	var pinned string
	if err := platform.DBPool.QueryRow(context.Background(),
		`SELECT coalesce(logto_sub, '') FROM admin_users WHERE lower(email) = 'bch713@pm.me'`).
		Scan(&pinned); err != nil {
		t.Fatalf("read pinned sub: %v", err)
	}
	if pinned != "sub-brandon" {
		t.Errorf("logto_sub not pinned on first match: got %q", pinned)
	}
}

// Matching on email forever would mean a stranger who later registers a
// released address inherits staff access. Once a row is pinned, it is pinned.
func TestRequireAdminRejectsSecondClaimOnAPinnedRow(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	resetAdmins(t)
	testsupport.MustExec(t,
		`INSERT INTO admin_users (email, logto_sub, added_by) VALUES ($1, $2, 'test')`,
		"bch713@pm.me", "sub-original")
	withVerifiedEmail(t, "sub-impostor", "bch713@pm.me")

	var reached bool
	app := adminApp(stubAuth("sub-impostor"), &reached)

	status, _ := do(t, app, "GET", "/admin/ping", "")
	if status != fiber.StatusForbidden {
		t.Fatalf("second claim on a pinned row: got %d, want 403", status)
	}
	if reached {
		t.Fatal("a second account with the same address took over a pinned admin row")
	}
}

// Email match is case-insensitive: the unique index is on lower(email), and
// the lookup must agree with it or an admin added as "Bch713@PM.me" would
// never be able to sign in.
func TestRequireAdminMatchesEmailCaseInsensitively(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	resetAdmins(t, "BCH713@PM.ME")
	withVerifiedEmail(t, "sub-brandon", "bch713@pm.me")

	var reached bool
	app := adminApp(stubAuth("sub-brandon"), &reached)

	if status, _ := do(t, app, "GET", "/admin/ping", ""); status != fiber.StatusOK {
		t.Fatalf("case-insensitive email match: got %d, want 200", status)
	}
	if !reached {
		t.Fatal("case difference blocked a real admin")
	}
}

func TestRequireAdminRejectsUnauthenticated(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	resetAdmins(t, "bch713@pm.me")

	var reached bool
	// No auth middleware at all: nothing ever sets user_id.
	app := adminApp(nil, &reached)

	status, _ := do(t, app, "GET", "/admin/ping", "")
	if status != fiber.StatusUnauthorized {
		t.Fatalf("unauthenticated: got %d, want 401", status)
	}
	if reached {
		t.Fatal("an unauthenticated request reached an admin handler")
	}
}

// A Logto outage must not become an open door.
func TestRequireAdminFailsClosedWhenLookupErrors(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	resetAdmins(t, "bch713@pm.me")

	prev := lookupVerifiedEmail
	lookupVerifiedEmail = func(string) (string, error) {
		return "", errors.New("logto unreachable")
	}
	t.Cleanup(func() { lookupVerifiedEmail = prev })

	var reached bool
	app := adminApp(stubAuth("sub-brandon"), &reached)

	if status, _ := do(t, app, "GET", "/admin/ping", ""); status != fiber.StatusForbidden {
		t.Fatalf("lookup failure: got %d, want 403", status)
	}
	if reached {
		t.Fatal("a failed verified-email lookup let the request through")
	}
}

// --- The two anti-lockout rules ---

// adminCRUDApp mounts the admin management routes behind the real middleware,
// so these tests exercise the same path a real click takes.
func adminCRUDApp(sub string) *fiber.App {
	app := fiber.New()
	app.Use(stubAuth(sub))
	app.Get("/admin/admins", RequireAdmin, HandleListAdmins)
	app.Post("/admin/admins", RequireAdmin, HandleAddAdmin)
	app.Delete("/admin/admins/:id", RequireAdmin, HandleRemoveAdmin)
	return app
}

func adminID(t *testing.T, email string) int64 {
	t.Helper()
	var id int64
	if err := platform.DBPool.QueryRow(context.Background(),
		`SELECT id FROM admin_users WHERE lower(email) = lower($1)`, email).Scan(&id); err != nil {
		t.Fatalf("read admin id for %s: %v", email, err)
	}
	return id
}

func TestRemoveAdminRefusesTheLastAdmin(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	resetAdmins(t, "bch713@pm.me")
	withVerifiedEmail(t, "sub-brandon", "bch713@pm.me")

	app := adminCRUDApp("sub-brandon")
	id := adminID(t, "bch713@pm.me")

	status, body := do(t, app, "DELETE", "/admin/admins/"+strconv.FormatInt(id, 10), "")
	if status != fiber.StatusConflict {
		t.Fatalf("removing the last admin: got %d, want 409 (body: %s)", status, body)
	}

	var n int
	if err := platform.DBPool.QueryRow(context.Background(),
		`SELECT count(*) FROM admin_users`).Scan(&n); err != nil {
		t.Fatalf("count admins: %v", err)
	}
	if n != 1 {
		t.Fatalf("admin list emptied: %d rows remain, want 1", n)
	}
}

func TestRemoveAdminRefusesSelf(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	// Two admins, so the last-admin rule is not what does the refusing here.
	resetAdmins(t, "bch713@pm.me", "second@example.com")
	withVerifiedEmail(t, "sub-brandon", "bch713@pm.me")

	app := adminCRUDApp("sub-brandon")
	id := adminID(t, "bch713@pm.me")

	status, body := do(t, app, "DELETE", "/admin/admins/"+strconv.FormatInt(id, 10), "")
	if status != fiber.StatusConflict {
		t.Fatalf("removing self: got %d, want 409 (body: %s)", status, body)
	}

	var stillThere bool
	if err := platform.DBPool.QueryRow(context.Background(),
		`SELECT EXISTS (SELECT 1 FROM admin_users WHERE id = $1)`, id).Scan(&stillThere); err != nil {
		t.Fatalf("check self row: %v", err)
	}
	if !stillThere {
		t.Fatal("an admin removed their own access")
	}
}

// Adding another admin is what makes this manageable without a deploy: the
// row goes in unpinned, and RequireAdmin claims it on their first sign-in.
func TestAddAdminGrantsAccessWithoutADeploy(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	resetAdmins(t, "bch713@pm.me")
	withVerifiedEmail(t, "sub-brandon", "bch713@pm.me")

	// Before: the second account is refused.
	var reached bool
	second := adminApp(stubAuth("sub-second"), &reached)
	prev := lookupVerifiedEmail
	lookupVerifiedEmail = func(s string) (string, error) {
		switch s {
		case "sub-brandon":
			return "bch713@pm.me", nil
		case "sub-second":
			return "second@example.com", nil
		}
		return "", nil
	}
	t.Cleanup(func() { lookupVerifiedEmail = prev })

	if status, _ := do(t, second, "GET", "/admin/ping", ""); status != fiber.StatusForbidden {
		t.Fatalf("non-admin before the grant: got %d, want 403", status)
	}

	// Brandon adds them from the dashboard.
	app := adminCRUDApp("sub-brandon")
	status, body := do(t, app, "POST", "/admin/admins",
		`{"email":"second@example.com","note":"added in a test"}`)
	if status != fiber.StatusCreated {
		t.Fatalf("add admin: got %d, want 201 (body: %s)", status, body)
	}

	// After: the same account gets in, with no restart and no migration.
	reached = false
	if status, _ := do(t, second, "GET", "/admin/ping", ""); status != fiber.StatusOK {
		t.Fatalf("newly added admin: got %d, want 200", status)
	}
	if !reached {
		t.Fatal("a newly added admin could not reach an admin handler")
	}
}

func TestAddAdminRejectsDuplicateAndGarbage(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	resetAdmins(t, "bch713@pm.me")
	withVerifiedEmail(t, "sub-brandon", "bch713@pm.me")
	app := adminCRUDApp("sub-brandon")

	// Case-insensitive duplicate: the unique index is on lower(email).
	if status, _ := do(t, app, "POST", "/admin/admins", `{"email":"BCH713@pm.me"}`); status != fiber.StatusConflict {
		t.Errorf("duplicate address: got %d, want 409", status)
	}
	if status, _ := do(t, app, "POST", "/admin/admins", `{"email":"not-an-email"}`); status != fiber.StatusBadRequest {
		t.Errorf("malformed address: got %d, want 400", status)
	}
	if status, _ := do(t, app, "POST", "/admin/admins", `{"email":"  "}`); status != fiber.StatusBadRequest {
		t.Errorf("blank address: got %d, want 400", status)
	}
}

// The list marks the caller's own row so the UI can hide a delete button that
// the server would refuse anyway.
func TestListAdminsMarksSelf(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	resetAdmins(t, "bch713@pm.me", "second@example.com")
	withVerifiedEmail(t, "sub-brandon", "bch713@pm.me")

	app := adminCRUDApp("sub-brandon")
	status, body := do(t, app, "GET", "/admin/admins", "")
	if status != fiber.StatusOK {
		t.Fatalf("list admins: got %d, want 200", status)
	}

	var payload struct {
		Admins []AdminRow `json:"admins"`
	}
	if err := json.Unmarshal([]byte(body), &payload); err != nil {
		t.Fatalf("decode admins: %v (body: %s)", err, body)
	}
	if len(payload.Admins) != 2 {
		t.Fatalf("got %d admins, want 2", len(payload.Admins))
	}
	for _, a := range payload.Admins {
		want := strings.EqualFold(a.Email, "bch713@pm.me")
		if a.Self != want {
			t.Errorf("%s: self=%v, want %v", a.Email, a.Self, want)
		}
	}
}
