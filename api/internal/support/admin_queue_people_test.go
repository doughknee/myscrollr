package support

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/brandon-relentnet/myscrollr/api/internal/testsupport"
	"github.com/gofiber/fiber/v2"
)

// ===== The rules, with no database and no clock ====================

func at(day int) *time.Time {
	t := time.Date(2026, 9, day, 12, 0, 0, 0, time.UTC)
	return &t
}

func row(ticket, email, name, group string, opts ...func(*AdminQueueRow)) AdminQueueRow {
	r := AdminQueueRow{
		TicketNumber: ticket,
		UserEmail:    email,
		Name:         name,
		Subject:      "subject " + ticket,
		Group:        group,
		UpdatedAt:    time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC),
		WaitingHours: platform.Unmeasured("no message on record"),
	}
	for _, o := range opts {
		o(&r)
	}
	r.Section = caseSection(r.Group, r.Paying)
	r.PersonKey = personKey(r)
	return r
}

func wrote(day, waitHours int) func(*AdminQueueRow) {
	return func(r *AdminQueueRow) {
		r.LastUserMessageAt = at(day)
		r.WaitingHours = platform.Measured{Value: waitHours, Available: true}
	}
}

func paid(plan string) func(*AdminQueueRow) {
	return func(r *AdminQueueRow) { r.Plan, r.Paying = plan, true }
}

func freePlan(r *AdminQueueRow) { r.Plan = "free" }

// The whole reason for the ticket: Rachel wrote five times in one afternoon
// and that is one person to answer, not five rows to read.
func TestFiveTicketsFromOnePersonAreOneRow(t *testing.T) {
	rows := []AdminQueueRow{
		row("752473", "r_armstrong@me.com", "Rachel Armstrong", queueNeedsYou, wrote(1, 12)),
		row("584802", "r_armstrong@me.com", "", queueWaiting, wrote(2, 300)),
		row("411284", "R_Armstrong@me.com", "", queueWaiting, wrote(2, 300)),
		row("956950", "r_armstrong@me.com", "", queueHandled),
		row("613084", "r_armstrong@me.com", "", queueHandled),
	}

	people := groupPeople(rows)
	if len(people) != 1 {
		t.Fatalf("got %d rows, want one person: %+v", len(people), people)
	}
	p := people[0]
	if p.Tickets != 5 {
		t.Errorf("tickets = %d, want 5", p.Tickets)
	}
	// The mixed case in #411284 is the same mailbox, and grouping that missed
	// it would show Rachel twice.
	if p.Key != "r_armstrong@me.com" {
		t.Errorf("key = %q, want the lowercased email", p.Key)
	}
	if p.NeedsYou != 1 || p.Waiting != 2 || p.Handled != 2 {
		t.Errorf("state counts = %d/%d/%d, want 1 needing a person, 2 waiting, 2 handled",
			p.NeedsYou, p.Waiting, p.Handled)
	}
	// The name is on one ticket out of five. Losing it because four rows did
	// not carry it would be the same failure as inventing one.
	if p.Name != "Rachel Armstrong" {
		t.Errorf("name = %q, want it carried over from the ticket that had it", p.Name)
	}
	// The headline is the ticket that needs a person, whatever order the rows
	// arrived in.
	if p.HeadlineTicket != "752473" {
		t.Errorf("headline = %q, want the open one (#752473)", p.HeadlineTicket)
	}
	if p.Section != sectionOpen {
		t.Errorf("section = %q, want %q", p.Section, sectionOpen)
	}
	// The wait is the longest of her tickets, not the newest one.
	if !p.WaitingHours.Available || p.WaitingHours.Value != 300 {
		t.Errorf("waiting_hours = %+v, want the longest wait across her tickets", p.WaitingHours)
	}
}

