package support

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
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
				"url":        "https://github.com/doughknee/myscrollr/pull/1",
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
		if strings.HasPrefix(r.URL.Path, "/download/") {
			parts := strings.Split(r.URL.Path, "/")
			if len(parts) != 4 {
				http.NotFound(w, r)
				return
			}
			data := testReleaseFiles(parts[2])[parts[3]]
			if data == nil {
				http.NotFound(w, r)
				return
			}
			_, _ = w.Write(data)
			return
		}
		if strings.HasPrefix(r.URL.Path, "/commits/refs/tags/") {
			_ = json.NewEncoder(w).Encode(map[string]string{"sha": testReleaseSource(strings.TrimPrefix(r.URL.Path, "/commits/refs/tags/"))})
			return
		}
		if strings.HasPrefix(r.URL.Path, "/pulls/") {
			_ = json.NewEncoder(w).Encode(map[string]interface{}{"merged": true, "merged_at": mergedAt, "body": "Closes REL-253\nCloses REL-259\nCloses SCROLLR-419",
				"merge_commit_sha": strings.Repeat("a", 40), "base": map[string]interface{}{"repo": map[string]string{"full_name": "doughknee/myscrollr"}}})
			return
		}
		if strings.HasPrefix(r.URL.Path, "/compare/") {
			status := "ahead"
			for _, rel := range releases {
				if strings.HasSuffix(r.URL.Path, "..."+testReleaseSource(rel["tag_name"].(string))) && rel["contains"] == false {
					status = "diverged"
				}
			}
			_ = json.NewEncoder(w).Encode(map[string]interface{}{"status": status,
				"base_commit": map[string]string{"sha": strings.Repeat("a", 40)}, "merge_base_commit": map[string]string{"sha": strings.Repeat("a", 40)}})
			return
		}
		_ = json.NewEncoder(w).Encode(releases)
	}))

	oldLinear, oldGitHub, oldProof, oldDownload := linearAPIURL, knownIssuesReleasesURL, provenFixGitHubURL, provenFixDownloadURL
	linearAPIURL = linear.URL
	knownIssuesReleasesURL = github.URL + "?per_page=%d"
	provenFixGitHubURL = github.URL
	provenFixDownloadURL = github.URL + "/download"
	t.Setenv("LINEAR_API_KEY", "test-key")
	t.Cleanup(func() {
		linearAPIURL, knownIssuesReleasesURL = oldLinear, oldGitHub
		provenFixGitHubURL = oldProof
		provenFixDownloadURL = oldDownload
		linear.Close()
		github.Close()
	})
}

func testReleaseSource(tag string) string { return fmt.Sprintf("%x", sha256.Sum256([]byte(tag)))[:40] }

func testReleaseFiles(tag string) map[string][]byte {
	version := strings.TrimPrefix(tag, "desktop-v")
	files := map[string][]byte{}
	hashes := map[string]string{}
	names := []string{"Scrollr_" + version + "_x64-setup.exe", "Scrollr_" + version + "_x64_en-US.msi", "Scrollr_" + version + "_aarch64.dmg", "Scrollr_aarch64.app.tar.gz", "Scrollr_" + version + "_amd64.AppImage"}
	for _, name := range names {
		files[name] = []byte(name)
		hashes[name] = fmt.Sprintf("%x", sha256.Sum256(files[name]))
	}
	platforms := map[string]map[string]string{}
	for target, name := range map[string]string{"windows-x86_64": names[1], "windows-x86_64-nsis": names[0], "darwin-aarch64": names[3], "linux-x86_64": names[4]} {
		platforms[target] = map[string]string{"url": "https://github.com/doughknee/myscrollr/releases/download/" + tag + "/" + name, "signature": "fixture-signature-over-twenty-characters"}
	}
	files["latest.json"], _ = json.Marshal(map[string]interface{}{"version": version, "platforms": platforms})
	hashes["latest.json"] = fmt.Sprintf("%x", sha256.Sum256(files["latest.json"]))
	files["verification.json"], _ = json.Marshal(map[string]interface{}{"schema": 1, "version": version, "source": testReleaseSource(tag), "runId": "123", "assets": hashes})
	return files
}

func release(tag, published string, prerelease bool) map[string]interface{} {
	assets := []map[string]string{}
	for name, data := range testReleaseFiles(tag) {
		assets = append(assets, map[string]string{"name": name, "digest": fmt.Sprintf("sha256:%x", sha256.Sum256(data))})
	}
	return map[string]interface{}{
		"tag_name": tag, "name": "Scrollr " + strings.TrimPrefix(tag, "desktop-v"), "body": "notes", "draft": false, "prerelease": prerelease,
		"published_at": published, "html_url": "https://github.com/doughknee/myscrollr/releases/tag/" + tag, "assets": assets,
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
