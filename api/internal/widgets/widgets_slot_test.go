package widgets

import (
	"context"
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

// SCROLLR-245: a row whose widget_type was retired from the catalog
// (fantasy_yahoo/predictions after SCROLLR-239) must never hold a slot
// hostage. CountEnabledWidgets must skip it, and the slot gate on
// CreateWidget must let a Free user with one such row and two real widgets
// add a third.
func TestCountEnabledWidgetsSkipsRetiredType(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	if platform.IsKnownWidgetType("predictions") {
		t.Fatal(`"predictions" is unexpectedly a known widget type — SCROLLR-245 fixture is stale`)
	}

	user := fmt.Sprintf("test-slot-%d", time.Now().UnixNano())
	t.Cleanup(func() {
		_, _ = platform.DBPool.Exec(context.Background(),
			`DELETE FROM user_widgets WHERE logto_sub = $1`, user)
	})

	known := twoKnownNonUtilityWidgetTypes(t)
	testsupport.MustExec(t,
		`INSERT INTO user_widgets (logto_sub, widget_type, enabled) VALUES ($1, $2, true), ($1, $3, true), ($1, 'predictions', true)`,
		user, known[0], known[1])

	count, err := CountEnabledWidgets(context.Background(), user)
	if err != nil {
		t.Fatalf("CountEnabledWidgets: %v", err)
	}
	if count != 2 {
		t.Errorf("count = %d, want 2 (the retired predictions row must not count)", count)
	}

	// A Free user (no roles = "free", MaxWidgets=3) sitting at "used"=2 by
	// the server's own count must be allowed to add a third known widget —
	// the client already shows 2 in use, and the server must agree.
	third := thirdKnownNonUtilityWidgetType(t, known)
	app := fiber.New()
	app.Post("/users/me/widgets", func(c *fiber.Ctx) error {
		c.Locals("user_id", user)
		return CreateWidget(c)
	})
	t.Cleanup(func() {
		_, _ = platform.DBPool.Exec(context.Background(),
			`DELETE FROM user_widgets WHERE logto_sub = $1 AND widget_type = $2`, user, third)
	})

	req := httptest.NewRequest(http.MethodPost, "/users/me/widgets",
		strings.NewReader(fmt.Sprintf(`{"widget_type":%q}`, third)))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("app.Test: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Errorf("status = %d, want 201 (slot gate must not count the retired row)", resp.StatusCode)
	}
}

// twoKnownNonUtilityWidgetTypes returns two distinct catalog ids that hold a
// server-side row (utilities live in desktop preferences, not user_widgets).
func twoKnownNonUtilityWidgetTypes(t *testing.T) [2]string {
	t.Helper()
	var out [2]string
	i := 0
	for _, def := range platform.Catalog() {
		if platform.IsUtilityWidgetType(def.ID) {
			continue
		}
		out[i] = def.ID
		i++
		if i == 2 {
			return out
		}
	}
	t.Fatal("fewer than 2 non-utility widgets in the catalog")
	return out
}

// thirdKnownNonUtilityWidgetType returns a catalog id distinct from the two
// already used, so the create request in the test targets a genuinely new
// widget rather than colliding with an existing row.
func thirdKnownNonUtilityWidgetType(t *testing.T, used [2]string) string {
	t.Helper()
	for _, def := range platform.Catalog() {
		if platform.IsUtilityWidgetType(def.ID) {
			continue
		}
		if def.ID == used[0] || def.ID == used[1] {
			continue
		}
		return def.ID
	}
	t.Fatal("fewer than 3 non-utility widgets in the catalog")
	return ""
}