// #819835 came in from the marketing site with nobody behind it. It has to
// appear, and it has to appear without a name we made up.
func TestACaseWithNoAccountIsGroupedWithoutInventingAPerson(t *testing.T) {
	people := groupPeople([]AdminQueueRow{
		row("819835", "", "", queueNeedsYou, wrote(1, 40)),
		row("819836", "", "", queueNeedsYou, wrote(1, 40)),
	})

	if len(people) != 2 {
		t.Fatalf("two anonymous tickets are two unknown people, got %d: %+v", len(people), people)
	}
	for _, p := range people {
		if p.Name != "" || p.Email != "" || p.Plan != "" {
			t.Errorf("an anonymous group must carry no name, email or plan: %+v", p)
		}
		if p.Paying {
			t.Error("nothing is known about this person, so they are certainly not in the paying section")
		}
		if !strings.Contains(p.PlanNote, "No account is attached") {
			t.Errorf("the empty plan needs a sentence saying why: %q", p.PlanNote)
		}
		if p.Tickets != 1 {
			t.Errorf("tickets = %d, want 1", p.Tickets)
		}
	}
}

// Priority support is something we sold. No ordering a reader picks may push a
// paying customer below somebody who did not pay.
func TestPayingCustomersStayOnTopUnderEverySort(t *testing.T) {
	rows := []AdminQueueRow{
		row("1", "zoe@example.com", "Zoe Zephyr", queueNeedsYou, paid("uplink_ultimate"), wrote(1, 200)),
		row("2", "amy@example.com", "Amy Adams", queueNeedsYou, freePlan, wrote(9, 1)),
		row("3", "amy@example.com", "Amy Adams", queueNeedsYou, freePlan, wrote(9, 1)),
		row("4", "bob@example.com", "Bob Brown", queueWaiting, freePlan, wrote(5, 90)),
	}

	for _, field := range sortFields {
		for _, dir := range []string{"asc", "desc"} {
			people := groupPeople(rows)
			sortPeople(people, field, dir)
			if people[0].Key != "zoe@example.com" {
				t.Errorf("sort=%s dir=%s put %q first; the paying customer must lead every sort",
					field, dir, people[0].Key)
			}
			if people[0].Section != sectionPaying {
				t.Errorf("sort=%s dir=%s: leading row is in %q", field, dir, people[0].Section)
			}
			// Sections never reorder, whatever the sort is doing inside them.
			rank := sectionRanks()
			for i := 1; i < len(people); i++ {
				if rank[people[i].Section] < rank[people[i-1].Section] {
					t.Errorf("sort=%s dir=%s reordered the sections: %v",
						field, dir, sectionsOf(people))
					break
				}
			}
		}
	}
}

func sectionsOf(people []AdminPerson) []string {
	out := make([]string, 0, len(people))
	for _, p := range people {
		out = append(out, p.Section)
	}
	return out
}

// Each field orders by the thing it names, and the direction button reverses
// it — inside the section, which for these four rows is the same one.
func TestEverySortFieldOrdersByWhatItNames(t *testing.T) {
	rows := []AdminQueueRow{
		row("10", "cara@example.com", "Cara", queueNeedsYou, wrote(3, 150)),
		row("11", "cara@example.com", "Cara", queueNeedsYou, wrote(3, 150)),
		row("12", "abe@example.com", "Abe", queueNeedsYou, wrote(8, 20)),
		row("13", "bea@example.com", "Bea", queueNeedsYou, wrote(1, 400)),
	}

	cases := []struct {
		field    string
		dir      string
		wantHead string
		why      string
	}{
		{sortLastWrote, "desc", "abe@example.com", "newest first"},
		{sortLastWrote, "asc", "bea@example.com", "oldest first"},
		{sortWaiting, "desc", "bea@example.com", "longest waiting first"},
		{sortWaiting, "asc", "abe@example.com", "shortest waiting first"},
		{sortTickets, "desc", "cara@example.com", "most tickets first"},
		{sortName, "asc", "abe@example.com", "A first"},
		{sortName, "desc", "cara@example.com", "Z first"},
	}
	for _, tc := range cases {
		t.Run(tc.field+"/"+tc.dir, func(t *testing.T) {
			people := groupPeople(rows)
			sortPeople(people, tc.field, tc.dir)
			if people[0].Key != tc.wantHead {
				t.Errorf("%s: got %q first, want %q (%s)", tc.why, people[0].Key, tc.wantHead, tc.why)
			}
		})
	}

	// Reversing has to be a real reversal, not a re-shuffle: same rows, same
	// grouping, opposite order.
	for _, field := range sortFields {
		up, down := groupPeople(rows), groupPeople(rows)
		sortPeople(up, field, "asc")
		sortPeople(down, field, "desc")
		if len(up) != len(down) {
			t.Fatalf("%s: grouping is not stable across sorts", field)
		}
	}
}

