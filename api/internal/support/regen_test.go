package support

import (
	"context"
	"testing"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/brandon-relentnet/myscrollr/api/internal/testsupport"
)

// TestDiagnosticsFields pins the parser that recovers a reporter's app
// version out of their own message. The backlog reaches the case DB through
// the osTicket backfill, which kept the body and never read it, so this is
// the only thing standing between a four-month-old ticket and a draft that
// opens with "app version: unknown".
func TestDiagnosticsFields(t *testing.T) {
	const realBody = `<h3>What went wrong?</h3><p>Sports are not showing up</p>` +
		`<details><summary><strong>System Diagnostics</strong></summary><pre>{
  "app": {
    "arch": "aarch64",
    "platform": "macos",
    "version": "1.0.20"
  },
  "environment": { "sessionType": "macOS" }
}</pre></details>`

	for _, tc := range []struct {
		name, body, wantVersion, wantOS string
	}{
		{"desktop bug form", realBody, "1.0.20", "macos"},
		{"osName wins over platform",
			`<pre>{"app":{"version":"1.6.2","platform":"windows"},"system":{"osName":"Windows 11"}}</pre>`,
			"1.6.2", "Windows 11"},
		{"attributes on the tag",
			`<pre class="diag" style="x">{"app":{"version":"1.5.0","platform":"linux"}}</pre>`,
			"1.5.0", "linux"},
		{"no diagnostics at all", `<p>Feature Request: Pinterest stock please</p>`, "", ""},
		{"a pre block that is not JSON", `<pre>2026-05-01 ERROR {something}</pre>`, "", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			gotVersion, gotOS := diagnosticsFields(tc.body)
			if gotVersion != tc.wantVersion || gotOS != tc.wantOS {
				t.Fatalf("got (%q, %q), want (%q, %q)", gotVersion, gotOS, tc.wantVersion, tc.wantOS)
			}
		})
	}
}

