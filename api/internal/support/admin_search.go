package support

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/gofiber/fiber/v2"
)

const ticketSearchPageSize = 10

type ticketSearchRow struct {
	TicketNumber  string    `json:"ticket_number"`
	Subject       string    `json:"subject"`
	Name          string    `json:"name"`
	UserEmail     string    `json:"user_email"`
	Status        string    `json:"status"`
	ConsoleStatus string    `json:"console_status"`
	UpdatedAt     time.Time `json:"updated_at"`
	Legacy        bool      `json:"legacy"`
}

type ticketSearchPage struct {
	Rows       []ticketSearchRow `json:"rows"`
	NextCursor string            `json:"next_cursor,omitempty"`
}

type ticketSearchCursor struct {
	UpdatedAt time.Time `json:"at"`
	Ticket    string    `json:"ticket"`
}

// Keep the expression aligned with migration 000031 so substring searches use its GIN index.
const ticketSearchSQL = `
	SELECT ticket_number, subject, coalesce(user_name, ''), coalesce(user_email, ''),
	       status, console_status, updated_at, opened_at < $4
	  FROM support_cases
	 WHERE lower(coalesce(ticket_number, '') || ' ' || coalesce(subject, '') || ' ' ||
	       coalesce(user_name, '') || ' ' || coalesce(user_email, '') || ' ' ||
	       coalesce(summary, '') || ' ' || coalesce(category, '')) LIKE $1
	   AND ($2::timestamptz IS NULL OR (updated_at, ticket_number) < ($2, $3))
	 ORDER BY updated_at DESC, ticket_number DESC
	 LIMIT 11`

// HandleAdminTicketSearch searches retained history without changing the operational queue's epoch.
// It deliberately avoids drafts, message bodies and external account/issue lookups.
func HandleAdminTicketSearch(c *fiber.Ctx) error {
	c.Set("Cache-Control", "no-store")
	query := strings.TrimSpace(c.Query("q"))
	query = strings.TrimPrefix(query, "#")
	length := utf8.RuneCountInString(query)
	if length == 0 || length > 200 || strings.ContainsRune(query, 0) {
		return c.Status(fiber.StatusBadRequest).JSON(platform.ErrorResponse{Status: "error", Error: "Enter a search between 1 and 200 characters."})
	}
	var cursor ticketSearchCursor
	var before *time.Time
	if raw := c.Query("cursor"); raw != "" {
		if len(raw) > 512 {
			return c.Status(fiber.StatusBadRequest).JSON(platform.ErrorResponse{Status: "error", Error: "Invalid search cursor."})
		}
		decoded, err := base64.RawURLEncoding.DecodeString(raw)
		if err != nil || json.Unmarshal(decoded, &cursor) != nil || cursor.UpdatedAt.IsZero() || cursor.Ticket == "" || len(cursor.Ticket) > 128 {
			return c.Status(fiber.StatusBadRequest).JSON(platform.ErrorResponse{Status: "error", Error: "Invalid search cursor."})
		}
		before = &cursor.UpdatedAt
	}
	if platform.DBPool == nil {
		return adminSupportError(c, "Ticket history search is unavailable. Please retry.")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	// Treat user input literally: '%' and '_' must not turn into wildcard searches.
	pattern := "%" + strings.NewReplacer(`\`, `\\`, "%", `\%`, "_", `\_`).Replace(strings.ToLower(query)) + "%"
	rows, err := platform.DBPool.Query(ctx, ticketSearchSQL, pattern, before, cursor.Ticket, SupportEpoch)
	if err != nil {
		return adminSupportError(c, "Ticket history search could not finish. Please retry or narrow the search.")
	}
	defer rows.Close()
	result := ticketSearchPage{Rows: make([]ticketSearchRow, 0, ticketSearchPageSize)}
	for rows.Next() {
		var row ticketSearchRow
		if err := rows.Scan(&row.TicketNumber, &row.Subject, &row.Name, &row.UserEmail, &row.Status, &row.ConsoleStatus, &row.UpdatedAt, &row.Legacy); err != nil {
			return adminSupportError(c, "Ticket history search could not be read. Please retry.")
		}
		result.Rows = append(result.Rows, row)
	}
	if rows.Err() != nil {
		return adminSupportError(c, "Ticket history search could not finish. Please retry.")
	}
	if len(result.Rows) > ticketSearchPageSize {
		result.Rows = result.Rows[:ticketSearchPageSize]
		last := result.Rows[len(result.Rows)-1]
		raw, _ := json.Marshal(ticketSearchCursor{UpdatedAt: last.UpdatedAt, Ticket: last.TicketNumber})
		result.NextCursor = base64.RawURLEncoding.EncodeToString(raw)
	}
	return c.JSON(result)
}
