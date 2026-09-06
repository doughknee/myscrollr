package widgets

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/brandon-relentnet/myscrollr/api/internal/testsupport"
)

// requestsApp mounts the handler behind a stand-in for LogtoAuth that
// seeds user_id from a header, so a test can speak as any user without a
// real JWT. An absent header is an unauthenticated request.
func requestsApp() *fiber.App {
	app := fiber.New()
	app.Post("/catalog/requests", func(c *fiber.Ctx) error {
		if u := c.Get("X-Test-User"); u != "" {
			c.Locals("user_id", u)
		}
		return HandleCatalogRequest(c)
	})
	return app
}

func postRequest(t *testing.T, app *fiber.App, user, body string) (int, CatalogRequestResponse) {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/catalog/requests", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if user != "" {
		req.Header.Set("X-Test-User", user)
	}
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("app.Test: %v", err)
	}
	defer resp.Body.Close()
	var out CatalogRequestResponse
	if resp.StatusCode == http.StatusOK {
		if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
			t.Fatalf("decode: %v", err)
		}
	}
	return resp.StatusCode, out
}

func TestCatalogRequestRejectsUnauthenticated(t *testing.T) {
	status, _ := postRequest(t, requestsApp(), "", `{"query":"bundesliga"}`)
	if status != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", status)
	}
}

// Validation runs before the database is touched, so these hold in unit
// mode too.
func TestCatalogRequestRejectsEmptyQuery(t *testing.T) {
	app := requestsApp()
	for _, body := range []string{`{}`, `{"query":""}`, `{"query":"   "}`, `not json`,
		fmt.Sprintf(`{"query":%q}`, strings.Repeat("x", maxCatalogRequestQuery+1))} {
		if status, _ := postRequest(t, app, "user-a", body); status != http.StatusBadRequest {
			t.Errorf("body %.30q: status = %d, want 400", body, status)
		}
	}
}

// One user counts once however they spell or repeat it; a second user
// makes it two. This is what the miss card shows back.
func TestCatalogRequestCountsUsersNotClicks(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	stamp := time.Now().UnixNano()
	userA := fmt.Sprintf("test-catreq-a-%d", stamp)
	userB := fmt.Sprintf("test-catreq-b-%d", stamp)
	query := fmt.Sprintf("bundesliga %d", stamp)
	t.Cleanup(func() {
		_, _ = platform.DBPool.Exec(context.Background(),
			`DELETE FROM catalog_requests WHERE query = $1`, query)
	})

	app := requestsApp()
	steps := []struct {
		user, body string
		want       int
	}{
		{userA, fmt.Sprintf(`{"query":"  %s "}`, strings.ToUpper(query)), 1},
		{userA, fmt.Sprintf(`{"query":"%s"}`, query), 1},
		{userA, fmt.Sprintf(`{"query":"Bundesliga   %d"}`, stamp), 1},
		{userB, fmt.Sprintf(`{"query":"%s"}`, query), 2},
		{userA, fmt.Sprintf(`{"query":"%s"}`, query), 2},
	}
	for i, s := range steps {
		status, out := postRequest(t, app, s.user, s.body)
		if status != http.StatusOK {
			t.Fatalf("step %d: status = %d, want 200", i, status)
		}
		if out.Query != query {
			t.Errorf("step %d: stored query %q, want normalised %q", i, out.Query, query)
		}
		if out.Count != s.want {
			t.Errorf("step %d (%s): count = %d, want %d", i, s.user, out.Count, s.want)
		}
	}
}
