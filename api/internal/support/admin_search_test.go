package support

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/brandon-relentnet/myscrollr/api/internal/testsupport"
	"github.com/gofiber/fiber/v2"
)

func readTicketSearch(t *testing.T, app *fiber.App, query, cursor string) ticketSearchPage {
	t.Helper()
	status, body := getJSON(t, app, "/admin/support/search?"+url.Values{"q": {query}, "cursor": {cursor}}.Encode())
	if status != fiber.StatusOK {
		t.Fatalf("search returned %d: %s", status, body)
	}
	var page ticketSearchPage
	if err := json.Unmarshal([]byte(body), &page); err != nil {
		t.Fatal(err)
	}
	return page
}

func TestAdminTicketSearchFindsHistoryOutsideQueue(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	resetCases(t)
	seedAdmin(t, "sub-staff")
	epoch := SupportEpoch
	SupportEpoch = time.Date(2026, 9, 25, 0, 0, 0, 0, time.UTC)
	t.Cleanup(func() { SupportEpoch = epoch })
	testsupport.MustExec(t, `INSERT INTO support_cases(ticket_number, subject, opened_at, updated_at)
	 SELECT (100000 + n)::text, 'newer unrelated case', now(), now() FROM generate_series(1, 600) n`)
	testsupport.MustExec(t, `INSERT INTO support_cases(ticket_number, subject, user_name, user_email, summary, category, status, console_status, opened_at, updated_at)
	 VALUES ('12345', 'Legacy Needle 100% a_b c\d', 'ArchivePerson', 'old@example.com', 'HiddenRootCause', 'ArchivedCase', 'closed', 'dismissed', '2025-01-01', '2025-01-01')`)
	app := adminSupportApp("sub-staff")
	for _, query := range []string{"legacy needle", "ARCHIVEPERSON", "old@example.com", "HiddenRootCause", "ArchivedCase", "#12345", "100%", "a_b", `c\d`} {
		page := readTicketSearch(t, app, query, "")
		if len(page.Rows) != 1 || page.Rows[0].TicketNumber != "12345" || !page.Rows[0].Legacy || page.Rows[0].ConsoleStatus != "dismissed" {
			t.Fatalf("%q: %+v", query, page)
		}
	}
	if rows := readTicketSearch(t, app, "a%b", "").Rows; len(rows) != 0 {
		t.Fatal("wildcard input was not literal")
	}
	if rows := readTicketSearch(t, app, "zz_not_found", "").Rows; len(rows) != 0 {
		t.Fatal("expected empty result")
	}
	status, body := getJSON(t, app, "/admin/support/search?q=Legacy")
	if status != 200 || strings.Contains(body, "HiddenRootCause") || strings.Contains(body, "logto_sub") {
		t.Fatal("search returned unnecessary private fields")
	}
	// History lookup must not put the pre-reset case back into the active queue.
	rows, _, err := loadQueueRows(context.Background(), 500, AutoSendState{}, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	for _, row := range rows {
		if row.TicketNumber == "12345" {
			t.Fatal("legacy case leaked into active queue")
		}
	}
}

func TestAdminTicketSearchPagesEqualTimestampsWithoutSkipping(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	resetCases(t)
	seedAdmin(t, "sub-staff")
	testsupport.MustExec(t, `INSERT INTO support_cases(ticket_number, subject, updated_at)
	 SELECT (200000 + n)::text, 'pagination match', '2026-01-01' FROM generate_series(1, 23) n`)
	app := adminSupportApp("sub-staff")
	seen := map[string]bool{}
	cursor := ""
	for pageNumber := 0; pageNumber < 3; pageNumber++ {
		page := readTicketSearch(t, app, "pagination", cursor)
		want := 10
		if pageNumber == 2 {
			want = 3
		}
		if len(page.Rows) != want {
			t.Fatalf("page %d: got %d", pageNumber, len(page.Rows))
		}
		for _, row := range page.Rows {
			if seen[row.TicketNumber] {
				t.Fatal("duplicate ticket")
			}
			seen[row.TicketNumber] = true
		}
		cursor = page.NextCursor
		if pageNumber < 2 && cursor == "" {
			t.Fatal("missing cursor")
		}
		if pageNumber == 0 {
			testsupport.MustExec(t, `INSERT INTO support_cases(ticket_number, subject, updated_at) VALUES ('999999', 'pagination match', now())`)
		}
	}
	if cursor != "" || len(seen) != 23 {
		t.Fatalf("incorrect end of results: %d", len(seen))
	}
}

func TestAdminTicketSearchRejectsInvalidInput(t *testing.T) {
	app := fiber.New()
	app.Get("/search", HandleAdminTicketSearch)
	for _, query := range []url.Values{
		{"q": {""}}, {"q": {strings.Repeat("x", 201)}}, {"q": {"\x00bad"}},
		{"q": {"hello"}, "cursor": {"not-base64!"}},
		{"q": {"hello"}, "cursor": {base64.RawURLEncoding.EncodeToString([]byte(`{"at":"2026-01-01T00:00:00Z"}`))}},
		{"q": {"hello"}, "cursor": {strings.Repeat("a", 513)}},
	} {
		if status, _ := getJSON(t, app, "/search?"+query.Encode()); status != 400 {
			t.Fatalf("expected 400, got %d", status)
		}
	}
}

func TestAdminTicketSearchUsesHistoryIndex(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	resetCases(t)
	testsupport.MustExec(t, `INSERT INTO support_cases(ticket_number, subject, updated_at)
	 SELECT (300000 + n)::text, 'archive record ' || n, now() - n * interval '1 second' FROM generate_series(1, 50000) n`)
	testsupport.MustExec(t, `UPDATE support_cases SET subject = 'rare searchable needle' WHERE ticket_number = '300001'`)
	testsupport.MustExec(t, `ANALYZE support_cases`)
	rows, err := platform.DBPool.Query(context.Background(), "EXPLAIN (ANALYZE, BUFFERS) "+ticketSearchSQL, "%searchable needle%", nil, "", SupportEpoch)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var plan strings.Builder
	for rows.Next() {
		var line string
		if err := rows.Scan(&line); err != nil {
			t.Fatal(err)
		}
		fmt.Fprintln(&plan, line)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	t.Log(plan.String())
	if !strings.Contains(plan.String(), "support_cases_history_search_idx") {
		t.Fatal("selective history search did not use its index")
	}
}
