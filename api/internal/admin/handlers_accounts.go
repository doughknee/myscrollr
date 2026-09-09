package admin

import (
	"context"
	"log"
	"strconv"
	"strings"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/accounts"
	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/gofiber/fiber/v2"
)

// The Users section: read-only, deliberately.
//
// Reading another person's email, plan and ticket history is already the most
// sensitive thing in this dashboard. Editing it is a separate decision with
// separate consequences, so there is no write path here at all - not a
// disabled button, not a guarded handler. Nothing to reach.
//
// The list is driven from Logto, which is the system of record for accounts
// (REL-265). It used to be driven from user_preferences, but that table only
// gains a row once someone gets far enough into the app to save a preference:
// in production that was 100 rows against 183 real accounts, so 83 people were
// structurally invisible here and in the Overview's account count.
//
// Logto supplies the identity half of a row - email, signup date, last sign-in
// - and the local tables are left-joined for the product half. An account with
// no local rows is shown with zero widgets and zero tickets, which is the
// truth about it, rather than being dropped.

const accountsPageSize = 50

// listLogtoUsers is a seam, not indirection for its own sake: it lets the
// tests drive both the healthy path and the Logto-unreachable path without a
// network. Same pattern as lookupVerifiedEmail in auth.go.
var (
	listLogtoUsers = accounts.ListLogtoUsers
	getLogtoUser   = accounts.GetLogtoUser
)

type AccountRow struct {
	LogtoSub string  `json:"logto_sub"`
	Email    *string `json:"email"`
	Name     *string `json:"name"`
	Plan     string  `json:"plan"`
	Status   string  `json:"status"`
	Lifetime bool    `json:"lifetime"`
	Widgets  int     `json:"widgets"`
	OnTicker int     `json:"on_ticker"`
	Fantasy  bool    `json:"fantasy"`
	Tickets  int     `json:"tickets"`

	// SignedUpAt and LastSignInAt come from Logto and mean what they say.
	// LastUsedApp is user_preferences.updated_at - the last time the app wrote
	// a preference - which is a different fact and carries a different name so
	// the two can never be read as the same thing. It is null for an account
	// that has never set the app up.
	SignedUpAt   *string `json:"signed_up_at"`
	LastSignInAt *string `json:"last_sign_in_at"`
	LastUsedApp  *string `json:"last_used_app"`
	SetUp        bool    `json:"set_up"`

	Suspended     bool    `json:"suspended"`
	DeletionState *string `json:"deletion_state"`
}

// localAccountRows fills the product half of each row for the given subs.
//
// Driving the query from unnest() rather than from user_preferences is the
// whole fix: the sub list is the authority on which rows exist, and every
// local table is a LEFT JOIN off it. A sub with nothing local still comes back.
func localAccountRows(ctx context.Context, subs []string) map[string]AccountRow {
	out := make(map[string]AccountRow, len(subs))
	if len(subs) == 0 {
		return out
	}

	rows, err := platform.DBPool.Query(ctx, `
		SELECT u.sub,
		       coalesce(s.plan, 'free'),
		       coalesce(s.status, 'none'),
		       coalesce(s.lifetime, false),
		       (SELECT count(*) FROM user_widgets w WHERE w.logto_sub = u.sub),
		       (SELECT count(*) FROM user_widgets w
		         WHERE w.logto_sub = u.sub AND w.ticker_enabled),
		       EXISTS (SELECT 1 FROM yahoo_users y WHERE y.logto_sub = u.sub),
		       (SELECT count(*) FROM support_cases c WHERE c.logto_sub = u.sub),
		       p.updated_at,
		       (SELECT d.status FROM user_deletion_requests d
		         WHERE d.logto_sub = u.sub ORDER BY d.requested_at DESC LIMIT 1)
		  FROM unnest($1::text[]) AS u(sub)
		  LEFT JOIN user_preferences p ON p.logto_sub = u.sub
		  LEFT JOIN stripe_customers s ON s.logto_sub = u.sub`, subs)
	if err != nil {
		// A local read failing must not blank the list. The identity half is
		// already in hand; the rows go out with zeroed product columns.
		log.Printf("[Admin] accounts local join: %v", err)
		return out
	}
	defer rows.Close()

	for rows.Next() {
		var a AccountRow
		var lastUsed *time.Time
		if err := rows.Scan(&a.LogtoSub, &a.Plan, &a.Status, &a.Lifetime,
			&a.Widgets, &a.OnTicker, &a.Fantasy, &a.Tickets, &lastUsed,
			&a.DeletionState); err != nil {
			log.Printf("[Admin] scan account: %v", err)
			continue
		}
		if lastUsed != nil {
			s := lastUsed.UTC().Format(time.RFC3339)
			a.LastUsedApp = &s
			a.SetUp = true
		}
		out[a.LogtoSub] = a
	}
	return out
}

