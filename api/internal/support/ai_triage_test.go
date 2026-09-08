package support

import (
	"flag"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// The prompts ARE the product here: everything the AI says to a user is
// decided by what these builders put in front of it. Golden files make a
// wording change show up as a reviewable diff instead of as a support reply
// nobody reads until a user complains.

var updateGolden = flag.Bool("update", false, "rewrite the prompt golden files")

// goldenFixtures are the three shapes the pipeline actually sees: a signed-in
// bug report with diagnostics, an anonymous note from the marketing site, and
// a follow-up on a ticket we already answered.
func goldenFixtures() map[string]TriageInput {
	knownIssues := buildKnownIssuesBlock(
		[]openIssue{
			{Key: "REL-216", Title: "Segmented rows lose focus after a search jump",
				Description: "After jumping to a result in Settings search, the segmented control steals focus back.",
				Priority:    "high", Labels: []string{"bug"}},
			{Key: "REL-235", Title: "Standings flap between a value and a dash on live games",
				Priority: "urgent", Labels: []string{"bug", "ticker"}},
		},
		[]shippedRelease{{
			Tag: "desktop-v1.6.2", Name: "Scrollr 1.6.2 — Pin what matters", Date: "2026-09-08",
			Body: "A pin is one chip that stays put. Two pins, on purpose.",
		}},
	)

	similar := []SimilarCase{{
		TicketNumber: "700001",
		Subject:      "Bug Report: scores stopped updating",
		UserWrote:    "My scores froze in the 6th inning and never moved.",
		WeSent:       "Thanks for flagging that. The game was stuck on our side, not yours, and it is moving again now.",
	}}

	signedIn := TriageInput{
		UserCategory: "bug",
		UserEmail:    "someone@example.com",
		UserName:     "Someone",
		Subject:      "Bug Report: scores are stuck in the 6th inning",
		Body:         "<p>The MLB scores on my ticker have not moved in hours.</p>",
		Widget:       "MLB",
		RecentSummaries: []RecentTicketSummary{
			{TicketNumber: "700001", Category: "bug", Summary: "scores stopped updating", CreatedAt: "2026-09-01T00:00:00Z"},
		},
		KnownIssues: knownIssues,
		Similar:     similar,
		Context: TicketContext{
			Tier: "uplink_pro", AppVersion: "1.6.0", OS: "Windows 11 (26200)",
			MonitorCount: 2, ChosenMonitors: 1, HasDiagnostics: true,
			Widgets: []WidgetContext{
				{Type: "sports", OnTicker: true},
				{Type: "finance", OnTicker: false},
			},
		},
	}

	anonymous := TriageInput{
		UserCategory:    "feedback",
		UserEmail:       "curious@example.com",
		UserName:        "curious",
		Subject:         "[Feedback] Do you have a Linux build?",
		Body:            "Just curious whether Scrollr runs on Linux.",
		RecentSummaries: nil,
		KnownIssues:     knownIssues,
		Similar:         nil,
		Context:         TicketContext{Tier: "unknown"},
	}

	followUp := TriageInput{
		UserEmail:         "someone@example.com",
		UserName:          "Someone",
		Subject:           "Re: Bug Report: scores are stuck in the 6th inning",
		Body:              "<p>That did not help, it is still stuck.</p>",
		IsReply:           true,
		ReplyTicketNumber: "700042",
		KnownIssues:       knownIssues,
		Similar:           similar,
		Thread: []SupportMessage{
			{Kind: "user", BodyText: "The MLB scores on my ticker have not moved in hours.", CreatedAt: time.Unix(0, 0)},
			{Kind: "sent", BodyText: "Thanks for flagging that. Try toggling the widget off and on.", CreatedAt: time.Unix(1, 0)},
		},
		Context: TicketContext{
			Tier: "free", AppVersion: currentDesktopVersion(), OS: "Windows 11 (26200)", HasDiagnostics: true,
		},
	}

	return map[string]TriageInput{"signed_in": signedIn, "anonymous": anonymous, "follow_up": followUp}
}

func TestPromptGoldens(t *testing.T) {
	cls := &classification{
		Category: "bug", Priority: "high", Summary: "MLB scores frozen mid-game",
		Widget: "MLB", DuplicateOf: "700001", ShouldClose: false, NeedsInfo: false,
	}
	needsInfoCls := &classification{
		Category: "bug", Priority: "normal", Summary: "login required on every launch", NeedsInfo: true,
	}

	for name, in := range goldenFixtures() {
		t.Run(name, func(t *testing.T) {
			checkGolden(t, name+"_classify.txt", buildClassifyPrompt(in))
			checkGolden(t, name+"_draft.txt", buildDraftPrompt(in, cls))
		})
	}

	// The ask-for-information branch is the one that changes the shape of
	// the reply rather than its content, so it gets its own golden.
	in := goldenFixtures()["anonymous"]
	checkGolden(t, "needs_info_draft.txt", buildDraftPrompt(in, needsInfoCls))
}

// checkGolden compares against testdata, with the current release number
// masked: the KB names it, it moves every release, and a golden that has to
// be regenerated on every release is a golden nobody reads.
func checkGolden(t *testing.T, name, got string) {
	t.Helper()
	got = strings.ReplaceAll(got, currentDesktopVersion(), "{{CURRENT_VERSION}}")
	path := filepath.Join("testdata", name)
	if *updateGolden {
		if err := os.WriteFile(path, []byte(got), 0o644); err != nil {
			t.Fatal(err)
		}
		return
	}
	want, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("%v (run: go test ./internal/support -run TestPromptGoldens -update)", err)
	}
	if string(want) != got {
		t.Errorf("%s changed.\n--- want ---\n%s\n--- got ---\n%s", name, want, got)
	}
}

