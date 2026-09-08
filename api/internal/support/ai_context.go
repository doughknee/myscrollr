package support

import (
	"context"
	"fmt"
	"log"
	"strconv"
	"strings"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
)

// =============================================================================
// Per-ticket context for the AI (REL-244)
// =============================================================================
//
// The knowledge base says what Scrollr is. This file says who is writing and
// what they are running: their plan, their app version against the current
// one, their OS and monitors, and which widgets they have on the ticker.
//
// It is built server-side from what we already hold — the JWT's roles, the
// diagnostics blob the desktop attaches, user_widgets — and never from
// anything the user typed. Everything here is uncached prompt text, so each
// renderer keeps itself short.

// TicketContext is the "who is writing" block. A zero value renders as an
// honest "we don't know", which is what the anonymous marketing-site path
// gets.
type TicketContext struct {
	Tier           string // free | uplink | uplink_pro | uplink_ultimate | unknown
	AppVersion     string
	OS             string
	MonitorCount   int
	ChosenMonitors int
	Widgets        []WidgetContext
	HasDiagnostics bool
}

// WidgetContext is one of the user's widgets: what it is, and whether it
// reaches the ticker. Config is deliberately left out — symbols, feeds and
// leagues are the user's data, and the reply never needs them.
type WidgetContext struct {
	Type     string
	OnTicker bool
}

// buildTicketContext assembles the context for one ticket. logtoSub may be
// empty (anonymous path) — then only what the diagnostics blob carries is
// known. Best-effort throughout: a failed widget read costs a line of the
// prompt, never the ticket.
func buildTicketContext(ctx context.Context, logtoSub, tier string, diag map[string]interface{}) TicketContext {
	tc := TicketContext{Tier: displayTier(tier), HasDiagnostics: len(diag) > 0}
	tc.AppVersion, tc.OS = caseFieldsFromDiagnostics(diag)
	tc.MonitorCount, tc.ChosenMonitors = monitorCountsFromDiagnostics(diag)

	if logtoSub != "" && platform.DBPool != nil {
		widgets, err := platform.GetUserWidgets(logtoSub)
		if err != nil {
			log.Printf("[Triage] widgets for %s: %v", logtoSub, err)
		}
		for _, w := range widgets {
			if !w.Enabled {
				continue
			}
			tc.Widgets = append(tc.Widgets, WidgetContext{Type: w.WidgetType, OnTicker: w.TickerEnabled})
		}
	}
	_ = ctx
	return tc
}

// ticketContextFromCase rebuilds the context for a follow-up, where the
// message arrives from osTicket with no JWT and no diagnostics. The case row
// kept what we learned when the ticket was opened.
func ticketContextFromCase(ctx context.Context, ticketNumber string) TicketContext {
	if platform.DBPool == nil || ticketNumber == "" {
		return TicketContext{Tier: "unknown"}
	}
	var sub, tier, version, osName string
	err := platform.DBPool.QueryRow(ctx, `
		SELECT COALESCE(logto_sub,''), COALESCE(tier_at_open,''), COALESCE(app_version,''), COALESCE(os,'')
		FROM support_cases WHERE ticket_number = $1`, ticketNumber).Scan(&sub, &tier, &version, &osName)
	if err != nil {
		return TicketContext{Tier: "unknown"}
	}
	tc := buildTicketContext(ctx, sub, tier, nil)
	tc.AppVersion, tc.OS = version, osName
	// The opening message carried diagnostics if it told us a version.
	tc.HasDiagnostics = version != ""
	return tc
}

// displayTier normalises a JWT tier for the prompt. Super User is reported
// as Uplink Ultimate: POLICIES says the program is never named to a user and
// a Super User is drafted for as an Ultimate user, so the drafter is never
// told a name it must then remember not to say.
func displayTier(tier string) string {
	switch tier {
	case "":
		return "unknown"
	case "super_user":
		return "uplink_ultimate"
	default:
		return tier
	}
}

// monitorCountsFromDiagnostics reads how many screens are attached and how
// many the user picked for the ticker (empty chosen list means "the
// primary", which is one). Shape: environment.monitors[] /
// environment.chosenMonitors[] — see desktop/src-tauri/src/commands/diagnostics.rs.
func monitorCountsFromDiagnostics(diag map[string]interface{}) (attached, chosen int) {
	env, _ := diag["environment"].(map[string]interface{})
	if env == nil {
		return 0, 0
	}
	list, _ := env["monitors"].([]interface{})
	attached = len(list)
	picked, _ := env["chosenMonitors"].([]interface{})
	chosen = len(picked)
	if chosen == 0 && attached > 0 {
		chosen = 1
	}
	return attached, chosen
}