// "We do not know" is not an extreme value. A person with no message on record
// sorts last both ways rather than floating to the top when you reverse.
func TestUnknownsSortLastInBothDirections(t *testing.T) {
	rows := []AdminQueueRow{
		row("20", "known@example.com", "Known", queueNeedsYou, wrote(3, 150)),
		row("21", "silent@example.com", "", queueNeedsYou),
	}
	for _, field := range []string{sortLastWrote, sortWaiting, sortName} {
		for _, dir := range []string{"asc", "desc"} {
			people := groupPeople(rows)
			sortPeople(people, field, dir)
			if people[len(people)-1].Key != "silent@example.com" {
				t.Errorf("sort=%s dir=%s floated the unknown to %d; unknowns go last both ways",
					field, dir, indexOf(people, "silent@example.com"))
			}
		}
	}
}

func indexOf(people []AdminPerson, key string) int {
	for i, p := range people {
		if p.Key == key {
			return i
		}
	}
	return -1
}

// The section a person lands in, from what their tickets are doing.
func TestSectionsFollowTheWorstTicketAndThePlanBeatsBoth(t *testing.T) {
	cases := []struct {
		name string
		rows []AdminQueueRow
		want string
	}{
		{"anything needing a person is open",
			[]AdminQueueRow{row("1", "a@x.com", "", queueNeedsYou), row("2", "a@x.com", "", queueHandled)},
			sectionOpen},
		{"replied and nothing else is answered",
			[]AdminQueueRow{row("1", "a@x.com", "", queueWaiting), row("2", "a@x.com", "", queueHandled)},
			sectionAnswered},
		{"everything closed is resolved",
			[]AdminQueueRow{row("1", "a@x.com", "", queueHandled)},
			sectionResolved},
		{"a paying customer with nothing open is still in the paying section",
			[]AdminQueueRow{row("1", "a@x.com", "", queueHandled, paid("uplink"))},
			sectionPaying},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			people := groupPeople(tc.rows)
			if people[0].Section != tc.want {
				t.Errorf("section = %q, want %q", people[0].Section, tc.want)
			}
		})
	}
}

// Production has three `active` stripe rows and two paying customers. The
// third is on the free plan, and reading `status = 'active'` alone would put a
// free user in the section we sold to people who pay.
func TestOnlyRealMoneyCountsAsPaying(t *testing.T) {
	cases := []struct {
		plan, status string
		lifetime     bool
		want         bool
	}{
		{"uplink_ultimate", "active", false, true},
		{"uplink", "active", false, true},
		{"free", "active", false, false},
		{"", "active", false, false},
		{"uplink", "canceled", false, false},
		{"uplink", "past_due", false, false},
		// The lifetime purchase has nothing left for Stripe to renew, so its
		// status is not "active" — and it is the largest single payment anyone
		// has made us.
		{"uplink_ultimate", "", true, true},
		{"free", "", true, false},
	}
	for _, tc := range cases {
		if got := planIsPaying(tc.plan, tc.status, tc.lifetime); got != tc.want {
			t.Errorf("planIsPaying(%q, %q, %v) = %v, want %v",
				tc.plan, tc.status, tc.lifetime, got, tc.want)
		}
	}
}