// The system prompt is the cached half. If it stops being byte-identical
// between calls, every ticket pays full price for 70 KB of knowledge base.
func TestSystemPromptIsStableAndComplete(t *testing.T) {
	a, b := triageSystemPrompt(), triageSystemPrompt()
	if a != b {
		t.Fatal("system prompt is not stable between calls; the prompt cache will never hit")
	}
	if !strings.Contains(a, supportKnowledgeBase()) {
		t.Error("system prompt does not carry the knowledge base")
	}
	for _, must := range []string{
		"Never name internal infrastructure",
		"Never mention the Super User program",
		"Never give a date",
		"Never quote a dollar amount",
		"Never use an em dash",
		"Best Regards,",
	} {
		if !strings.Contains(a, must) {
			t.Errorf("system prompt lacks the rule %q", must)
		}
	}
}

// The sign-off is not the model's job to remember. It dropped it on the
// short ask-for-information replies, which is exactly the shape a user is
// most likely to read as curt.
func TestEnsureSignOff(t *testing.T) {
	got := ensureSignOff("\n<p>Could you send us your OS?</p>\n")
	if !strings.HasSuffix(got, "<p>Best Regards,<br>Scrollr Support</p>") {
		t.Errorf("sign-off not appended: %q", got)
	}
	if strings.HasPrefix(got, "\n") {
		t.Errorf("leading whitespace kept: %q", got)
	}
	already := "<p>Hi</p><p>Best Regards,<br>Scrollr Support</p>"
	if ensureSignOff(already) != already {
		t.Error("an existing sign-off was duplicated")
	}
}

func TestCompareVersions(t *testing.T) {
	for _, c := range []struct {
		a, b string
		want int
	}{
		{"1.6.1", "1.6.2", -1},
		{"1.6.2", "1.6.2", 0},
		{"1.6.2", "1.6.1", 1},
		{"1.0.19", "1.6.2", -1},
		{"1.10.0", "1.9.0", 1}, // numeric, not lexical
		{"1.6", "1.6.0", 0},
		{"1.6.2-beta", "1.6.2", 0},
		{"", "1.6.2", -1},
	} {
		if got := compareVersions(c.a, c.b); got != c.want {
			t.Errorf("compareVersions(%q, %q) = %d, want %d", c.a, c.b, got, c.want)
		}
	}
}

