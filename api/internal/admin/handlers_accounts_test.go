package admin

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/brandon-relentnet/myscrollr/api/internal/accounts"
	"github.com/brandon-relentnet/myscrollr/api/internal/testsupport"
	"github.com/gofiber/fiber/v2"
)

// These tests pin the thing REL-265 was filed about: the account count must be
// the account count. Everything here is arranged so that a regression to
// "count user_preferences and call it accounts" fails loudly.

// withLogtoUsers swaps both Logto seams for a fixed set of accounts.
func withLogtoUsers(t *testing.T, total int, users ...accounts.LogtoUser) {
	t.Helper()
	prevList, prevGet, prevAll := listLogtoUsers, getLogtoUser, listAllLogtoUsers

	listLogtoUsers = func(page, pageSize int, search string) ([]accounts.LogtoUser, int, error) {
		return users, total, nil
	}
	getLogtoUser = func(sub string) (*accounts.LogtoUser, error) {
		for i := range users {
			if users[i].ID == sub {
				return &users[i], nil
			}
		}
		return nil, nil
	}
	listAllLogtoUsers = func() ([]accounts.LogtoUser, int, error) {
		return users, total, nil
	}

	t.Cleanup(func() {
		listLogtoUsers, getLogtoUser, listAllLogtoUsers = prevList, prevGet, prevAll
	})
}

// withLogtoDown makes every Logto read fail, which is the case the page has to
// survive without quietly reporting a smaller number as the truth.
func withLogtoDown(t *testing.T) {
	t.Helper()
	prevList, prevGet, prevAll := listLogtoUsers, getLogtoUser, listAllLogtoUsers
	down := errors.New("logto unreachable")

	listLogtoUsers = func(page, pageSize int, search string) ([]accounts.LogtoUser, int, error) {
		return nil, 0, down
	}
	getLogtoUser = func(sub string) (*accounts.LogtoUser, error) { return nil, down }
	listAllLogtoUsers = func() ([]accounts.LogtoUser, int, error) { return nil, 0, down }

	t.Cleanup(func() {
		listLogtoUsers, getLogtoUser, listAllLogtoUsers = prevList, prevGet, prevAll
	})
}

func resetAccountTables(t *testing.T) {
	t.Helper()
	testsupport.MustExec(t, `DELETE FROM user_widgets`)
	testsupport.MustExec(t, `DELETE FROM stripe_customers`)
	testsupport.MustExec(t, `DELETE FROM user_preferences`)
}

func seedPreferences(t *testing.T, sub string) {
	t.Helper()
	testsupport.MustExec(t,
		`INSERT INTO user_preferences (logto_sub) VALUES ($1)`, sub)
}