// Who sent the last reply, from the three things the row already records.
func TestReplyProvenanceNamesWhoIsResponsible(t *testing.T) {
	cases := []struct {
		name                        string
		status, disposition         string
		draft, edited               string
		intervened                  bool
		wantCode, wantLabelContains string
	}{
		{"the sweeper sent it unattended", "approved", dispositionAutoSend,
			"<p>hi</p>", "", false, provenanceBot, "bot"},
		{"the sweeper asked unattended", "asked", dispositionAutoAsk,
			"<p>which version?</p>", "", false, provenanceBot, "bot"},
		{"a person rewrote it", "edited", dispositionAutoSend,
			"<p>hi</p>", "<p>hello there</p>", true, provenanceEdited, "edited"},
		// The older approval endpoint stores an edit without moving the status
		// to "edited"; a differing body is still an edit.
		{"an edit stored under the old status", "approved", dispositionAutoSend,
			"<p>hi</p>", "<p>hello there</p>", false, provenanceEdited, "edited"},
		{"a person approved it as written", "approved", dispositionAutoSend,
			"<p>hi</p>", "", true, provenancePerson, "you sent it"},
		{"an escalation somebody sent by hand", "approved", dispositionEscalate,
			"<p>hi</p>", "", false, provenancePerson, "you sent it"},
		{"nothing has gone out yet", "pending", dispositionAutoSend,
			"<p>hi</p>", "", false, "", ""},
		{"a skipped draft never went out", "skipped", dispositionEscalate,
			"<p>hi</p>", "", true, "", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			code, label := replyProvenance(tc.status, tc.disposition, tc.draft, tc.edited, tc.intervened)
			if code != tc.wantCode {
				t.Errorf("code = %q, want %q", code, tc.wantCode)
			}
			if !strings.Contains(label, tc.wantLabelContains) {
				t.Errorf("label = %q, want it to mention %q", label, tc.wantLabelContains)
			}
		})
	}
}

// An unrecognised sort is refused rather than quietly answered in some other
// order. A list that ignores what you asked it for is how you end up sorting
// in the browser instead.
func TestSortParametersAreValidatedNotGuessed(t *testing.T) {
	if f, d, ok := normaliseSort("", ""); !ok || f != sortLastWrote || d != "desc" {
		t.Errorf("the default is last wrote, newest first; got %q/%q ok=%v", f, d, ok)
	}
	if _, d, ok := normaliseSort(sortName, ""); !ok || d != "asc" {
		t.Errorf("name defaults to A-Z, got %q", d)
	}
	for _, bad := range [][2]string{{"oldest", ""}, {sortName, "sideways"}, {"; DROP TABLE", "asc"}} {
		if _, _, ok := normaliseSort(bad[0], bad[1]); ok {
			t.Errorf("normaliseSort(%q, %q) was accepted", bad[0], bad[1])
		}
	}
}

func TestSearchLooksAtEveryFieldAReaderCanSee(t *testing.T) {
	r := row("752473", "r_armstrong@me.com", "Rachel Armstrong", queueNeedsYou)
	r.Subject = "Adding an RSS feed felt risky"
	for _, q := range []string{"", "rachel", "RACHEL", "752473", "rss feed", "armstrong@me"} {
		if !matchesSearch(r, q) {
			t.Errorf("search %q should have matched", q)
		}
	}
	if matchesSearch(r, "kalshi") {
		t.Error("search matched something that is not there")
	}
}

// ===== The endpoint ================================================