// TestRegenSupersede covers the replacement contract end to end without the
// two model calls in the middle: which ticket the batch picks up, what a
// re-triage reads a ticket from, and what happens to the draft it replaces.
func TestRegenSupersede(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	ctx := context.Background()
	resetCases(t)

	const diag = `<p>Ticker froze</p><pre>{"app":{"version":"1.0.13","platform":"windows"}}</pre>`
	if err := upsertSupportCase(ctx, SupportCase{
		TicketNumber: "700", UserEmail: "u@example.com", Subject: "Ticker froze", Status: "open",
	}); err != nil {
		t.Fatal(err)
	}
	old, err := createSupportDraft(ctx, &SupportDraft{
		TicketNumber: "700", UserEmail: "u@example.com", UserName: "Sam",
		OriginalSubject: "Ticker froze", UserMessageHTML: diag,
		DraftBodyHTML: "<p>the old answer</p>", AICategory: "bug",
	})
	if err != nil {
		t.Fatal(err)
	}

	// A decided draft on another ticket must not be picked up by the batch.
	decided, err := createSupportDraft(ctx, &SupportDraft{
		TicketNumber: "701", UserEmail: "v@example.com", OriginalSubject: "Already answered",
		DraftBodyHTML: "<p>sent already</p>",
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := markDraftDecided(ctx, decided.ID, "skipped", ""); err != nil {
		t.Fatal(err)
	}

	tickets, err := pendingRegenTickets(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(tickets) != 1 || tickets[0] != "700" {
		t.Fatalf("pending list = %v, want [700]", tickets)
	}

	// The source of a re-triage is the pending draft's own copy of the ticket.
	src, err := loadRegenSource(ctx, "700")
	if err != nil {
		t.Fatal(err)
	}
	if src.DraftID != old.ID || src.UserMessageHTML != diag || src.UserName != "Sam" {
		t.Fatalf("source wrong: %+v", src)
	}

	// And the version buried in that message reaches the case row, which is
	// what puts "you are on 1.0.13, we are on <current>" in front of the model.
	backfillCaseDiagnostics(ctx, "700", src.UserMessageHTML)
	if v := caseAppVersion(ctx, "700"); v != "1.0.13" {
		t.Fatalf("app_version = %q, want 1.0.13", v)
	}

	replacement, err := createSupportDraft(ctx, &SupportDraft{
		TicketNumber: "700", UserEmail: "u@example.com", OriginalSubject: "Ticker froze",
		UserMessageHTML: diag, DraftBodyHTML: "<p>the new answer</p>", AICategory: "bug",
	})
	if err != nil {
		t.Fatal(err)
	}
	supersedeDraft(ctx, "700", old.ID)

	var status string
	if err := platform.DBPool.QueryRow(ctx,
		`SELECT status FROM support_drafts WHERE id = $1`, old.ID).Scan(&status); err != nil {
		t.Fatal(err)
	}
	if status != "skipped" {
		t.Fatalf("superseded draft status = %q, want skipped", status)
	}
	// Its body is still on the case — flagged, not deleted.
	var superseded bool
	var body string
	if err := platform.DBPool.QueryRow(ctx,
		`SELECT superseded, body_text FROM support_messages WHERE ai_draft_id = $1 AND kind = 'ai_draft'`,
		old.ID).Scan(&superseded, &body); err != nil {
		t.Fatal(err)
	}
	if !superseded || body == "" {
		t.Fatalf("old draft message: superseded=%t body=%q", superseded, body)
	}
	var newSuperseded bool
	if err := platform.DBPool.QueryRow(ctx,
		`SELECT superseded FROM support_messages WHERE ai_draft_id = $1 AND kind = 'ai_draft'`,
		replacement.ID).Scan(&newSuperseded); err != nil {
		t.Fatal(err)
	}
	if newSuperseded {
		t.Fatal("the replacement draft was flagged superseded")
	}
	if n := countMessages(t, "700", "note"); n != 1 {
		t.Fatalf("supersede notes = %d, want 1", n)
	}

	// The batch now sees only the replacement, once.
	tickets, err = pendingRegenTickets(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(tickets) != 1 || tickets[0] != "700" {
		t.Fatalf("pending list after supersede = %v, want [700]", tickets)
	}
	if src, err = loadRegenSource(ctx, "700"); err != nil || src.DraftID != replacement.ID {
		t.Fatalf("source after supersede = %+v (err %v), want draft %d", src, err, replacement.ID)
	}
}

// TestRegenSourceFallbacks covers the two cases the batch never reaches and
// `/regen <ticket>` exists for: a ticket that was imported from osTicket and
// never drafted at all, and one that is already closed.
func TestRegenSourceFallbacks(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	ctx := context.Background()
	resetCases(t)

	if err := upsertSupportCase(ctx, SupportCase{
		TicketNumber: "800", UserEmail: "old@example.com", Subject: "Sports missing", Status: "open",
	}); err != nil {
		t.Fatal(err)
	}
	if err := recordSupportMessage(ctx, SupportMessage{
		TicketNumber: "800", Kind: "user", BodyHTML: "<p>no sports on the ticker</p>",
	}); err != nil {
		t.Fatal(err)
	}
	src, err := loadRegenSource(ctx, "800")
	if err != nil {
		t.Fatal(err)
	}
	if src.DraftID != 0 || src.UserMessageHTML != "<p>no sports on the ticker</p>" || src.IsReply {
		t.Fatalf("never-drafted source wrong: %+v", src)
	}
	if src.UserName != "old" {
		t.Fatalf("user name = %q, want the local part of the address", src.UserName)
	}
	// A never-drafted ticket is not in the batch — only `/regen <ticket>`
	// reaches it, because the rest of that backlog is mail that arrived by
	// accident.
	tickets, err := pendingRegenTickets(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(tickets) != 0 {
		t.Fatalf("pending list = %v, want empty", tickets)
	}

	if err := upsertSupportCase(ctx, SupportCase{TicketNumber: "800", Status: "closed"}); err != nil {
		t.Fatal(err)
	}
	if _, err := loadRegenSource(ctx, "800"); err == nil {
		t.Fatal("a closed ticket must not be re-triaged into a reply")
	}
	if _, err := loadRegenSource(ctx, "does-not-exist"); err == nil {
		t.Fatal("an unknown ticket must not be re-triaged")
	}
}