// render writes the context block. Version handling is the point of it, but
// only as a DIAGNOSTIC: knowing somebody is three releases behind narrows the
// problem. It is not permission to tell them updating is the answer — that
// claim needs the FIX ON RECORD block (REL-259).
func (tc TicketContext) render() string {
	var b strings.Builder
	b.WriteString("WHO IS WRITING (server-side facts, not the user's claims)\n")
	fmt.Fprintf(&b, "Plan: %s\n", tc.Tier)

	current := currentDesktopVersion()
	if current == "" {
		current = "unknown"
	}
	switch {
	case tc.AppVersion == "":
		fmt.Fprintf(&b, "App version: unknown. Current release is %s.\n", current)
	case compareVersions(tc.AppVersion, current) < 0:
		fmt.Fprintf(&b, "Current release is %s; this user is on %s. THEY ARE OUT OF DATE.\n", current, tc.AppVersion)
		b.WriteString("That is a useful diagnostic and nothing more. Do NOT tell them updating will " +
			"fix what they reported unless the FIX ON RECORD block below names a version; the release " +
			"notes do not record which report a change closed.\n")
	default:
		fmt.Fprintf(&b, "Current release is %s; this user is on %s. They are up to date.\n", current, tc.AppVersion)
	}

	if tc.OS != "" {
		fmt.Fprintf(&b, "Operating system: %s\n", tc.OS)
	} else {
		b.WriteString("Operating system: unknown\n")
	}
	if tc.MonitorCount > 0 {
		fmt.Fprintf(&b, "Monitors: %d attached, %d chosen for the ticker\n", tc.MonitorCount, tc.ChosenMonitors)
	}

	if len(tc.Widgets) == 0 {
		b.WriteString("Widgets: none known (anonymous or no widgets added)\n")
	} else {
		onTicker := 0
		for _, w := range tc.Widgets {
			if w.OnTicker {
				onTicker++
			}
		}
		fmt.Fprintf(&b, "Widgets (%d added, %d on the ticker):\n", len(tc.Widgets), onTicker)
		for _, w := range tc.Widgets {
			where := "not on the ticker"
			if w.OnTicker {
				where = "on the ticker"
			}
			fmt.Fprintf(&b, "  - %s (%s)\n", w.Type, where)
		}
	}

	if !tc.HasDiagnostics {
		b.WriteString("No diagnostics were attached to this ticket.\n")
	}
	return b.String()
}

// compareVersions compares dotted numeric versions. Returns -1 when a is
// older. Non-numeric junk sorts as 0, so "1.6.2-beta" reads as 1.6.2 and a
// version we cannot parse never claims to be newer than one we can.
func compareVersions(a, b string) int {
	as, bs := strings.Split(a, "."), strings.Split(b, ".")
	for i := 0; i < len(as) || i < len(bs); i++ {
		av, bv := versionPart(as, i), versionPart(bs, i)
		if av != bv {
			if av < bv {
				return -1
			}
			return 1
		}
	}
	return 0
}

func versionPart(parts []string, i int) int {
	if i >= len(parts) {
		return 0
	}
	digits := strings.TrimLeft(parts[i], "v")
	if cut := strings.IndexFunc(digits, func(r rune) bool { return r < '0' || r > '9' }); cut >= 0 {
		digits = digits[:cut]
	}
	n, _ := strconv.Atoi(digits)
	return n
}

// renderFixRecord is the FIX ON RECORD block: the one place in the prompt
// permitted to say a fix exists, and the one place the drafter may read that
// from (REL-259). It is a server-computed fact, never something to infer.
//
// staleDays is how long ago the user last wrote. Past the threshold with no
// proven fix the only honest reply is a question, and the block says so in the
// same voice the needs_info branch uses.
func renderFixRecord(pf *ProvenFix, staleDays int, userVersion string) string {
	var b strings.Builder
	b.WriteString("FIX ON RECORD (server-computed; the ONLY thing that permits a fix claim)\n")

	if pf == nil {
		b.WriteString("None. No shipped fix is on record for this report.\n" +
			"You may NOT say this was fixed, name a version as the remedy, or tell them to update as " +
			"the answer. Asking which version they are running to narrow the problem is a different " +
			"thing and is fine. If you think it may be fixed, ASK whether it is still happening " +
			"rather than asserting that it is not.\n")
		if staleDays >= staleTicketDays() {
			fmt.Fprintf(&b, "\nTHIS TICKET IS %d DAYS OLD and nothing is on record as fixing it. Do not\n"+
				"troubleshoot and do not guess. The reply is ONE short paragraph, then the sign-off:\n"+
				"apologise briefly for the wait, say that several updates have shipped since they wrote\n"+
				"in, and ask whether it is still happening and which version of Scrollr they are on now.\n"+
				"List both of those in ask_user_for.\n", staleDays)
		}
		return b.String()
	}

	fmt.Fprintf(&b, "This user's report is linked to %s, which shipped in Scrollr %s.\n",
		pf.IssueKey, pf.Version)
	fmt.Fprintf(&b, "You MAY say the fix for what they reported went out in %s and point them at the "+
		"update. Never put the issue key in the reply.\n", pf.Version)
	if userVersion != "" && compareVersions(userVersion, pf.Version) >= 0 {
		fmt.Fprintf(&b, "They are already on %s, which carries that fix, so updating is NOT the answer "+
			"for them. Say the fix shipped in %s and ask what they are still seeing.\n",
			userVersion, pf.Version)
	}
	return b.String()
}

// renderSimilarCases writes the "what we sent last time" block. The body is
// the SENT copy, so when the partner edited the draft before sending, the
// reference is the partner's words rather than the AI's.
func renderSimilarCases(cases []SimilarCase) string {
	if len(cases) == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString("SIMILAR PAST CASES — what we actually sent. Use them for approach and tone.\n" +
		"NEVER copy one verbatim: the details in it belong to a different user.\n")
	for i, c := range cases {
		fmt.Fprintf(&b, "%d. %s\n   they wrote: %s\n   we sent: %s\n",
			i+1, truncate(c.Subject, 120), truncate(c.UserWrote, 600), truncate(c.WeSent, 900))
	}
	return b.String()
}

// renderThread writes the whole conversation so far for a follow-up. Drafts
// that were never sent are left out — what matters is what the user has
// actually read.
func renderThread(msgs []SupportMessage) string {
	if len(msgs) == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString("THE CONVERSATION SO FAR, oldest first:\n")
	for _, m := range msgs {
		who := "The user wrote"
		if m.Kind == "sent" {
			who = "We replied"
		}
		fmt.Fprintf(&b, "- %s: %s\n", who, truncate(m.BodyText, 800))
	}
	return b.String()
}

func truncate(s string, n int) string {
	s = strings.Join(strings.Fields(s), " ")
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
