package support

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/testsupport"
)

// =============================================================================
// The bot may only claim a fix it can prove (REL-259)
// =============================================================================
//
// Everything here is one question asked three ways: may this reply tell a user
// their problem is gone? The answer is yes exactly when a person linked the
// case to an issue, that issue is done, and the pull request that closed it
// went out in a published release. Every other shape — done but unreleased,
// done with nothing merged, not linked at all, Linear unreachable — is no.

// stubLinearAndReleases points both upstreams at test servers for one test.
// issueState is the Linear workflow state type ("completed", "started", ...);
// mergedAt is the closing PR's merge time, empty for "no PR attached".
func stubLinearAndReleases(t *testing.T, issueState, mergedAt string, releases []map[string]interface{}) {
	t.Helper()

	linear := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var attachments []map[string]interface{}
		if mergedAt != "" {
			attachments = append(attachments, map[string]interface{}{
				"sourceType": "github",
				"metadata":   map[string]interface{}{"status": "merged", "mergedAt": mergedAt},
			})
		}
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"data": map[string]interface{}{
				"issue": map[string]interface{}{
					"state":       map[string]interface{}{"type": issueState},
					"attachments": map[string]interface{}{"nodes": attachments},
				},
			},
		})
	}))
	github := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(releases)
	}))

	oldLinear, oldGitHub := linearAPIURL, knownIssuesReleasesURL
	linearAPIURL = linear.URL
	knownIssuesReleasesURL = github.URL + "?per_page=%d"
	t.Setenv("LINEAR_API_KEY", "test-key")
	t.Cleanup(func() {
		linearAPIURL, knownIssuesReleasesURL = oldLinear, oldGitHub
		linear.Close()
		github.Close()
	})
}

func release(tag, published string, prerelease bool) map[string]interface{} {
	return map[string]interface{}{
		"tag_name": tag, "name": "Scrollr " + strings.TrimPrefix(tag, "desktop-v"),
		"body": "notes", "draft": false, "prerelease": prerelease,
		"published_at": published, "html_url": "https://example.invalid/" + tag,
	}
}

func TestProvenFix_DoneAndShipped(t *testing.T) {
	stubLinearAndReleases(t, "completed", "2026-09-01T10:00:00Z", []map[string]interface{}{
		release("desktop-v1.6.2", "2026-09-02T12:00:00Z", false),
		release("desktop-v1.6.3", "2026-09-07T12:00:00Z", false),
		release("desktop-v1.6.0", "2026-08-20T12:00:00Z", false),
	})

	pf, err := computeProvenFix(context.Background(), "REL-253")
	if err != nil {
		t.Fatal(err)
	}
	if pf == nil {
		t.Fatal("a done issue whose PR shipped is exactly the case that has proof")
	}
	// The FIRST release after the merge, not the newest one: 1.6.2 is when the
	// user could have had it, and naming 1.6.3 would send someone chasing an
	// update they did not need.
	if pf.Version != "1.6.2" || pf.IssueKey != "REL-253" {
		t.Fatalf("got %+v, want REL-253 shipped in 1.6.2", pf)
	}
}

func TestProvenFix_DoneButUnreleased(t *testing.T) {
	stubLinearAndReleases(t, "completed", "2026-09-08T10:00:00Z", []map[string]interface{}{
		release("desktop-v1.6.3", "2026-09-07T12:00:00Z", false),
	})

	pf, err := computeProvenFix(context.Background(), "REL-259")
	if err != nil {
		t.Fatal(err)
	}
	if pf != nil {
		t.Fatalf("a merge that no release has carried yet is not proof, got %+v", pf)
	}
}

func TestProvenFix_PrereleaseIsNotAShippedFix(t *testing.T) {
	stubLinearAndReleases(t, "completed", "2026-09-01T10:00:00Z", []map[string]interface{}{
		release("desktop-v1.7.0-beta.1", "2026-09-02T12:00:00Z", true),
	})

	pf, err := computeProvenFix(context.Background(), "REL-253")
	if err != nil {
		t.Fatal(err)
	}
	if pf != nil {
		t.Fatalf("telling somebody the fix is in a build they cannot get is worse than saying nothing, got %+v", pf)
	}
}

