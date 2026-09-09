package support

import (
	"context"
	"errors"
	"fmt"
	"log"
	"sort"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
)

// =============================================================================
// /link — backfill case → issue links, one confirmed click at a time (REL-259)
// =============================================================================
//
// A proven fix starts with support_cases.linear_issue_key, and most of the
// backlog has none: those cases were imported from osTicket long before the
// File as bug button existed. Without a link they can never be told a fix
// shipped, which is the safe direction but not a useful resting place.
//
// So this proposes matches and nothing more. The scoring is word overlap
// between the ticket and the issue — deliberately dumb, because its job is to
// put a plausible pair in front of a person, not to decide. Nothing here
// writes a link on its own: a wrong link produces a confidently wrong "fixed
// in X" months later, which is the exact failure REL-259 exists to prevent.

// linkProposalCases is how many unlinked cases one /link shows. Discord allows
// five action rows and each case takes one, with the sixth reserved for
// nothing at all — four keeps the message readable.
const linkProposalCases = 4

// linkCandidatesPerCase is how many issues get a button per case. Two is the
// point where a person is choosing rather than rubber-stamping.
const linkCandidatesPerCase = 2

// linkMinScore is the smallest overlap worth showing. One shared word is
// noise; two distinctive ones is a proposal.
const linkMinScore = 2

// unlinkedCase is one open case with no issue behind it.
type unlinkedCase struct {
	TicketNumber string
	Subject      string
	Summary      string
	OpenedAt     time.Time
}

// linkCandidate is one proposed pairing.
type linkCandidate struct {
	IssueKey string
	Title    string
	Score    int
}