// msToRFC3339 converts Logto's Unix-millisecond timestamps. Zero means the
// event never happened, which is a fact worth keeping as null rather than
// rendering as 1970.
func msToRFC3339(ms int64) *string {
	if ms <= 0 {
		return nil
	}
	s := time.UnixMilli(ms).UTC().Format(time.RFC3339)
	return &s
}

func strPtr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}

// AccountsPage is the list response.
//
// Total and SetUp are two different counts on purpose. Total is accounts;
// SetUp is how many of them ever saved a preference. The gap between them was
// invisible until REL-265 and is the most interesting number on the page, so
// the API hands both to the client rather than picking one.
//
// Source says which system the list came from. When Logto is unreachable the
// list degrades to the local table and Source says "local" - the client must
// label the number accordingly rather than presenting a smaller number as the
// account count.
type AccountsPage struct {
	Accounts []AccountRow `json:"accounts"`
	Total    int          `json:"total"`
	SetUp    int          `json:"set_up"`
	Page     int          `json:"page"`
	PageSize int          `json:"page_size"`
	Source   string       `json:"source"`
	Note     string       `json:"note,omitempty"`
}

// HandleListAccounts - GET /admin/accounts?q=&page=
//
// Search runs against Logto and therefore matches primaryEmail and username.
// Widget and ticket counts live locally and cannot be searched or sorted
// across the whole set from here; the client says so rather than sorting one
// page and letting it look global.
func HandleListAccounts(c *fiber.Ctx) error {
	ctx, cancel := context.WithTimeout(context.Background(), overviewTimeout)
	defer cancel()

	query := strings.TrimSpace(c.Query("q"))
	page, _ := strconv.Atoi(c.Query("page", "0"))
	if page < 0 {
		page = 0
	}

	// How many of these accounts ever set the app up. Independent of the
	// list, so a failure here costs the gap number, not the page.
	var setUp int
	if err := platform.DBPool.QueryRow(ctx,
		`SELECT count(*) FROM user_preferences`).Scan(&setUp); err != nil {
		log.Printf("[Admin] accounts set-up count: %v", err)
	}

	// Logto's paging is 1-based; the client's is 0-based. Convert here so
	// neither side has to know about the other's convention.
	users, total, err := listLogtoUsers(page+1, accountsPageSize, query)
	if err != nil {
		log.Printf("[Admin] logto user list: %v", err)
		return listAccountsFromLocal(ctx, c, query, page, setUp)
	}

	subs := make([]string, 0, len(users))
	for _, u := range users {
		subs = append(subs, u.ID)
	}
	local := localAccountRows(ctx, subs)

	out := make([]AccountRow, 0, len(users))
	for _, u := range users {
		a, ok := local[u.ID]
		if !ok {
			// The local read failed or raced a deletion. Zeroed product
			// columns beat dropping an account that demonstrably exists.
			a = AccountRow{LogtoSub: u.ID, Plan: "free", Status: "none"}
		}
		a.Email = strPtr(u.PrimaryEmail)
		a.Name = strPtr(firstNonEmpty(u.Name, u.Username))
		a.SignedUpAt = msToRFC3339(u.CreatedAt)
		a.LastSignInAt = msToRFC3339(u.LastSignInAt)
		a.Suspended = u.IsSuspended
		out = append(out, a)
	}

	return c.JSON(AccountsPage{
		Accounts: out,
		Total:    total,
		SetUp:    setUp,
		Page:     page,
		PageSize: accountsPageSize,
		Source:   "logto",
	})
}

// listAccountsFromLocal is the degraded path, taken only when Logto cannot be
// reached. It lists the accounts that have local rows - which is fewer than
// exist - and labels itself so, because a smaller number presented without
// that label is the exact bug REL-265 was filed about.
func listAccountsFromLocal(ctx context.Context, c *fiber.Ctx, query string, page, setUp int) error {
	pattern := "%" + strings.ToLower(query) + "%"

	var total int
	if err := platform.DBPool.QueryRow(ctx,
		`SELECT count(*) FROM user_preferences WHERE lower(logto_sub) LIKE $1`,
		pattern).Scan(&total); err != nil {
		log.Printf("[Admin] accounts local count: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(platform.ErrorResponse{
			Status: "error", Error: "Could not read accounts",
		})
	}

	rows, err := platform.DBPool.Query(ctx,
		`SELECT logto_sub FROM user_preferences
		  WHERE lower(logto_sub) LIKE $1
		  ORDER BY updated_at DESC LIMIT $2 OFFSET $3`,
		pattern, accountsPageSize, page*accountsPageSize)
	if err != nil {
		log.Printf("[Admin] accounts local list: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(platform.ErrorResponse{
			Status: "error", Error: "Could not read accounts",
		})
	}
	subs := make([]string, 0, accountsPageSize)
	for rows.Next() {
		var sub string
		if err := rows.Scan(&sub); err == nil {
			subs = append(subs, sub)
		}
	}
	rows.Close()

	local := localAccountRows(ctx, subs)
	out := make([]AccountRow, 0, len(subs))
	for _, sub := range subs {
		if a, ok := local[sub]; ok {
			out = append(out, a)
		}
	}

	return c.JSON(AccountsPage{
		Accounts: out,
		Total:    total,
		SetUp:    setUp,
		Page:     page,
		PageSize: accountsPageSize,
		Source:   "local",
		Note: "Logto is unreachable, so this is not the account list. It is " +
			"the accounts that have local data, which is fewer than exist.",
	})
}

