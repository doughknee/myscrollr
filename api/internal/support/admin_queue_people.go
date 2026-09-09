package support

import (
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
)

// =============================================================================
// The queue, as people rather than tickets (REL-266)
// =============================================================================
//
// REL-263 shipped sixty tickets at equal visual weight, and the verdict on it
// was "just so confusing and overwhelming". Two things were wrong, and both
// are decided here rather than in the browser.
//
// A row is a PERSON. Rachel Armstrong wrote five times in one afternoon; that
// was five rows shouting at a reader who has one human to answer. Cases are
// grouped by `user_email`, which is also why the key is an email and not an
// account: #819835 arrived anonymously from the marketing site, has no
// logto_sub, and still belongs in the queue. A group carries a name and a plan
// only when one actually exists — an invented "Anonymous User" reads exactly
// like a real one.
//
// PAYING CUSTOMERS ARE A SECTION, not a sort key. Priority support was sold,
// so no ordering a reader picks may push a paying customer below someone who
// did not pay. The plan comes from the CURRENT subscription in
// `stripe_customers`, never from `support_cases.tier_at_open` — that column
// records the plan on the day the ticket opened, so someone who upgraded last
// week would sit in the wrong section forever, and someone who lapsed would be
// promoted for a ticket they wrote while paying. `plan = 'free'` is excluded:
// production has three `active` stripe rows and only two of them are paying.

const (
	sectionPaying   = "paying"
	sectionOpen     = "open"
	sectionAnswered = "answered"
	sectionResolved = "resolved"
)

// sectionOrder is the reading order, and it is the whole point: sorting
// happens INSIDE a section and sections never move.
var sectionOrder = []string{sectionPaying, sectionOpen, sectionAnswered, sectionResolved}

const (
	sortLastWrote = "last_wrote"
	sortWaiting   = "waiting"
	sortTickets   = "tickets"
	sortPlan      = "plan"
	sortName      = "name"
)

// sortFields is also the vocabulary the endpoint validates against. An
// unrecognised sort is a 400 and never a silent fallback to some other order:
// a list that quietly ignores what you asked it for is the reason the old page
// needed a client-side array sort in the first place.
var sortFields = []string{sortLastWrote, sortWaiting, sortTickets, sortPlan, sortName}

// defaultDirection is what each field means when nobody says. "Longest
// waiting, ascending" is a sentence nobody should have to think about; every
// field's natural reading is its default and the direction button flips it.
func defaultDirection(field string) string {
	if field == sortName {
		return "asc"
	}
	return "desc"
}

// planIsPaying is the one rule that decides the top section.
//
// Lifetime counts even though a lifetime row has no live subscription status —
// the Ultimate lifetime purchase is the largest single thing anyone has paid
// us, and reading it as unpaid because Stripe has nothing left to renew would
// put the best customer we have in the general queue.
func planIsPaying(plan, status string, lifetime bool) bool {
	p := strings.ToLower(strings.TrimSpace(plan))
	if p == "" || p == "free" {
		return false
	}
	if lifetime {
		return true
	}
	return strings.EqualFold(strings.TrimSpace(status), "active")
}

// AdminQueueAccounts is the caption under the paying section, and the reason
// that section can be empty while two people are paying.
//
// It exists because production says something the mockup did not: only ONE of
// fifty-nine cases carries a logto_sub, and it is not one of the two paying
// accounts. Support tickets arrive from the marketing form and from osTicket,
// neither of which has a signed-in user, so almost nothing in this table is
// joined to an account at all. An empty paying section is therefore the
// truthful answer — and an empty box with no sentence in it reads as a bug in
// the page rather than as a gap in the data.
type AdminQueueAccounts struct {
	Paying           int    `json:"paying"`
	CasesWithAccount int    `json:"cases_with_account"`
	Cases            int    `json:"cases"`
	Note             string `json:"note"`
}

// payingSectionNote says, in a sentence, what an empty paying section means.
func payingSectionNote(a AdminQueueAccounts, inSection int) string {
	switch {
	case a.Paying == 0:
		return "Nobody is on a paid plan right now, so this section has nothing to hold."
	case inSection > 0:
		return ""
	default:
		who := fmt.Sprintf("%d accounts are paying, and none of them has", a.Paying)
		if a.Paying == 1 {
			who = "One account is paying, and it has not"
		}
		return fmt.Sprintf(
			"%s written in under an account we can see. Only %d of %d cases carry a signed-in user at all — the marketing form and osTicket both arrive without one — so a paying customer only lands here if they wrote from inside the app.",
			who, a.CasesWithAccount, a.Cases)
	}
}