func TestProvenFix_NotDoneAndNoMergedPR(t *testing.T) {
	stubLinearAndReleases(t, "started", "2026-09-01T10:00:00Z", []map[string]interface{}{
		release("desktop-v1.6.3", "2026-09-07T12:00:00Z", false),
	})
	if pf, err := computeProvenFix(context.Background(), "REL-253"); err != nil || pf != nil {
		t.Fatalf("an open issue is never a shipped fix (pf=%+v err=%v)", pf, err)
	}

	// Done, but nothing merged behind it: something moved the issue and we
	// cannot say which release carried it, so we say nothing.
	stubLinearAndReleases(t, "completed", "", []map[string]interface{}{
		release("desktop-v1.6.3", "2026-09-07T12:00:00Z", false),
	})
	if pf, err := computeProvenFix(context.Background(), "REL-253"); err != nil || pf != nil {
		t.Fatalf("done with no merged PR is not proof (pf=%+v err=%v)", pf, err)
	}
}

// A lookup we could not perform is a reason to say nothing, never a reason to
// guess in either direction.
func TestProvenFix_UnreachableLinearMeansNoClaim(t *testing.T) {
	down := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "nope", http.StatusInternalServerError)
	}))
	defer down.Close()
	old := linearAPIURL
	linearAPIURL = down.URL
	t.Setenv("LINEAR_API_KEY", "test-key")
	defer func() { linearAPIURL = old }()

	if pf := provenFixForIssue(context.Background(), "REL-253"); pf != nil {
		t.Fatalf("got %+v, want no claim when the tracker is unreachable", pf)
	}
}

// An unlinked case can never have proof, whatever Linear would have said —
// nothing is asked, because there is nothing to ask about.
func TestProvenFix_UnlinkedCaseHasNone(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	resetCases(t)
	ctx := context.Background()

	ticket := "900259"
	if err := upsertSupportCase(ctx, SupportCase{
		TicketNumber: ticket, Subject: "The ticker never scrolls", Status: "open",
	}); err != nil {
		t.Fatal(err)
	}
	if pf := lookupProvenFix(ctx, ticket); pf != nil {
		t.Fatalf("got %+v, want nil for a case nobody has linked", pf)
	}
}

// caseStaleDays is what turns a four-month-old ticket into a question.
func TestCaseStaleDays_ReadsTheLastUserMessage(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	resetCases(t)
	ctx := context.Background()

	ticket := "900260"
	if err := upsertSupportCase(ctx, SupportCase{
		TicketNumber: ticket, Subject: "Scores stuck", Status: "open",
		OpenedAt: time.Now().AddDate(0, 0, -120),
	}); err != nil {
		t.Fatal(err)
	}
	if err := recordSupportMessage(ctx, SupportMessage{
		TicketNumber: ticket, Kind: "user", BodyText: "still stuck",
		CreatedAt: time.Now().AddDate(0, 0, -40),
	}); err != nil {
		t.Fatal(err)
	}

	// 40, not 120: what matters is how long the user has been waiting for an
	// answer to what they last said, not how long the ticket has existed.
	if got := caseStaleDays(ctx, ticket); got < 39 || got > 41 {
		t.Fatalf("caseStaleDays = %d, want ~40", got)
	}

	// A reply of ours does not reset it — we are the ones who have been quiet.
	if err := recordSupportMessage(ctx, SupportMessage{
		TicketNumber: ticket, Kind: "sent", BodyText: "looking into it",
	}); err != nil {
		t.Fatal(err)
	}
	if got := caseStaleDays(ctx, ticket); got < 39 || got > 41 {
		t.Fatalf("caseStaleDays = %d after our own reply, want ~40", got)
	}
}

// firstReleaseAfter is the whole "which version carried it" rule.
func TestFirstReleaseAfter(t *testing.T) {
	at := func(s string) time.Time {
		ts, err := time.Parse(time.RFC3339, s)
		if err != nil {
			t.Fatal(err)
		}
		return ts
	}
	releases := []shippedRelease{
		{Tag: "desktop-v1.6.0", PublishedAt: at("2026-08-20T12:00:00Z")},
		{Tag: "desktop-v1.6.3", PublishedAt: at("2026-09-07T12:00:00Z")},
		{Tag: "desktop-v1.6.2", PublishedAt: at("2026-09-02T12:00:00Z")},
	}
	got := firstReleaseAfter(releases, at("2026-09-01T10:00:00Z"))
	if got == nil || got.Tag != "desktop-v1.6.2" {
		t.Fatalf("got %+v, want desktop-v1.6.2", got)
	}
	if got := firstReleaseAfter(releases, at("2026-09-09T10:00:00Z")); got != nil {
		t.Fatalf("got %+v, want nil when nothing has shipped since the merge", got)
	}
}