// The section a person lands in must follow the CURRENT subscription, not the
// plan recorded on the ticket. Reading tier_at_open would leave somebody who
// upgraded last week in the general queue forever, and promote somebody who
// has since lapsed.
func TestQueueSectionsUseTheCurrentPlanNotTierAtOpen(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	resetCases(t)
	seedAdmin(t, "sub-staff")
	t.Setenv("SUPPORT_AUTOSEND", "off")
	testsupport.MustExec(t, `DELETE FROM stripe_customers WHERE logto_sub LIKE 'sub-rel266%'`)
	t.Cleanup(func() {
		testsupport.MustExec(t, `DELETE FROM stripe_customers WHERE logto_sub LIKE 'sub-rel266%'`)
	})

	// upgraded: wrote while free, is paying now.
	// lapsed:   wrote while paying, is on free now.
	// nobody:   no account at all, the way #819835 arrived.
	testsupport.MustExec(t, `INSERT INTO stripe_customers
		(logto_sub, stripe_customer_id, plan, status, lifetime) VALUES
		('sub-rel266-up',     'cus_up',     'uplink_ultimate', 'active', false),
		('sub-rel266-lapsed', 'cus_lapsed', 'free',            'active', false)`)
	testsupport.MustExec(t, `INSERT INTO support_cases
		(ticket_number, user_email, logto_sub, subject, status, tier_at_open, os, updated_at) VALUES
		('900100', 'up@example.com',     'sub-rel266-up',     'ticker will not scroll', 'open', 'free',            'macOS',   now()),
		('900101', 'lapsed@example.com', 'sub-rel266-lapsed', 'feed cannot be edited',  'open', 'uplink_ultimate', 'Windows', now() - interval '1 hour'),
		('900102', NULL,                 NULL,                'Linux sign-in',          'open', NULL,              'Linux',   now() - interval '2 hours')`)
	testsupport.MustExec(t, `INSERT INTO support_messages (ticket_number, kind, body_text, created_at) VALUES
		('900100', 'user', 'it will not move', now() - interval '4 hours'),
		('900101', 'user', 'cannot edit',      now() - interval '2 days'),
		('900102', 'user', 'no browser opens', now() - interval '100 days')`)

	app := adminSupportApp("sub-staff")
	status, body := getJSON(t, app, "/admin/support/queue")
	if status != fiber.StatusOK {
		t.Fatalf("queue: got %d, want 200 (body: %s)", status, body)
	}
	var res AdminQueueResponse
	if err := json.Unmarshal([]byte(body), &res); err != nil {
		t.Fatalf("decode queue: %v (body: %s)", err, body)
	}

	byKey := map[string]AdminPerson{}
	for _, p := range res.People {
		byKey[p.Key] = p
	}
	if len(res.People) != 3 {
		t.Fatalf("got %d people, want 3: %v", len(res.People), sectionsOf(res.People))
	}

	up := byKey["up@example.com"]
	if !up.Paying || up.Section != sectionPaying {
		t.Errorf("a customer who upgraded since opening the ticket must be in the paying section: %+v", up)
	}
	if up.Plan != "uplink_ultimate" {
		t.Errorf("plan = %q, want the current subscription rather than tier_at_open (free)", up.Plan)
	}

	lapsed := byKey["lapsed@example.com"]
	if lapsed.Paying || lapsed.Section != sectionOpen {
		t.Errorf("a lapsed customer must not be promoted by tier_at_open: %+v", lapsed)
	}
	if lapsed.Plan != "free" {
		t.Errorf("plan = %q, want the current 'free' rather than tier_at_open (uplink_ultimate)", lapsed.Plan)
	}

	// The anonymous one: present, grouped, and with nothing invented.
	anon := byKey["ticket:900102"]
	if anon.Key == "" {
		t.Fatalf("the anonymous case is missing from the queue: %v", res.People)
	}
	if anon.Name != "" || anon.Email != "" || anon.Plan != "" {
		t.Errorf("the anonymous case grew a person: %+v", anon)
	}
	if anon.Section != sectionOpen {
		t.Errorf("the anonymous case is open and needs a person, got section %q", anon.Section)
	}

	if res.Sections[sectionPaying] != 1 {
		t.Errorf("sections = %v, want exactly one paying row", res.Sections)
	}
	// The caption under the paying section comes from the server, counted
	// over the whole table rather than over this page.
	if res.Accounts.Cases != 3 || res.Accounts.CasesWithAccount != 2 {
		t.Errorf("account counts = %+v, want 3 cases of which 2 carry an account", res.Accounts)
	}
	if res.Accounts.Paying != 1 {
		t.Errorf("paying accounts = %d, want the one uplink_ultimate row", res.Accounts.Paying)
	}

	if res.Sort != sortLastWrote || res.Dir != "desc" || res.RowsMode != "person" {
		t.Errorf("the response must echo what it sorted by: sort=%q dir=%q rows=%q",
			res.Sort, res.Dir, res.RowsMode)
	}
}