// AdminPerson is one row of the queue: an email, everything we honestly know
// about whoever is behind it, and the tickets they wrote.
//
// The tickets are referenced by number rather than embedded. The flat rows are
// in the same response, so embedding them would ship every case twice and give
// the two copies somewhere to disagree.
type AdminPerson struct {
	// Key groups the cases. It is the lowercased email; a case with no email
	// gets a key of its own so two unrelated anonymous reports never merge
	// into one imaginary person.
	Key   string `json:"key"`
	Email string `json:"email,omitempty"`
	// Name is whatever the ticket carried. Empty means we do not know it, and
	// the page says so rather than inventing one.
	Name string `json:"name,omitempty"`
	// Plan is the CURRENT subscription plan, and is empty when no Stripe row
	// stands behind this email. Never tier_at_open.
	Plan   string `json:"plan,omitempty"`
	Paying bool   `json:"paying"`
	// PlanNote explains an empty Plan, because "free" and "no account exists
	// for this person" are different facts and only one of them is a plan.
	PlanNote string `json:"plan_note,omitempty"`

	Section string `json:"section"`

	Tickets  int `json:"tickets"`
	NeedsYou int `json:"needs_you"`
	Waiting  int `json:"waiting"`
	Handled  int `json:"handled"`

	// Headline is the one ticket this row is about — the one a reader would
	// open. Everything else is history underneath it.
	Headline       string `json:"headline,omitempty"`
	HeadlineTicket string `json:"headline_ticket,omitempty"`

	// Provenance is who is responsible for the last reply that went out,
	// decided here from the draft's status, its disposition and whether an
	// edit replaced the body. The browser renders ProvenanceLabel and works
	// none of it out.
	Provenance      string `json:"provenance,omitempty"`
	ProvenanceLabel string `json:"provenance_label,omitempty"`

	LastUserMessageAt *time.Time        `json:"last_user_message_at,omitempty"`
	WaitingHours      platform.Measured `json:"waiting_hours"`

	TicketNumbers []string `json:"ticket_numbers"`
}

// ===== Provenance =================================================

const (
	provenanceBot    = "bot"
	provenanceEdited = "edited"
	provenancePerson = "person"
)

// replyProvenance says who is responsible for the reply that went out.
//
// It reads exactly the three things the row already records. `edited` is the
// status claimDraft writes when a person rewrote the body, and edited_body_html
// is checked as well because a draft can also be edited through the older
// approval endpoint. Everything the autonomous sweeper sends lands as
// `approved` or `asked` with `intervened` still false — that, and only that,
// is the bot.
func replyProvenance(draftStatus, disposition, draftBody, editedBody string, intervened bool) (string, string) {
	switch draftStatus {
	case "sent", "approved", "edited", "asked":
	default:
		return "", ""
	}

	edited := strings.TrimSpace(editedBody) != "" &&
		strings.TrimSpace(editedBody) != strings.TrimSpace(draftBody)
	if draftStatus == "edited" || edited {
		return provenanceEdited, "you edited it"
	}

	autonomous := disposition == dispositionAutoSend ||
		disposition == dispositionAutoClose ||
		disposition == dispositionAutoAsk
	if autonomous && !intervened {
		return provenanceBot, "sent by the bot"
	}
	return provenancePerson, "you sent it"
}

// ===== Sections ===================================================

// caseSection places one ticket. Paying wins over everything: it is the
// promise we sold, not the state of this particular ticket.
func caseSection(group string, paying bool) string {
	if paying {
		return sectionPaying
	}
	switch group {
	case queueNeedsYou:
		return sectionOpen
	case queueWaiting:
		return sectionAnswered
	default:
		return sectionResolved
	}
}

// ===== Grouping ===================================================

