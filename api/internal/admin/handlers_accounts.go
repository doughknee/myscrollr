package admin

import (
	"context"
	"log"
	"strconv"
	"strings"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
)

// The Users section: read-only, deliberately.
//
// Reading another person's email, plan and ticket history is already the most
// sensitive thing in this dashboard. Editing it is a separate decision with
// separate consequences, so there is no write path here at all - not a
// disabled button, not a guarded handler. Nothing to reach.
//
// The list is keyed on user_preferences because that is the account row. The
// email is not stored locally; support_cases is the only table that has one,
// so a user with no ticket has no email to show and the row says so rather
// than reaching out to Logto for every row on every page.

const accountsPageSize = 50

type AccountRow struct {
	LogtoSub      string  `json:"logto_sub"`
	Email         *string `json:"email"`
	Plan          string  `json:"plan"`
	Status        string  `json:"status"`
	Lifetime      bool    `json:"lifetime"`
	Widgets       int     `json:"widgets"`
	OnTicker      int     `json:"on_ticker"`
	Fantasy       bool    `json:"fantasy"`
	Tickets       int     `json:"tickets"`
	CreatedAt     *string `json:"created_at"`
	UpdatedAt     string  `json:"updated_at"`
	DeletionState *string `json:"deletion_state"`
}

// accountsSelect is shared by the list and the detail read so the two can
// never drift into disagreeing about the same user.
const accountsSelect = `
	SELECT p.logto_sub,
	       (SELECT c.user_email FROM support_cases c
	         WHERE c.logto_sub = p.logto_sub AND c.user_email IS NOT NULL
	         ORDER BY c.opened_at DESC LIMIT 1),
	       coalesce(s.plan, 'free'),
	       coalesce(s.status, 'none'),
	       coalesce(s.lifetime, false),
	       (SELECT count(*) FROM user_widgets w WHERE w.logto_sub = p.logto_sub),
	       (SELECT count(*) FROM user_widgets w
	         WHERE w.logto_sub = p.logto_sub AND w.ticker_enabled),
	       EXISTS (SELECT 1 FROM yahoo_users y WHERE y.logto_sub = p.logto_sub),
	       (SELECT count(*) FROM support_cases c WHERE c.logto_sub = p.logto_sub),
	       p.created_at,
	       p.updated_at,
	       (SELECT d.status FROM user_deletion_requests d
	         WHERE d.logto_sub = p.logto_sub ORDER BY d.requested_at DESC LIMIT 1)
	  FROM user_preferences p
	  LEFT JOIN stripe_customers s ON s.logto_sub = p.logto_sub`

func scanAccount(row pgx.Row) (AccountRow, error) {
	var a AccountRow
	var created *time.Time
	var updated time.Time
	err := row.Scan(&a.LogtoSub, &a.Email, &a.Plan, &a.Status, &a.Lifetime,
		&a.Widgets, &a.OnTicker, &a.Fantasy, &a.Tickets, &created, &updated,
		&a.DeletionState)
	if err != nil {
		return a, err
	}
	if created != nil {
		s := created.UTC().Format(time.RFC3339)
		a.CreatedAt = &s
	}
	a.UpdatedAt = updated.UTC().Format(time.RFC3339)
	return a, nil
}

// HandleListAccounts - GET /admin/accounts?q=&page=
//
// The search matches the Logto sub or the email on any of the user's support
// cases. There is no other email anywhere in this database to match against.
func HandleListAccounts(c *fiber.Ctx) error {
	query := strings.TrimSpace(c.Query("q"))
	page, _ := strconv.Atoi(c.Query("page", "0"))
	if page < 0 {
		page = 0
	}

	// An empty q becomes the pattern '%', which LIKE matches against every
	// row - so one query shape serves both browsing and searching, with no
	// branch for "no search term".
	pattern := "%" + strings.ToLower(query) + "%"

	where := `
		 WHERE (lower(p.logto_sub) LIKE $1
		    OR EXISTS (SELECT 1 FROM support_cases c
		                WHERE c.logto_sub = p.logto_sub
		                  AND lower(c.user_email) LIKE $1))`

	var total int
	if err := platform.DBPool.QueryRow(context.Background(),
		`SELECT count(*) FROM user_preferences p`+where, pattern).Scan(&total); err != nil {
		log.Printf("[Admin] accounts count: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(platform.ErrorResponse{
			Status: "error", Error: "Could not read accounts",
		})
	}

	rows, err := platform.DBPool.Query(context.Background(),
		accountsSelect+where+` ORDER BY p.updated_at DESC LIMIT $2 OFFSET $3`,
		pattern, accountsPageSize, page*accountsPageSize)
	if err != nil {
		log.Printf("[Admin] accounts list: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(platform.ErrorResponse{
			Status: "error", Error: "Could not read accounts",
		})
	}
	defer rows.Close()

	out := make([]AccountRow, 0, accountsPageSize)
	for rows.Next() {
		a, err := scanAccount(rows)
		if err != nil {
			log.Printf("[Admin] scan account: %v", err)
			continue
		}
		out = append(out, a)
	}

	return c.JSON(fiber.Map{
		"accounts":  out,
		"total":     total,
		"page":      page,
		"page_size": accountsPageSize,
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
func HandleGetAccount(c *fiber.Ctx) error {
	sub := c.Params("sub")
	if sub == "" {
		return c.Status(fiber.StatusBadRequest).JSON(platform.ErrorResponse{
			Status: "error", Error: "A user id is required",
		})
	}

	account, err := scanAccount(platform.DBPool.QueryRow(context.Background(),
		accountsSelect+` WHERE p.logto_sub = $1`, sub))
	if err != nil {
		if err == pgx.ErrNoRows {
			return c.Status(fiber.StatusNotFound).JSON(platform.ErrorResponse{
				Status: "error", Error: "No such account",
			})
		}
		log.Printf("[Admin] account detail: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(platform.ErrorResponse{
			Status: "error", Error: "Could not read that account",
		})
	}

	detail := AccountDetail{
		Account: account,
		Widgets: make([]AccountWidget, 0, 8),
		Cases:   make([]AccountCase, 0, 4),
	}

	if rows, err := platform.DBPool.Query(context.Background(),
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

	if rows, err := platform.DBPool.Query(context.Background(),
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
