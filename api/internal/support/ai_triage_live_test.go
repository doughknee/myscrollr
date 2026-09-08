package support

import (
	"context"
	"encoding/json"
	"os"
	"regexp"
	"strings"
	"testing"
)

// =============================================================================
// The live triage test — real models, five real tickets
// =============================================================================
//
// Gated on ANTHROPIC_API_KEY, so it skips in CI and on any box without the
// key. It exists because the golden tests prove what we ASK for, and this is
// the only thing that proves what comes back.
//
// The five are the worst real drafts the pipeline has produced (see
// testdata/live_tickets.json). Each carries the mistake it made last time as
// an assertion. Bodies are the users' own words with the diagnostics block
// stripped; the parsed facts live in the context instead, so no log paths,
// hostnames or email addresses reach this repository. Plans and widget lists
// are reconstructed — these rows were backfilled from osTicket and never had
// them.
//
//	go test ./internal/support -run TestLiveTriage -v

type liveFixture struct {
	Ticket         string   `json:"ticket"`
	Note           string   `json:"note"`
	Category       string   `json:"category"`
	Subject        string   `json:"subject"`
	Widget         string   `json:"widget"`
	Body           string   `json:"body"`
	MustNotContain []string `json:"must_not_contain"`
	MustContain    []string `json:"must_contain"`
	Context        struct {
		Tier           string `json:"tier"`
		AppVersion     string `json:"app_version"`
		OS             string `json:"os"`
		Monitors       int    `json:"monitors"`
		Chosen         int    `json:"chosen"`
		HasDiagnostics bool   `json:"has_diagnostics"`
		Widgets        []struct {
			Type     string `json:"type"`
			OnTicker bool   `json:"on_ticker"`
		} `json:"widgets"`
	} `json:"context"`
}

// bannedInReplies is everything a user must never read, from POLICIES plus
// the data-provider names and quotas the brief singles out.
var bannedInReplies = regexp.MustCompile(`(?i)\b(sequin|logto|coolify|kubernetes|k8s|digitalocean|osticket|redis|postgres|api-sports|api-football|twelvedata|kalshi api|rate limit|quota|super user)\b`)

var dashOrDollar = regexp.MustCompile(`[—–]|\$\d`)

func TestLiveTriage(t *testing.T) {
	if os.Getenv("ANTHROPIC_API_KEY") == "" {
		t.Skip("ANTHROPIC_API_KEY not set; skipping the live triage test")
	}

	raw, err := os.ReadFile("testdata/live_tickets.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures []liveFixture
	if err := json.Unmarshal(raw, &fixtures); err != nil {
		t.Fatal(err)
	}

	current := currentDesktopVersion()
	var total TriageUsage

	for _, f := range fixtures {
		t.Run(f.Ticket, func(t *testing.T) {
			tc := TicketContext{
				Tier: f.Context.Tier, AppVersion: f.Context.AppVersion, OS: f.Context.OS,
				MonitorCount: f.Context.Monitors, ChosenMonitors: f.Context.Chosen,
				HasDiagnostics: f.Context.HasDiagnostics,
			}
			for _, w := range f.Context.Widgets {
				tc.Widgets = append(tc.Widgets, WidgetContext{Type: w.Type, OnTicker: w.OnTicker})
			}

			res := triageTicket(context.Background(), TriageInput{
				UserCategory: f.Category,
				UserEmail:    "user@example.com",
				UserName:     "User",
				Subject:      f.Subject,
				Body:         f.Body,
				Widget:       f.Widget,
				Similar:      []SimilarCase{},
				Context:      tc,
			})
			if res == nil {
				t.Fatalf("triage returned nil for #%s", f.Ticket)
			}

			total.ClassifyIn += res.Usage.ClassifyIn
			total.ClassifyOut += res.Usage.ClassifyOut
			total.DraftIn += res.Usage.DraftIn
			total.DraftOut += res.Usage.DraftOut
			total.CacheRead += res.Usage.CacheRead
			total.CacheWrite += res.Usage.CacheWrite

			t.Logf("\n#%s  %s\ncategory=%s priority=%s confidence=%s needs_info=%t should_close=%t\n"+
				"grounded_in=%v\nunknowns=%v\nask_user_for=%v\ninternal_note=%q\nusage: %s\n\n%s\n",
				f.Ticket, f.Note, res.Category, res.Priority, res.Confidence, res.NeedsInfo,
				res.ShouldClose, res.GroundedIn, res.Unknowns, res.AskUserFor, res.InternalNote,
				res.Usage, res.DraftReplyHTML)

			if strings.TrimSpace(res.DraftReplyHTML) == "" {
				t.Fatal("no draft body")
			}
			reply := res.DraftReplyHTML
			lower := strings.ToLower(reply)

			for _, banned := range f.MustNotContain {
				if strings.Contains(lower, strings.ToLower(banned)) {
					t.Errorf("draft contains %q, which it must not:\n%s", banned, reply)
				}
			}
			for _, must := range f.MustContain {
				want := strings.ReplaceAll(must, "{{CURRENT_VERSION}}", current)
				if !strings.Contains(reply, want) {
					t.Errorf("draft does not name %q:\n%s", want, reply)
				}
			}
			if m := bannedInReplies.FindString(reply); m != "" {
				t.Errorf("draft names something internal (%q):\n%s", m, reply)
			}
			if m := dashOrDollar.FindString(reply); m != "" {
				t.Errorf("draft contains a dash or a price (%q):\n%s", m, reply)
			}
			if !strings.Contains(reply, "Best Regards,") || !strings.Contains(reply, "Scrollr Support") {
				t.Errorf("draft is missing the sign-off:\n%s", reply)
			}
			if len(res.GroundedIn) == 0 && res.Confidence == "high" {
				t.Errorf("a high-confidence draft that rests on nothing:\n%s", reply)
			}
			if res.NeedsInfo && len(res.AskUserFor) == 0 {
				t.Error("needs_info is set but the draft asks the user for nothing")
			}
		})
	}

	t.Logf("TOTAL over %d tickets: %s", len(fixtures), total)
}