// groupPeople turns the flat case rows into one row per person.
//
// The order rows arrive in does not matter — sortPeople decides the order —
// but the grouping is deterministic, so two reads of unchanged data produce
// the same keys and the same headline.
func groupPeople(rows []AdminQueueRow) []AdminPerson {
	byKey := map[string]*AdminPerson{}
	order := make([]string, 0, len(rows))

	// best holds the winning headline candidate per key, so the choice does
	// not depend on the order rows arrive in.
	type candidate struct {
		rank int
		at   time.Time
	}
	best := map[string]candidate{}

	for _, r := range rows {
		key := personKey(r)
		p := byKey[key]
		if p == nil {
			p = &AdminPerson{
				Key:           key,
				Email:         r.UserEmail,
				TicketNumbers: make([]string, 0, 2),
				WaitingHours: platform.Unmeasured(
					"No message from this person is on record, so there is nothing to measure a wait from."),
			}
			if r.UserEmail == "" {
				p.PlanNote = "No account is attached to this ticket — it arrived without a signed-in user, so there is no name and no plan to show."
			}
			byKey[key] = p
			order = append(order, key)
		}

		p.Tickets++
		p.TicketNumbers = append(p.TicketNumbers, r.TicketNumber)
		switch r.Group {
		case queueNeedsYou:
			p.NeedsYou++
		case queueWaiting:
			p.Waiting++
		default:
			p.Handled++
		}

		// The name and the plan come from whichever ticket actually carries
		// them. Someone who wrote once signed in and once through the
		// marketing form is still one person, and the half of the record that
		// knows their name is the half worth keeping.
		if p.Name == "" && r.Name != "" {
			p.Name = r.Name
		}
		if r.Paying {
			p.Paying = true
		}
		if p.Plan == "" && r.Plan != "" {
			p.Plan = r.Plan
		}

		if r.LastUserMessageAt != nil &&
			(p.LastUserMessageAt == nil || r.LastUserMessageAt.After(*p.LastUserMessageAt)) {
			p.LastUserMessageAt = r.LastUserMessageAt
		}
		// The wait shown is the LONGEST any of their tickets has waited, not
		// the freshest. Someone with a five-day-old question and a new one has
		// been waiting five days.
		if r.WaitingHours.Available &&
			(!p.WaitingHours.Available || r.WaitingHours.Value > p.WaitingHours.Value) {
			p.WaitingHours = platform.Measured{Value: r.WaitingHours.Value, Available: true}
		}

		c := candidate{rank: headlineRank(r.Group), at: r.UpdatedAt}
		if prev, seen := best[key]; !seen || c.rank > prev.rank ||
			(c.rank == prev.rank && c.at.After(prev.at)) {
			best[key] = c
			p.Headline = r.Subject
			p.HeadlineTicket = r.TicketNumber
			p.Provenance, p.ProvenanceLabel = r.Provenance, r.ProvenanceLabel
		}
	}

	out := make([]AdminPerson, 0, len(order))
	for _, key := range order {
		p := byKey[key]
		p.Section = personSection(*p)
		out = append(out, *p)
	}
	return out
}

// personKey groups by email, and refuses to group without one.
func personKey(r AdminQueueRow) string {
	email := strings.ToLower(strings.TrimSpace(r.UserEmail))
	if email == "" {
		// Not a shared "anonymous" bucket: two anonymous reports are two
		// different people until something says otherwise, and merging them
		// would put one stranger's words under another's row.
		return "ticket:" + r.TicketNumber
	}
	return email
}

// headlineRank ranks the three states by how much a reader needs to see them.
func headlineRank(group string) int {
	switch group {
	case queueNeedsYou:
		return 2
	case queueWaiting:
		return 1
	default:
		return 0
	}
}

func personSection(p AdminPerson) string {
	switch {
	case p.Paying:
		return sectionPaying
	case p.NeedsYou > 0:
		return sectionOpen
	case p.Waiting > 0:
		return sectionAnswered
	default:
		return sectionResolved
	}
}

// ===== Sorting ====================================================

// sortKey is the only thing either comparator reads, so a person and a single
// ticket sort by exactly the same rules.
type sortKey struct {
	LastWrote *time.Time
	Wait      platform.Measured
	Tickets   int
	Paying    bool
	Plan      string
	Name      string
	Tie       string
}

func personSortKey(p AdminPerson) sortKey {
	return sortKey{
		LastWrote: p.LastUserMessageAt, Wait: p.WaitingHours, Tickets: p.Tickets,
		Paying: p.Paying, Plan: p.Plan, Name: p.Name, Tie: p.Key,
	}
}

func rowSortKey(r AdminQueueRow) sortKey {
	return sortKey{
		LastWrote: r.LastUserMessageAt, Wait: r.WaitingHours, Tickets: 1,
		Paying: r.Paying, Plan: r.Plan, Name: r.Name, Tie: r.TicketNumber,
	}
}

