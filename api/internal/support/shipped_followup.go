package support

import (
	"context"
	"fmt"
	"log"
	"strings"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
)

// =============================================================================
// "This is fixed now" — release → the people who reported it (REL-245)
// =============================================================================
//
// A ticket filed as a bug gets a Linear issue (the File as bug button). When
// a desktop release publishes, every case whose issue is now Done gets a
// drafted follow-up telling the reporter it shipped — as an ordinary pending
// draft in the Discord queue, with the same Send / Edit / Ask / Skip buttons
// as any other. Nothing goes out on its own.
//
// The body is templated rather than AI-written: "it shipped, here's where to
// get it" has one correct shape, and a Haiku call per case inside a webhook
// buys nothing but latency and a chance to hallucinate a changelog.

// shippedFollowUpLimit caps one release's follow-ups. A release that
// suddenly matches fifty cases means a query bug, not fifty happy users, and
// a cap makes it a small mess instead of a large one.
const shippedFollowUpLimit = 25

// DraftShippedFollowUps drafts a "fixed in <version>" reply for every open
// case linked to a Linear issue that has reached a completed state. Returns
// how many drafts it created.
//
// Idempotent per (case, issue): a note recording the follow-up is written
// alongside the draft, and cases carrying that note are skipped, so
// re-publishing a release — or publishing the next one — never re-drafts
// the same news.
func DraftShippedFollowUps(ctx context.Context, version, releaseURL string) int {
	if platform.DBPool == nil {
		return 0
	}
	version = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(version), "desktop-v"))
	if version == "" {
		log.Println("[Shipped] no version in release payload; nothing drafted")
		return 0
	}

	const q = `
		SELECT c.ticket_number, c.linear_issue_key, COALESCE(c.user_email,''),
			   COALESCE(c.subject,''), COALESCE(c.category,''), COALESCE(c.summary,'')
		FROM support_cases c
		WHERE c.linear_issue_key IS NOT NULL
		  AND c.status <> 'closed'
		  AND NOT EXISTS (
				SELECT 1 FROM support_drafts d
				WHERE d.ticket_number = c.ticket_number AND d.status = 'pending')
		  AND NOT EXISTS (
				SELECT 1 FROM support_messages m
				WHERE m.ticket_number = c.ticket_number AND m.kind = 'note'
				  AND m.body_text = 'shipped follow-up for ' || c.linear_issue_key)
		ORDER BY c.updated_at DESC
		LIMIT $1
	`
	rows, err := platform.DBPool.Query(ctx, q, shippedFollowUpLimit)
	if err != nil {
		log.Printf("[Shipped] candidate query: %v", err)
		return 0
	}
	type candidate struct {
		ticket, issueKey, email, subject, category, summary string
	}
	var candidates []candidate
	for rows.Next() {
		var c candidate
		if err := rows.Scan(&c.ticket, &c.issueKey, &c.email, &c.subject, &c.category, &c.summary); err != nil {
			continue
		}
		candidates = append(candidates, c)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		log.Printf("[Shipped] candidate rows: %v", err)
	}

	drafted := 0
	for _, c := range candidates {
		if c.email == "" {
			// Nowhere to send it; skip rather than draft something undeliverable.
			continue
		}
		done, err := linearIssueIsDone(ctx, c.issueKey)
		if err != nil {
			log.Printf("[Shipped] %s state lookup: %v", c.issueKey, err)
			continue
		}
		if !done {
			continue
		}

		draft, err := createSupportDraft(ctx, &SupportDraft{
			TicketNumber:    c.ticket,
			UserEmail:       c.email,
			OriginalSubject: c.subject,
			DraftBodyHTML:   shippedFollowUpHTML(version, releaseURL),
			AISummary:       fmt.Sprintf("Fixed in %s — %s is Done", version, c.issueKey),
			AICategory:      c.category,
			AIPriority:      "low",
			// Never "high": auto-send must not pick these up, and no human
			// has read this pairing of ticket and fix yet.
			AIConfidence: "medium",
			InternalNote: fmt.Sprintf("Auto-drafted on the %s release because %s is Done. Check the fix actually matches what they reported before sending.", version, c.issueKey),
		})
		if err != nil {
			log.Printf("[Shipped] draft for ticket %s: %v", c.ticket, err)
			continue
		}
		if err := recordSupportMessage(ctx, SupportMessage{
			TicketNumber: c.ticket, Kind: "note",
			BodyText: "shipped follow-up for " + c.issueKey,
		}); err != nil {
			log.Printf("[Cases] %v", err)
		}
		notifyPartnerAfterDraft(ctx, draft)
		drafted++
	}

	log.Printf("[Shipped] release %s: %d candidate(s), %d follow-up draft(s)", version, len(candidates), drafted)
	return drafted
}

// shippedFollowUpHTML is the reply body. Deliberately short and checkable:
// it claims only that a release is out, never that this user's exact
// symptom is gone — the partner confirms that before sending.
func shippedFollowUpHTML(version, releaseURL string) string {
	notes := ""
	if releaseURL != "" {
		notes = fmt.Sprintf(`<p>The full release notes are here: <a href="%s">%s</a>.</p>`,
			escapeHTML(releaseURL), escapeHTML(releaseURL))
	}
	return fmt.Sprintf(
		`<p>Good news — the fix for what you reported went out in Scrollr %s.</p>`+
			`<p>Scrollr updates itself, so you should get it within a day; to take it now, `+
			`download the latest build from <a href="https://myscrollr.com/download">myscrollr.com/download</a>.</p>`+
			`%s`+
			`<p>If you are on %s and still seeing it, reply here and we'll pick it back up.</p>`,
		escapeHTML(version), notes, escapeHTML(version))
}