// fetchUnlinkedCases lists open cases with no linear_issue_key, oldest first —
// the longest-waiting reports are the ones most likely to have been fixed
// without anybody recording it.
func fetchUnlinkedCases(ctx context.Context, limit int) ([]unlinkedCase, error) {
	if platform.DBPool == nil {
		return nil, fmt.Errorf("DB not initialized")
	}
	rows, err := platform.DBPool.Query(ctx, `
		SELECT ticket_number, COALESCE(subject,''), COALESCE(summary,''), opened_at
		FROM support_cases
		WHERE linear_issue_key IS NULL AND status <> 'closed'
		ORDER BY opened_at ASC
		LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []unlinkedCase
	for rows.Next() {
		var u unlinkedCase
		if err := rows.Scan(&u.TicketNumber, &u.Subject, &u.Summary, &u.OpenedAt); err != nil {
			continue
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

// linkStopwords are the words that match everything and mean nothing. Support
// tickets and bug titles share a lot of furniture ("the bar does not work"),
// and without this every case proposes every issue.
var linkStopwords = map[string]bool{
	"the": true, "and": true, "for": true, "with": true, "that": true, "this": true,
	"not": true, "but": true, "you": true, "your": true, "are": true, "was": true,
	"were": true, "has": true, "have": true, "had": true, "can": true, "cannot": true,
	"does": true, "did": true, "when": true, "what": true, "why": true, "how": true,
	"from": true, "into": true, "out": true, "all": true, "any": true, "get": true,
	"got": true, "its": true, "it's": true, "there": true, "here": true, "then": true,
	"than": true, "just": true, "still": true, "some": true, "very": true, "will": true,
	"would": true, "should": true, "could": true, "please": true, "thanks": true,
	"issue": true, "problem": true, "bug": true, "report": true, "support": true,
	"scrollr": true, "app": true, "using": true, "use": true, "after": true,
}

// linkTokens reduces a string to its distinctive lowercase words.
func linkTokens(s string) map[string]bool {
	out := map[string]bool{}
	for _, f := range strings.FieldsFunc(strings.ToLower(s), func(r rune) bool {
		return !(r >= 'a' && r <= 'z') && !(r >= '0' && r <= '9')
	}) {
		if len(f) < 3 || linkStopwords[f] {
			continue
		}
		out[f] = true
	}
	return out
}

// proposeLinks ranks open issues against one case by shared distinctive words.
// Pure, so the scoring is testable without Linear or a database.
func proposeLinks(uc unlinkedCase, issues []openIssue, limit int) []linkCandidate {
	caseWords := linkTokens(uc.Subject + " " + uc.Summary)
	if len(caseWords) == 0 {
		return nil
	}
	var out []linkCandidate
	for _, is := range issues {
		score := 0
		for w := range linkTokens(is.Title + " " + is.Description) {
			if caseWords[w] {
				score++
			}
		}
		if score >= linkMinScore {
			out = append(out, linkCandidate{IssueKey: is.Key, Title: is.Title, Score: score})
		}
	}
	// Score first, then issue key, so the same input always proposes the same
	// buttons in the same order — a list that reshuffles between runs is a
	// list nobody trusts enough to click.
	sort.Slice(out, func(i, j int) bool {
		if out[i].Score != out[j].Score {
			return out[i].Score > out[j].Score
		}
		return out[i].IssueKey < out[j].IssueKey
	})
	if len(out) > limit {
		out = out[:limit]
	}
	return out
}

// ===== The command ================================================

// handleDiscordLinkCommand proposes matches for the unlinked backlog.
// Deferred: it reads Linear, which is not a three-second answer when the
// cache is cold.
func handleDiscordLinkCommand(c *fiber.Ctx, ix *discordInteraction) error {
	appID, token := ix.ApplicationID, ix.Token
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancel()
		content, components := buildLinkProposals(ctx)
		if err := discordCompleteDeferredWith(ctx, appID, token, content, components); err != nil {
			log.Printf("[Link] follow-up: %v", err)
		}
	}()
	return c.JSON(fiber.Map{"type": discordResponseDeferredChannelMessage})
}

// buildLinkProposals is the message: what is unlinked, what might match it,
// and a button per candidate. Cases with no plausible candidate are listed
// without buttons rather than hidden — "nothing matched this one" is the
// answer for most of them, and it is worth seeing.
func buildLinkProposals(ctx context.Context) (string, []DiscordActionRow) {
	cases, err := fetchUnlinkedCases(ctx, linkProposalCases)
	if err != nil {
		log.Printf("[Link] unlinked cases: %v", err)
		return "Could not read the case database.", nil
	}
	if len(cases) == 0 {
		return "🔗 Every open case already has an issue linked to it.", nil
	}

	issues := fetchOpenLinearIssues(ctx)
	if len(issues) == 0 {
		return "🔗 Could not read open issues from Linear, so there is nothing to propose.", nil
	}

	var b strings.Builder
	b.WriteString("🔗 **Unlinked open cases.** Confirm a match and that case can be told its fix " +
		"shipped; leave it and it keeps asking instead. Nothing links itself.\n")
	var rows []DiscordActionRow

	for _, uc := range cases {
		label := uc.Summary
		if strings.TrimSpace(label) == "" {
			label = uc.Subject
		}
		fmt.Fprintf(&b, "\n• **#%s** — %s _(%s old)_\n",
			uc.TicketNumber, truncateRunes(label, 110), humanAge(time.Since(uc.OpenedAt)))

		candidates := proposeLinks(uc, issues, linkCandidatesPerCase)
		if len(candidates) == 0 {
			b.WriteString("   nothing plausible in the open issues\n")
			continue
		}
		var buttons []DiscordMessageButton
		for _, cand := range candidates {
			fmt.Fprintf(&b, "   `%s` %s\n", cand.IssueKey, truncateRunes(cand.Title, 90))
			btn := DiscordMessageButton{
				Type: 2, Style: 1,
				Label:    fmt.Sprintf("#%s → %s", uc.TicketNumber, cand.IssueKey),
				CustomID: fmt.Sprintf("support_link:%s|%s", uc.TicketNumber, cand.IssueKey),
			}
			btn.Emoji = &struct {
				Name string `json:"name"`
			}{Name: "🔗"}
			buttons = append(buttons, btn)
		}
		rows = append(rows, DiscordActionRow{Type: 1, Components: buttons})
	}
	return truncateRunes(b.String(), 1990), rows
}

// ===== The confirmation button ====================================

// handleDiscordLinkConfirm writes the link a person just confirmed. The
// custom_id carries "<ticket>|<ISSUE-KEY>" because a link is a pair, not a
// draft id.
func handleDiscordLinkConfirm(c *fiber.Ctx, arg string) error {
	ticket, issueKey, ok := strings.Cut(arg, "|")
	if !ok {
		return discordEphemeralResponse(c, "malformed link target")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// ActionLinkIssue is the same function the console's link endpoint calls,
	// so the note, the thread post and the refusal to overwrite an existing
	// link are written once (REL-261).
	key, err := ActionLinkIssue(ctx, ticket, issueKey)
	if err != nil {
		var already ErrAlreadyLinked
		if errors.As(err, &already) {
			return discordEphemeralResponse(c,
				fmt.Sprintf("#%s is already linked to **%s**.", strings.TrimSpace(ticket), already.IssueKey))
		}
		log.Printf("[Link] %s -> %s: %v", ticket, issueKey, err)
		return discordEphemeralResponse(c, "Could not save the link: "+truncate(err.Error(), 200))
	}

	return discordVisibleResponse(c, fmt.Sprintf("🔗 **#%s → %s.** %s",
		strings.TrimSpace(ticket), key, linearIssueURL(key)))
}