func getAccountsPage(t *testing.T, path string) AccountsPage {
	t.Helper()
	app := fiber.New()
	app.Get("/admin/accounts", HandleListAccounts)

	resp, err := app.Test(httptest.NewRequest(http.MethodGet, path, nil))
	if err != nil {
		t.Fatalf("app.Test: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}

	var page AccountsPage
	if err := json.NewDecoder(resp.Body).Decode(&page); err != nil {
		t.Fatalf("decode: %v", err)
	}
	return page
}

// The list is every account, and the total is Logto's, not the row count of a
// local table that only some accounts ever write to.
func TestListAccountsCountsLogtoNotPreferences(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	resetAccountTables(t)

	withLogtoUsers(t, 183,
		accounts.LogtoUser{ID: "has-prefs", PrimaryEmail: "a@example.test", CreatedAt: 1_700_000_000_000, LastSignInAt: 1_700_000_500_000},
		accounts.LogtoUser{ID: "never-set-up", PrimaryEmail: "b@example.test", CreatedAt: 1_700_000_000_000},
	)
	seedPreferences(t, "has-prefs")

	page := getAccountsPage(t, "/admin/accounts")

	if page.Source != "logto" {
		t.Fatalf("source = %q, want logto", page.Source)
	}
	if page.Total != 183 {
		t.Errorf("total = %d, want 183 (Logto's count, not the local table's)", page.Total)
	}
	if page.SetUp != 1 {
		t.Errorf("set_up = %d, want 1", page.SetUp)
	}
	if len(page.Accounts) != 2 {
		t.Fatalf("got %d rows, want 2", len(page.Accounts))
	}
}

// The whole bug in one assertion: an account that exists in Logto and has no
// local row must still be in the list, with honest zeroes.
func TestListAccountsIncludesAccountWithNoLocalRow(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	resetAccountTables(t)

	withLogtoUsers(t, 2,
		accounts.LogtoUser{ID: "has-prefs", CreatedAt: 1_700_000_000_000},
		accounts.LogtoUser{ID: "never-set-up", PrimaryEmail: "b@example.test", CreatedAt: 1_700_000_000_000},
	)
	seedPreferences(t, "has-prefs")

	page := getAccountsPage(t, "/admin/accounts")

	var found *AccountRow
	for i := range page.Accounts {
		if page.Accounts[i].LogtoSub == "never-set-up" {
			found = &page.Accounts[i]
		}
	}
	if found == nil {
		t.Fatal("account with no user_preferences row is missing from the list")
	}
	if found.SetUp {
		t.Error("set_up = true for an account with no preferences row")
	}
	if found.Widgets != 0 || found.Tickets != 0 {
		t.Errorf("widgets/tickets = %d/%d, want 0/0", found.Widgets, found.Tickets)
	}
	if found.LastUsedApp != nil {
		t.Errorf("last_used_app = %v, want null", *found.LastUsedApp)
	}
	if found.SignedUpAt == nil {
		t.Error("signed_up_at is null; Logto's createdAt should have filled it")
	}
	if found.Email == nil || *found.Email != "b@example.test" {
		t.Errorf("email = %v, want b@example.test", found.Email)
	}
}

// Logto down must be visible. Reporting the smaller local number without
// saying so is the exact failure this ticket exists to prevent.
func TestListAccountsDegradesVisiblyWhenLogtoIsDown(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	resetAccountTables(t)
	seedPreferences(t, "has-prefs")
	withLogtoDown(t)

	page := getAccountsPage(t, "/admin/accounts")

	if page.Source != "local" {
		t.Fatalf("source = %q, want local", page.Source)
	}
	if page.Note == "" {
		t.Error("no note explaining that this is not the account list")
	}
	if page.Total != 1 {
		t.Errorf("total = %d, want the local count of 1", page.Total)
	}
}

// The detail page has to open for an account with no local rows too, or the
// accounts the list could not show stay unreachable by another route.
func TestGetAccountWorksWithNoLocalRow(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	resetAccountTables(t)
	withLogtoUsers(t, 1,
		accounts.LogtoUser{ID: "never-set-up", PrimaryEmail: "b@example.test", CreatedAt: 1_700_000_000_000})

	app := fiber.New()
	app.Get("/admin/accounts/:sub", HandleGetAccount)

	resp, err := app.Test(httptest.NewRequest(http.MethodGet, "/admin/accounts/never-set-up", nil))
	if err != nil {
		t.Fatalf("app.Test: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}

	var detail AccountDetail
	if err := json.NewDecoder(resp.Body).Decode(&detail); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if detail.Account.SetUp {
		t.Error("set_up = true for an account with no preferences row")
	}
	if detail.Account.Email == nil {
		t.Error("email is null; Logto had one")
	}
}

// Both numbers, and the gap, from one tile.
func TestAccountsTileCarriesBothCounts(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	resetAccountTables(t)
	seedPreferences(t, "has-prefs")

	withLogtoUsers(t, 3,
		accounts.LogtoUser{ID: "has-prefs", CreatedAt: 1_700_000_000_000},
		accounts.LogtoUser{ID: "b", CreatedAt: 1_700_000_000_000},
		accounts.LogtoUser{ID: "c", CreatedAt: 1_700_000_000_000},
	)

	tile := accountsTile(context.Background())
	if tile.Source != "logto" {
		t.Fatalf("source = %q, want logto", tile.Source)
	}
	if tile.Total != 3 {
		t.Errorf("total = %d, want 3", tile.Total)
	}
	if tile.SetUp != 1 {
		t.Errorf("set_up = %d, want 1", tile.SetUp)
	}
}

func TestAccountsTileDegradesVisiblyWhenLogtoIsDown(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	resetAccountTables(t)
	seedPreferences(t, "has-prefs")
	withLogtoDown(t)

	tile := accountsTile(context.Background())
	if tile.Source != "local" {
		t.Fatalf("source = %q, want local", tile.Source)
	}
	if tile.Note == "" {
		t.Error("no note saying the number is not the account count")
	}
	if tile.Total != tile.SetUp {
		t.Errorf("total = %d, set_up = %d; the local fallback should report the local number",
			tile.Total, tile.SetUp)
	}
	if tile.New7d.Available || tile.New30d.Available {
		t.Error("signup windows claim to be available with Logto down")
	}
}

// A free-plan row sitting in stripe_customers is not a customer. Production
// has three active rows and two paying people.
func TestPayingExcludesFreePlanRows(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	resetAccountTables(t)

	seed := func(sub, plan, status string) {
		testsupport.MustExec(t,
			`INSERT INTO stripe_customers (logto_sub, stripe_customer_id, plan, status)
			 VALUES ($1, $2, $3, $4)`, sub, "cus_"+sub, plan, status)
	}
	seed("payer-1", "ultimate_annual", "active")
	seed("payer-2", "annual", "active")
	seed("freeloader", "free", "active")

	if got := plansTile(context.Background()).Paying; got != 2 {
		t.Fatalf("paying = %d, want 2 (three active rows, one on the free plan)", got)
	}

	seed("freeloader-2", "free", "active")
	if got := plansTile(context.Background()).Paying; got != 2 {
		t.Errorf("paying = %d after adding another free row, want 2", got)
	}
}