func TestReleaseVersion(t *testing.T) {
	for tag, want := range map[string]string{
		"desktop-v1.6.3": "1.6.3", "v1.6.3": "1.6.3", "1.6.3": "1.6.3",
	} {
		if got := releaseVersion(tag, "Scrollr 1.6.3"); got != want {
			t.Errorf("releaseVersion(%q) = %q, want %q", tag, got, want)
		}
	}
	if got := releaseVersion("", "Scrollr 1.6.3"); got != "Scrollr 1.6.3" {
		t.Errorf("an untagged release falls back to its name, got %q", got)
	}
}

// ===== The prompt block ===========================================

func TestFixRecordBlock_ForbidsTheUnprovableClaim(t *testing.T) {
	none := renderFixRecord(nil, 0, "1.5.0")
	for _, want := range []string{"No shipped fix is on record", "may NOT say this was fixed",
		"tell them to update as the answer", "Asking which version"} {
		if !strings.Contains(none, want) {
			t.Errorf("the no-fix block must say %q:\n%s", want, none)
		}
	}

	stale := renderFixRecord(nil, 40, "1.5.0")
	if !strings.Contains(stale, "40 DAYS OLD") || !strings.Contains(stale, "ask_user_for") {
		t.Errorf("a stale ticket must be told to ask:\n%s", stale)
	}
	if strings.Contains(none, "DAYS OLD") {
		t.Error("a fresh ticket must not get the stale instruction")
	}

	proven := renderFixRecord(&ProvenFix{IssueKey: "REL-253", Version: "1.6.2"}, 40, "1.5.0")
	if !strings.Contains(proven, "shipped in Scrollr 1.6.2") || !strings.Contains(proven, "You MAY") {
		t.Errorf("a proven fix must permit the claim:\n%s", proven)
	}
	if strings.Contains(proven, "DAYS OLD") {
		t.Error("proof beats age: an old ticket with a shipped fix gets told the fix, not told to ask")
	}

	// Already on the fixed build: the honest reply is "it shipped, what are
	// you still seeing", not "please update".
	upToDate := renderFixRecord(&ProvenFix{IssueKey: "REL-253", Version: "1.6.2"}, 0, "1.6.3")
	if !strings.Contains(upToDate, "updating is NOT the answer") {
		t.Errorf("a user already past the fix must not be told to update:\n%s", upToDate)
	}
}

// The never-say rule has to be in the cached system prompt, not only in the
// per-ticket block, because that is the half the model is told is law.
func TestSystemPromptForbidsUnprovenFixClaims(t *testing.T) {
	p := triageSystemPrompt()
	for _, want := range []string{
		"Never say something was fixed",
		"FIX ON RECORD",
		"Release notes are",
	} {
		if !strings.Contains(p, want) {
			t.Errorf("system prompt is missing %q", want)
		}
	}
}

// The release notes must no longer be advertised as evidence of a fix — that
// instruction is what produced the drafts this whole issue is about.
func TestKnownIssuesNoLongerTreatsReleaseNotesAsProof(t *testing.T) {
	block := buildKnownIssuesBlock(
		[]openIssue{{Key: "REL-253", Title: "The ticker never scrolls", Priority: "high"}},
		[]shippedRelease{{Tag: "desktop-v1.6.2", Name: "Scrollr 1.6.2", Date: "2026-09-05", Body: "fixes"}},
	)
	if strings.Contains(block, "name the version") || strings.Contains(block, "tell them to update") {
		t.Errorf("the known-issues block still tells the drafter to promise an update:\n%s", block)
	}
	if !strings.Contains(block, "FIX ON RECORD") {
		t.Errorf("the block must point at the one source that can prove a fix:\n%s", block)
	}
}