// An empty paying section is a fact about the data, and it has to say so.
//
// Production is the reason this test exists: two accounts pay, and neither has
// ever written in under an account we can see — only ONE of fifty-nine cases
// carries a logto_sub at all. A blank box there reads as a broken query.
func TestAnEmptyPayingSectionExplainsItself(t *testing.T) {
	accounts := AdminQueueAccounts{Paying: 2, CasesWithAccount: 1, Cases: 59}

	note := payingSectionNote(accounts, 0)
	for _, want := range []string{"2 accounts are paying", "1 of 59"} {
		if !strings.Contains(note, want) {
			t.Errorf("the empty paying section must say %q; got %q", want, note)
		}
	}
	// With somebody in it there is nothing to explain.
	if payingSectionNote(accounts, 1) != "" {
		t.Errorf("a populated section needs no excuse: %q", payingSectionNote(accounts, 1))
	}
	// And nobody paying is a different sentence from nobody writing in.
	none := payingSectionNote(AdminQueueAccounts{Cases: 59}, 0)
	if !strings.Contains(none, "Nobody is on a paid plan") {
		t.Errorf("no paying accounts at all: %q", none)
	}
	// One account is one account. "1 accounts are paying" is the kind of
	// sentence that makes a reader distrust every other number on the page.
	one := payingSectionNote(AdminQueueAccounts{Paying: 1, CasesWithAccount: 0, Cases: 9}, 0)
	if !strings.Contains(one, "One account is paying") || strings.Contains(one, "1 accounts") {
		t.Errorf("singular: %q", one)
	}
}

// Sorting is a query parameter and the server answers it. Asking for something
// it does not know is a 400 rather than an unannounced different order.
func TestQueueSortsServerSideAndRefusesAnUnknownField(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	resetCases(t)
	seedAdmin(t, "sub-staff")
	t.Setenv("SUPPORT_AUTOSEND", "off")

	testsupport.MustExec(t, `INSERT INTO support_cases
		(ticket_number, user_email, subject, status, updated_at) VALUES
		('900110', 'cara@example.com', 'one',   'open', now()),
		('900111', 'cara@example.com', 'two',   'open', now() - interval '1 hour'),
		('900112', 'abe@example.com',  'three', 'open', now() - interval '2 hours')`)
	testsupport.MustExec(t, `INSERT INTO support_messages (ticket_number, kind, body_text, created_at) VALUES
		('900110', 'user', 'a', now() - interval '1 hour'),
		('900111', 'user', 'b', now() - interval '9 days'),
		('900112', 'user', 'c', now() - interval '2 hours')`)

	app := adminSupportApp("sub-staff")

	read := func(query string) AdminQueueResponse {
		t.Helper()
		status, body := getJSON(t, app, "/admin/support/queue"+query)
		if status != fiber.StatusOK {
			t.Fatalf("%s: got %d (body: %s)", query, status, body)
		}
		var res AdminQueueResponse
		if err := json.Unmarshal([]byte(body), &res); err != nil {
			t.Fatalf("decode %s: %v", query, err)
		}
		return res
	}

	if got := read("?sort=tickets&dir=desc").People[0].Key; got != "cara@example.com" {
		t.Errorf("sort=tickets desc put %q first, want the person with two tickets", got)
	}
	if got := read("?sort=tickets&dir=asc").People[0].Key; got != "abe@example.com" {
		t.Errorf("sort=tickets asc put %q first, want the person with one ticket", got)
	}
	if got := read("?sort=name&dir=asc").People[0].Key; got != "abe@example.com" {
		t.Errorf("sort=name asc put %q first", got)
	}
	// Longest waiting is nine days, on Cara's second ticket.
	if got := read("?sort=waiting&dir=desc").People[0].Key; got != "cara@example.com" {
		t.Errorf("sort=waiting desc put %q first", got)
	}

	// By ticket, the raw list: three rows, still sorted by the server.
	byTicket := read("?rows=ticket&sort=last_wrote&dir=asc")
	if len(byTicket.Rows) != 3 || byTicket.Rows[0].TicketNumber != "900111" {
		t.Errorf("rows=ticket asc: got %d rows starting at %q, want 3 starting at the oldest (900111)",
			len(byTicket.Rows), firstTicket(byTicket.Rows))
	}

	// The search box is server-side too.
	found := read("?q=abe@example.com")
	if len(found.People) != 1 || found.People[0].Key != "abe@example.com" {
		t.Errorf("q= narrowed to %v, want just Abe", sectionsOf(found.People))
	}

	for _, bad := range []string{"?sort=whenever", "?sort=name&dir=sideways", "?rows=whatever"} {
		if status, _ := getJSON(t, app, "/admin/support/queue"+bad); status != fiber.StatusBadRequest {
			t.Errorf("%s: got %d, want 400", bad, status)
		}
	}
}

func firstTicket(rows []AdminQueueRow) string {
	if len(rows) == 0 {
		return ""
	}
	return rows[0].TicketNumber
}
