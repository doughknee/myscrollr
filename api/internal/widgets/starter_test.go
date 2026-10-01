package widgets

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/brandon-relentnet/myscrollr/api/internal/testsupport"
)

// SCROLLR-283: a new account's first bar is NPR + Stocks, applied by one
// server call that flips default_widgets_applied in the same transaction.

func starterUser(t *testing.T) string {
	t.Helper()
	user := fmt.Sprintf("test-starter-%d", time.Now().UnixNano())
	t.Cleanup(func() {
		_, _ = platform.DBPool.Exec(context.Background(), `DELETE FROM user_widgets WHERE logto_sub = $1`, user)
		_, _ = platform.DBPool.Exec(context.Background(), `DELETE FROM user_preferences WHERE logto_sub = $1`, user)
	})
	return user
}

type starterResp struct {
	Applied bool              `json:"applied"`
	Widgets []platform.Widget `json:"widgets"`
}

func callStarter(t *testing.T, user string) starterResp {
	t.Helper()
	app := fiber.New()
	app.Post("/users/me/widgets/starter", func(c *fiber.Ctx) error {
		c.Locals("user_id", user)
		return ApplyStarterWidgets(c)
	})
	resp, err := app.Test(httptest.NewRequest(http.MethodPost, "/users/me/widgets/starter", nil))
	if err != nil {
		t.Fatalf("app.Test: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	var out starterResp
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	return out
}

func widgetTypes(t *testing.T, user string) string {
	t.Helper()
	rows, err := platform.DBPool.Query(context.Background(),
		`SELECT widget_type FROM user_widgets WHERE logto_sub = $1`, user)
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	defer rows.Close()
	var got []string
	for rows.Next() {
		var s string
		_ = rows.Scan(&s)
		got = append(got, s)
	}
	sort.Strings(got)
	return strings.Join(got, ",")
}

// flagState returns "none" when the account has no preferences row.
func flagState(t *testing.T, user string) string {
	t.Helper()
	var v bool
	err := platform.DBPool.QueryRow(context.Background(),
		`SELECT default_widgets_applied FROM user_preferences WHERE logto_sub = $1`, user).Scan(&v)
	if err != nil {
		return "none"
	}
	return fmt.Sprint(v)
}

func TestStarterFreshAccountGetsNPRAndStocks(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	user := starterUser(t)

	out := callStarter(t, user)
	if !out.Applied || len(out.Widgets) != 2 {
		t.Fatalf("response = %+v, want applied with 2 widgets", out)
	}
	if got := widgetTypes(t, user); got != "finance_stocks,news_npr" {
		t.Errorf("widgets = %s, want finance_stocks,news_npr", got)
	}
	if got := flagState(t, user); got != "true" {
		t.Errorf("flag = %s, want true", got)
	}
	// Stocks carries the starter watchlist, not an empty config.
	for _, w := range out.Widgets {
		if len(w.Config) == 0 {
			t.Errorf("%s created with an empty config", w.WidgetType)
		}
	}
	// A repeat call is a no-op: never a second set, never an error.
	if again := callStarter(t, user); again.Applied || len(again.Widgets) != 0 {
		t.Errorf("repeat call = %+v, want applied=false", again)
	}
	if got := widgetTypes(t, user); got != "finance_stocks,news_npr" {
		t.Errorf("after repeat widgets = %s", got)
	}
}

func TestStarterSkipsAccountThatAlreadyHasAWidget(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	user := starterUser(t)
	testsupport.MustExec(t, `INSERT INTO user_widgets (logto_sub, widget_type) VALUES ($1, 'finance_crypto')`, user)

	if out := callStarter(t, user); out.Applied {
		t.Fatalf("applied to an account with a widget: %+v", out)
	}
	if got := widgetTypes(t, user); got != "finance_crypto" {
		t.Errorf("widgets = %s, want only finance_crypto", got)
	}
	// The account is spent: removing its widget must not bring the starter back.
	testsupport.MustExec(t, `DELETE FROM user_widgets WHERE logto_sub = $1`, user)
	if out := callStarter(t, user); out.Applied {
		t.Errorf("starter re-applied after the account's own widget was removed")
	}
}

func TestStarterNeverReappliesAfterRemoval(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	user := starterUser(t)
	if out := callStarter(t, user); !out.Applied {
		t.Fatal("first call did not apply")
	}
	testsupport.MustExec(t, `DELETE FROM user_widgets WHERE logto_sub = $1`, user)
	if out := callStarter(t, user); out.Applied {
		t.Error("starter came back after the user removed everything")
	}
	if got := widgetTypes(t, user); got != "" {
		t.Errorf("widgets = %q, want none", got)
	}
}

// The flag a 1.6.10 client writes (PUT preferences, then POST one widget) also
// counts as "offered": the new endpoint must leave such an account alone.
func TestStarterRespectsFlagSetByOldClient(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	user := starterUser(t)
	testsupport.MustExec(t, `INSERT INTO user_preferences (logto_sub, default_widgets_applied) VALUES ($1, true)`, user)
	if out := callStarter(t, user); out.Applied {
		t.Errorf("applied despite default_widgets_applied = true: %+v", out)
	}
	if got := widgetTypes(t, user); got != "" {
		t.Errorf("widgets = %q, want none", got)
	}
}

// Partial failure leaves no half state: if the second insert fails, the first
// insert and the flag flip are rolled back with it, so the account is still
// fresh and a retry can succeed.
func TestStarterPartialFailureLeavesNoHalfState(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	user := starterUser(t)

	// The duplicate type violates the (logto_sub, widget_type) unique key on
	// the second insert, after the first one and the flag claim succeeded.
	if _, err := applyStarter(context.Background(), user, []string{"news_npr", "news_npr"}); err == nil {
		t.Fatal("expected the duplicate insert to fail")
	}
	if got := widgetTypes(t, user); got != "" {
		t.Errorf("widgets = %q after a failed set, want none", got)
	}
	if got := flagState(t, user); got != "none" && got != "false" {
		t.Errorf("flag = %s after a failed set, want unset", got)
	}
	// And the retry works.
	if out := callStarter(t, user); !out.Applied || len(out.Widgets) != 2 {
		t.Errorf("retry after failure = %+v, want applied with 2 widgets", out)
	}
}

// Two windows or two devices racing: exactly one set, no unique-key 500.
func TestStarterConcurrentCallsApplyOnce(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	user := starterUser(t)

	var wg sync.WaitGroup
	results := make(chan []platform.Widget, 6)
	errs := make(chan error, 6)
	for i := 0; i < 6; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			w, err := applyStarter(context.Background(), user, starterWidgets)
			if err != nil {
				errs <- err
				return
			}
			results <- w
		}()
	}
	wg.Wait()
	close(results)
	close(errs)
	for err := range errs {
		t.Errorf("concurrent call failed: %v", err)
	}
	applied := 0
	for w := range results {
		if len(w) > 0 {
			applied++
		}
	}
	if applied != 1 {
		t.Errorf("%d calls applied the set, want exactly 1", applied)
	}
	if got := widgetTypes(t, user); got != "finance_stocks,news_npr" {
		t.Errorf("widgets = %s", got)
	}
}

// The starter set must stay inside every plan and use only real catalog ids.
func TestStarterSetFitsAFreePlan(t *testing.T) {
	for _, id := range starterWidgets {
		if !platform.IsKnownWidgetType(id) || platform.IsUtilityWidgetType(id) || platform.IsFreeSlotWidgetType(id) {
			t.Errorf("%s is not a slot-using data widget", id)
		}
	}
	if max := MaxWidgetsForTier("free"); max != nil && len(starterWidgets) >= *max {
		t.Errorf("starter set (%d) leaves no slot on a Free plan (%d)", len(starterWidgets), *max)
	}
}