// lessBy answers "does a come before b" for one field in one direction.
//
// Every field puts the unknowns last in BOTH directions. A person with no
// message on record has not been waiting zero hours, and reversing the sort
// must not float "we do not know" to the top as though it were the extreme
// value — that is the same lie as a countdown against a paused pipeline.
func lessBy(a, b sortKey, field, dir string) bool {
	asc := dir == "asc"
	switch field {
	case sortWaiting:
		if a.Wait.Available != b.Wait.Available {
			return a.Wait.Available
		}
		if a.Wait.Available && a.Wait.Value != b.Wait.Value {
			return flip(a.Wait.Value < b.Wait.Value, asc)
		}
	case sortTickets:
		if a.Tickets != b.Tickets {
			return flip(a.Tickets < b.Tickets, asc)
		}
	case sortPlan:
		if a.Paying != b.Paying {
			return flip(!a.Paying, asc)
		}
		if (a.Plan == "") != (b.Plan == "") {
			return a.Plan != ""
		}
		if !strings.EqualFold(a.Plan, b.Plan) {
			return flip(strings.ToLower(a.Plan) < strings.ToLower(b.Plan), asc)
		}
	case sortName:
		if (a.Name == "") != (b.Name == "") {
			return a.Name != ""
		}
		if !strings.EqualFold(a.Name, b.Name) {
			return flip(strings.ToLower(a.Name) < strings.ToLower(b.Name), asc)
		}
	default: // sortLastWrote
		if (a.LastWrote == nil) != (b.LastWrote == nil) {
			return a.LastWrote != nil
		}
		if a.LastWrote != nil && !a.LastWrote.Equal(*b.LastWrote) {
			return flip(a.LastWrote.Before(*b.LastWrote), asc)
		}
	}
	// A stable tiebreak, so the list does not shuffle between two reads of
	// data that did not change.
	return a.Tie < b.Tie
}

func flip(less, asc bool) bool {
	if asc {
		return less
	}
	return !less
}

// sortPeople orders rows INSIDE each section and never across them. The
// section index is compared first, which is what makes "paying customers never
// fall below anyone" true of every sort rather than only of the default one.
func sortPeople(people []AdminPerson, field, dir string) {
	rank := sectionRanks()
	sort.SliceStable(people, func(i, j int) bool {
		if a, b := rank[people[i].Section], rank[people[j].Section]; a != b {
			return a < b
		}
		return lessBy(personSortKey(people[i]), personSortKey(people[j]), field, dir)
	})
}

func sortRows(rows []AdminQueueRow, field, dir string) {
	rank := sectionRanks()
	sort.SliceStable(rows, func(i, j int) bool {
		if a, b := rank[rows[i].Section], rank[rows[j].Section]; a != b {
			return a < b
		}
		return lessBy(rowSortKey(rows[i]), rowSortKey(rows[j]), field, dir)
	})
}

func sectionRanks() map[string]int {
	rank := make(map[string]int, len(sectionOrder))
	for i, s := range sectionOrder {
		rank[s] = i
	}
	return rank
}

// ===== Query parameters ===========================================

// normaliseSort validates the two sort parameters. Both are server-side on
// purpose: a client-side array sort is only correct while the whole list is in
// the browser, and the moment this queue outgrows one read it would start
// sorting a page instead of a queue and look right doing it.
func normaliseSort(field, dir string) (string, string, bool) {
	field = strings.TrimSpace(field)
	if field == "" {
		field = sortLastWrote
	}
	known := false
	for _, f := range sortFields {
		if f == field {
			known = true
			break
		}
	}
	if !known {
		return "", "", false
	}
	dir = strings.TrimSpace(dir)
	if dir == "" {
		dir = defaultDirection(field)
	}
	if dir != "asc" && dir != "desc" {
		return "", "", false
	}
	return field, dir, true
}

// matchesSearch is the search box, decided here rather than by filtering an
// array in the browser, for the same reason the sort is.
func matchesSearch(r AdminQueueRow, q string) bool {
	if q == "" {
		return true
	}
	q = strings.ToLower(q)
	for _, field := range []string{r.TicketNumber, r.Subject, r.UserEmail, r.Name, r.Summary, r.Category} {
		if strings.Contains(strings.ToLower(field), q) {
			return true
		}
	}
	return false
}