// An out-of-date user must be told so before anyone starts troubleshooting —
// that is the whole reason the version is in the prompt.
func TestContextNamesBothVersions(t *testing.T) {
	current := currentDesktopVersion()
	out := TicketContext{Tier: "free", AppVersion: "1.0.19", HasDiagnostics: true}.render()
	for _, must := range []string{"Current release is " + current, "this user is on 1.0.19", "OUT OF DATE"} {
		if !strings.Contains(out, must) {
			t.Errorf("context block lacks %q:\n%s", must, out)
		}
	}

	upToDate := TicketContext{Tier: "free", AppVersion: current, HasDiagnostics: true}.render()
	if strings.Contains(upToDate, "OUT OF DATE") {
		t.Errorf("an up-to-date user was called out of date:\n%s", upToDate)
	}

	// Super User is drafted for as Ultimate and never named (POLICIES).
	su := TicketContext{Tier: displayTier("super_user")}.render()
	if strings.Contains(strings.ToLower(su), "super") {
		t.Errorf("context block names the Super User program:\n%s", su)
	}
	if !strings.Contains(su, "uplink_ultimate") {
		t.Errorf("a Super User should read as uplink_ultimate:\n%s", su)
	}

	// A ticket with no diagnostics has to say so, or needs_info is a guess.
	if !strings.Contains(TicketContext{}.render(), "No diagnostics were attached") {
		t.Error("a context with no diagnostics does not say so")
	}
}

func TestMonitorCountsFromDiagnostics(t *testing.T) {
	diag := map[string]interface{}{"environment": map[string]interface{}{
		"monitors":       []interface{}{map[string]interface{}{}, map[string]interface{}{}},
		"chosenMonitors": []interface{}{"\\\\.\\DISPLAY2"},
	}}
	if a, c := monitorCountsFromDiagnostics(diag); a != 2 || c != 1 {
		t.Errorf("got %d attached / %d chosen, want 2/1", a, c)
	}
	// No chosen list means the primary, which is one screen, not none.
	diag["environment"].(map[string]interface{})["chosenMonitors"] = []interface{}{}
	if a, c := monitorCountsFromDiagnostics(diag); a != 2 || c != 1 {
		t.Errorf("got %d attached / %d chosen, want 2/1", a, c)
	}
	if a, c := monitorCountsFromDiagnostics(nil); a != 0 || c != 0 {
		t.Errorf("got %d/%d for no diagnostics, want 0/0", a, c)
	}
}

// When the issue tracker is unreachable the block must not read as "nothing
// is known to be broken" — that is a claim, and it would be a false one.
func TestKnownIssuesDegradesHonestly(t *testing.T) {
	empty := buildKnownIssuesBlock(nil, nil)
	if !strings.Contains(empty, "unavailable right now") {
		t.Errorf("an empty issue list must say it is unavailable:\n%s", empty)
	}
	if !strings.Contains(empty, "Never invent an issue key") {
		t.Error("the block does not forbid inventing issue keys")
	}

	full := buildKnownIssuesBlock(
		[]openIssue{{Key: "REL-999", Title: "Ticker blinks", Priority: "high", Labels: []string{"bug"}}},
		[]shippedRelease{{Tag: "desktop-v1.6.2", Name: "1.6.2", Date: "2026-09-08", Body: "fixed the blink"}})
	for _, must := range []string{"REL-999", "[high]", "(bug)", "desktop-v1.6.2", "fixed the blink",
		"Never put one in the reply to the user"} {
		if !strings.Contains(full, must) {
			t.Errorf("known-issues block lacks %q:\n%s", must, full)
		}
	}
}

// The similar-cases block is reference material. If the "do not copy" rule
// ever falls out of it, the drafter will paste another user's reply.
func TestSimilarCasesBlockForbidsCopying(t *testing.T) {
	out := renderSimilarCases([]SimilarCase{{
		TicketNumber: "1", Subject: "s", UserWrote: "u", WeSent: "w",
	}})
	if !strings.Contains(out, "NEVER copy one verbatim") {
		t.Errorf("similar-cases block lost the do-not-copy rule:\n%s", out)
	}
	if renderSimilarCases(nil) != "" {
		t.Error("no similar cases should render nothing at all")
	}
}
