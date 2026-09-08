package widgets

import (
	"bytes"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v2"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
)

// REL-238: a desktop stuck on an expired token failed every widget write
// with a per-action toast, and both core-api replicas logged NOTHING —
// the early returns here all returned silently. These tests pin the log
// lines in place, because a silent rejection is what made the original
// bug take hours to narrow.
//
// Only the returns reachable without a database are exercised: unknown
// widget type, body-parse failure and the unauthenticated guard. The
// `no rows` 404 needs a DB round trip and lives with the integration
// tests; its log line is one `log.Printf` on the same pattern.

// logApp mounts the handlers behind a stand-in for LogtoAuth that seeds
// user_id from a header, the same shape requestsApp() uses.
func logApp() *fiber.App {
	app := fiber.New()
	seed := func(c *fiber.Ctx) error {
		if u := c.Get("X-Test-User"); u != "" {
			c.Locals("user_id", u)
		}
		return c.Next()
	}
	app.Post("/users/me/widgets", seed, CreateWidget)
	app.Put("/users/me/widgets/:type", seed, UpdateWidget)
	app.Delete("/users/me/widgets/:type", seed, DeleteWidget)
	return app
}

// captureLog swaps the standard logger's sink for the duration of fn and
// returns everything written to it.
func captureLog(t *testing.T, fn func()) string {
	t.Helper()
	var buf bytes.Buffer
	prevOut, prevFlags := log.Writer(), log.Flags()
	log.SetOutput(&buf)
	log.SetFlags(0)
	defer func() {
		log.SetOutput(prevOut)
		log.SetFlags(prevFlags)
	}()
	fn()
	return buf.String()
}

func doRequest(t *testing.T, app *fiber.App, method, path, user, body string) int {
	t.Helper()
	var rdr *strings.Reader
	if body != "" {
		rdr = strings.NewReader(body)
	} else {
		rdr = strings.NewReader("")
	}
	req := httptest.NewRequest(method, path, rdr)
	req.Header.Set("Content-Type", "application/json")
	if user != "" {
		req.Header.Set("X-Test-User", user)
	}
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("app.Test: %v", err)
	}
	defer resp.Body.Close()
	return resp.StatusCode
}

// wantLog asserts the captured output contains every fragment. Fragments
// rather than a whole line so the wording can be tuned without breaking
// the test — what matters is that userID and widgetType are in there.
func wantLog(t *testing.T, out string, fragments ...string) {
	t.Helper()
	for _, f := range fragments {
		if !strings.Contains(out, f) {
			t.Errorf("log output missing %q\ngot: %s", f, out)
		}
	}
}

func TestUpdateWidgetLogsUnknownType(t *testing.T) {
	const user = "logto|rel238"
	unknown := "definitely_not_a_widget"
	if platform.IsKnownWidgetType(unknown) {
		t.Fatalf("%q is unexpectedly a known widget type", unknown)
	}

	var status int
	out := captureLog(t, func() {
		status = doRequest(t, logApp(), http.MethodPut,
			"/users/me/widgets/"+unknown, user, `{"ticker_enabled":false}`)
	})

	if status != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", status)
	}
	wantLog(t, out, "[Widgets]", user, unknown)
}

func TestUpdateWidgetLogsBodyParseFailure(t *testing.T) {
	const user = "logto|rel238"
	// A known type so we reach the body parser, with a body that is not JSON.
	widget := firstKnownWidgetType(t)

	var status int
	out := captureLog(t, func() {
		status = doRequest(t, logApp(), http.MethodPut,
			"/users/me/widgets/"+widget, user, `{"ticker_enabled":`)
	})

	if status != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", status)
	}
	wantLog(t, out, "[Widgets]", user, widget)
}

func TestCreateWidgetLogsUnknownType(t *testing.T) {
	const user = "logto|rel238"
	unknown := "definitely_not_a_widget"

	var status int
	out := captureLog(t, func() {
		status = doRequest(t, logApp(), http.MethodPost,
			"/users/me/widgets", user, `{"widget_type":"`+unknown+`"}`)
	})

	if status != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", status)
	}
	wantLog(t, out, "[Widgets]", user, unknown)
}

func TestCreateWidgetLogsBodyParseFailure(t *testing.T) {
	const user = "logto|rel238"

	var status int
	out := captureLog(t, func() {
		status = doRequest(t, logApp(), http.MethodPost,
			"/users/me/widgets", user, `{"widget_type":`)
	})

	if status != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", status)
	}
	wantLog(t, out, "[Widgets]", user)
}

// The 401 guards are the ones REL-238 actually tripped, so they log too.
func TestWidgetWritesLogUnauthenticated(t *testing.T) {
	widget := firstKnownWidgetType(t)
	cases := []struct{ name, method, path string }{
		{"create", http.MethodPost, "/users/me/widgets"},
		{"update", http.MethodPut, "/users/me/widgets/" + widget},
		{"delete", http.MethodDelete, "/users/me/widgets/" + widget},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var status int
			out := captureLog(t, func() {
				status = doRequest(t, logApp(), tc.method, tc.path, "", `{}`)
			})
			if status != http.StatusUnauthorized {
				t.Errorf("status = %d, want 401", status)
			}
			wantLog(t, out, "[Widgets]", "no user on request")
		})
	}
}

// firstKnownWidgetType returns any non-utility catalog id, so the tests
// don't hard-code a widget that may be renamed out of the catalog.
func firstKnownWidgetType(t *testing.T) string {
	t.Helper()
	for _, def := range platform.Catalog() {
		if !platform.IsUtilityWidgetType(def.ID) {
			return def.ID
		}
	}
	t.Fatal("no non-utility widget in the catalog")
	return ""
}
