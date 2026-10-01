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

// SCROLLR-282: Clock and Weather are free. The flag lives on the catalog
// entry; this pins which entries carry it so a stray flag (or a dropped one)
// is a visible, deliberate change.
func TestFreeSlotFlagIsClockAndWeatherOnly(t *testing.T) {
	var got []string
	for _, def := range platform.Catalog() {
		if def.FreeSlot {
			got = append(got, def.ID)
		}
	}
	if strings.Join(got, ",") != "clock,weather" {
		t.Errorf("FreeSlot widgets = %v, want [clock weather]", got)
	}
	if !platform.IsFreeSlotWidgetType("clock") || platform.IsFreeSlotWidgetType("timer") ||
		platform.IsFreeSlotWidgetType("no_such_widget") {
		t.Error("IsFreeSlotWidgetType disagrees with the catalog flag")
	}
}

// A Free user (cap 3) with three data widgets AND a clock and weather
// (legacy rows, or any future route that stores them) is at 3 slots, not 5:
// CountEnabledWidgets ignores the free ones, and the gate still enforces the
// cap on the next data widget — free widgets neither cost a slot nor open a
// loophole.
func TestCountEnabledWidgetsIgnoresFreeSlotWidgets(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}

	user := fmt.Sprintf("test-freeslot-%d", time.Now().UnixNano())
	t.Cleanup(func() {
		_, _ = platform.DBPool.Exec(context.Background(),
			`DELETE FROM user_widgets WHERE logto_sub = $1`, user)
	})

	data := dataWidgetTypes(t, 4)
	testsupport.MustExec(t,
		`INSERT INTO user_widgets (logto_sub, widget_type, enabled)
		 VALUES ($1, $2, true), ($1, $3, true), ($1, $4, true), ($1, 'clock', true), ($1, 'weather', true)`,
		user, data[0], data[1], data[2])

	count, err := CountEnabledWidgets(context.Background(), user)
	if err != nil {
		t.Fatalf("CountEnabledWidgets: %v", err)
	}
	if count != 3 {
		t.Errorf("count = %d, want 3 (clock and weather must not count)", count)
	}

	// local_widgets = 0 is what a current client reports with only clock and
	// weather enabled. The user is full on data widgets, so a fourth is
	// refused — and it is refused because of the three, not the two.
	app := fiber.New()
	app.Post("/users/me/widgets", func(c *fiber.Ctx) error {
		c.Locals("user_id", user)
		return CreateWidget(c)
	})
	req := httptest.NewRequest(http.MethodPost, "/users/me/widgets",
		strings.NewReader(fmt.Sprintf(`{"widget_type":%q,"local_widgets":0}`, data[3])))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("app.Test: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Errorf("status = %d, want 403 (3 data widgets fill a Free plan)", resp.StatusCode)
	}

	// With only two data widgets plus clock and weather, the third still fits.
	testsupport.MustExec(t,
		`DELETE FROM user_widgets WHERE logto_sub = $1 AND widget_type = $2`, user, data[2])
	req = httptest.NewRequest(http.MethodPost, "/users/me/widgets",
		strings.NewReader(fmt.Sprintf(`{"widget_type":%q,"local_widgets":0}`, data[3])))
	req.Header.Set("Content-Type", "application/json")
	resp2, err := app.Test(req)
	if err != nil {
		t.Fatalf("app.Test: %v", err)
	}
	defer resp2.Body.Close()
	if resp2.StatusCode != http.StatusCreated {
		t.Errorf("status = %d, want 201 (clock and weather must not hold slots)", resp2.StatusCode)
	}
}

// dataWidgetTypes returns n distinct catalog ids that hold a server-side row.
func dataWidgetTypes(t *testing.T, n int) []string {
	t.Helper()
	var out []string
	for _, def := range platform.Catalog() {
		if platform.IsUtilityWidgetType(def.ID) {
			continue
		}
		out = append(out, def.ID)
		if len(out) == n {
			return out
		}
	}
	t.Fatalf("fewer than %d data widgets in the catalog", n)
	return nil
}