// AccountDetail is one user's page: the same row as the list, plus what they
// have configured and every ticket they have opened.
type AccountDetail struct {
	Account AccountRow      `json:"account"`
	Widgets []AccountWidget `json:"widgets"`
	Cases   []AccountCase   `json:"cases"`
}

type AccountWidget struct {
	Type          string `json:"type"`
	Enabled       bool   `json:"enabled"`
	TickerEnabled bool   `json:"ticker_enabled"`
	UpdatedAt     string `json:"updated_at"`
}

type AccountCase struct {
	TicketNumber string  `json:"ticket_number"`
	Subject      string  `json:"subject"`
	Status       string  `json:"status"`
	Category     *string `json:"category"`
	OpenedAt     string  `json:"opened_at"`
}

// HandleGetAccount - GET /admin/accounts/:sub
//
// Reachable for every account, including one with no local rows. It used to
// 404 on those, which meant the 83 accounts the list could not show were also
// the 83 nobody could open.
func HandleGetAccount(c *fiber.Ctx) error {
	ctx, cancel := context.WithTimeout(context.Background(), overviewTimeout)
	defer cancel()

	sub := c.Params("sub")
	if sub == "" {
		return c.Status(fiber.StatusBadRequest).JSON(platform.ErrorResponse{
			Status: "error", Error: "A user id is required",
		})
	}

	account, hasLocal := localAccountRows(ctx, []string{sub})[sub]
	if !hasLocal {
		account = AccountRow{LogtoSub: sub, Plan: "free", Status: "none"}
	}

	user, err := getLogtoUser(sub)
	if err != nil {
		log.Printf("[Admin] account detail logto lookup for %s: %v", sub, err)
	} else if user != nil {
		account.Email = strPtr(user.PrimaryEmail)
		account.Name = strPtr(firstNonEmpty(user.Name, user.Username))
		account.SignedUpAt = msToRFC3339(user.CreatedAt)
		account.LastSignInAt = msToRFC3339(user.LastSignInAt)
		account.Suspended = user.IsSuspended
	} else if !hasLocal {
		// Neither Logto nor the local tables know this id.
		return c.Status(fiber.StatusNotFound).JSON(platform.ErrorResponse{
			Status: "error", Error: "No such account",
		})
	}

	detail := AccountDetail{
		Account: account,
		Widgets: make([]AccountWidget, 0, 8),
		Cases:   make([]AccountCase, 0, 4),
	}

	if rows, err := platform.DBPool.Query(ctx,
		`SELECT widget_type, enabled, ticker_enabled, updated_at
		   FROM user_widgets WHERE logto_sub = $1 ORDER BY widget_type`, sub); err != nil {
		log.Printf("[Admin] account widgets: %v", err)
	} else {
		for rows.Next() {
			var w AccountWidget
			var updated time.Time
			if err := rows.Scan(&w.Type, &w.Enabled, &w.TickerEnabled, &updated); err == nil {
				w.UpdatedAt = updated.UTC().Format(time.RFC3339)
				detail.Widgets = append(detail.Widgets, w)
			}
		}
		rows.Close()
	}

	if rows, err := platform.DBPool.Query(ctx,
		`SELECT ticket_number, subject, status, category, opened_at
		   FROM support_cases WHERE logto_sub = $1 ORDER BY opened_at DESC LIMIT 50`, sub); err != nil {
		log.Printf("[Admin] account cases: %v", err)
	} else {
		for rows.Next() {
			var k AccountCase
			var opened time.Time
			if err := rows.Scan(&k.TicketNumber, &k.Subject, &k.Status, &k.Category, &opened); err == nil {
				k.OpenedAt = opened.UTC().Format(time.RFC3339)
				detail.Cases = append(detail.Cases, k)
			}
		}
		rows.Close()
	}

	return c.JSON(detail)
}
