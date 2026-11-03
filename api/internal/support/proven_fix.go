package support

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
)

// =============================================================================
// Proven fixes — the bot may only claim a fix it can prove (REL-259)
// =============================================================================
//
// The drafter used to work out "is this fixed?" by reading release notes.
// Release notes are marketing prose written for everyone; they are not a
// record of which report a change closed. So the bot had no way to KNOW, and
// it was still allowed to SAY — which is how ten backlog drafts ended up
// wanting to tell a four-month-old reporter to update without being able to
// promise it did anything for their symptom.
//
// A fix is proven, and only proven, when all three of these hold:
//
//  1. a human linked the case to a Linear issue (support_cases.linear_issue_key,
//     set by the File as bug button or the /link confirmation — never by the
//     model, because a wrong link produces a confidently wrong "fixed in X"),
//  2. that issue is in a completed state, and
//  3. GitHub proves the closing merge is contained in a published stable desktop
//     release with installers for the supported platforms.
//
// The answer goes into the drafting prompt as a FACT, never as something to
// infer, and the disposition gate re-checks the finished reply against it.
//

// ProvenFix is the record behind a permitted fix claim. A nil *ProvenFix is
// the ordinary case and means exactly one thing: say nothing about a fix.
type ProvenFix struct {
	IssueKey   string    `json:"issue_key"`
	Version    string    `json:"version"` // "1.6.2" — the release the PR shipped in
	ReleaseURL string    `json:"release_url,omitempty"`
	MergedAt   time.Time `json:"merged_at"`
}

const (
	provenFixCachePrefix = "support:proven_fix:v2:"
	provenFixCacheTTL    = 10 * time.Minute
	// provenFixReleaseCount is how far back we look for the release that
	// carried a fix. Deep enough for a ticket that has been waiting months,
	// which is the whole population this exists for.
	provenFixReleaseCount = 30

	staleTicketDaysDefault = 30
)

// staleTicketDays is the age past which a ticket asks rather than tells.
func staleTicketDays() int {
	raw := strings.TrimSpace(os.Getenv("SUPPORT_STALE_TICKET_DAYS"))
	if raw == "" {
		return staleTicketDaysDefault
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 {
		log.Printf("[ProvenFix] SUPPORT_STALE_TICKET_DAYS=%q is not a positive integer; using %d",
			raw, staleTicketDaysDefault)
		return staleTicketDaysDefault
	}
	return n
}

// lookupProvenFix answers the question for one ticket. Returns nil whenever
// it cannot prove a fix, INCLUDING when the lookup itself failed: an
// unreachable Linear is a reason to say nothing, never a reason to guess.
func lookupProvenFix(ctx context.Context, ticketNumber string) *ProvenFix {
	if strings.TrimSpace(ticketNumber) == "" {
		return nil
	}
	issueKey := caseLinearIssueKey(ctx, ticketNumber)
	if issueKey == "" {
		return nil
	}
	return provenFixForIssue(ctx, issueKey)
}

// provenFixForIssue is the cached per-issue half. Cached on success only — a
// Linear outage must not pin "no fix on record" for ten minutes on an issue
// that has one.
func provenFixForIssue(ctx context.Context, issueKey string) *ProvenFix {
	cacheKey := provenFixCachePrefix + issueKey
	if platform.Rdb != nil {
		if raw, err := platform.Rdb.Get(ctx, cacheKey).Result(); err == nil {
			if raw == "" {
				return nil
			}
			var pf ProvenFix
			if json.Unmarshal([]byte(raw), &pf) == nil {
				return &pf
			}
		}
	}

	pf, err := computeProvenFix(ctx, issueKey)
	if err != nil {
		log.Printf("[ProvenFix] %s: %v (treating as no fix on record)", issueKey, err)
		return nil
	}
	if platform.Rdb != nil {
		payload := ""
		if pf != nil {
			if b, marshalErr := json.Marshal(pf); marshalErr == nil {
				payload = string(b)
			}
		}
		if err := platform.Rdb.Set(ctx, cacheKey, payload, provenFixCacheTTL).Err(); err != nil {
			log.Printf("[ProvenFix] cache %s: %v", issueKey, err)
		}
	}
	return pf
}

// linearClosingMerge returns when the pull request that closed an issue was
// merged. A zero time means "nothing to prove": the issue is not completed, or
// it is completed with no merged PR behind it — something moved the issue and
// we cannot say which release carried it.
func linearClosingMerge(ctx context.Context, issueKey string) (closingMerge, error) {
	const q = `query($id: String!) {
		issue(id: $id) {
			identifier
			state { type }
			attachments { nodes { sourceType url metadata } }
		}
	}`
	var out struct {
		Issue *struct {
			Identifier string `json:"identifier"`
			State      struct {
				Type string `json:"type"`
			} `json:"state"`
			Attachments struct {
				Nodes []struct {
					SourceType string                 `json:"sourceType"`
					URL        string                 `json:"url"`
					Metadata   map[string]interface{} `json:"metadata"`
				} `json:"nodes"`
			} `json:"attachments"`
		} `json:"issue"`
	}
	if err := linearGraphQL(ctx, q, map[string]interface{}{"id": issueKey}, &out); err != nil {
		return closingMerge{}, err
	}
	if out.Issue == nil {
		return closingMerge{}, fmt.Errorf("no Linear issue %q", issueKey)
	}
	if out.Issue.State.Type != "completed" {
		return closingMerge{}, nil
	}

	// The last merge wins: an issue reopened and fixed again shipped in the
	// later release, and naming the earlier one would be a lie about a bug the
	// user may still have.
	var merge closingMerge
	for _, a := range out.Issue.Attachments.Nodes {
		if a.SourceType != "github" {
			continue
		}
		link := a.URL
		if link == "" {
			link, _ = a.Metadata["url"].(string)
		}
		candidate, err := closingPull(ctx, link, issueKey, out.Issue.Identifier)
		if err != nil {
			return closingMerge{}, err
		}
		if candidate.MergedAt.After(merge.MergedAt) {
			merge = candidate
		}
	}
	return merge, nil
}

// computeProvenFix does the three checks. (nil, nil) means "no fix on record",
// which is a legitimate answer and gets cached; an error means we could not
// find out, which does not.
func computeProvenFix(ctx context.Context, issueKey string) (*ProvenFix, error) {
	merge, err := linearClosingMerge(ctx, issueKey)
	if err != nil {
		return nil, err
	}
	if merge.MergedAt.IsZero() {
		return nil, nil // not done, or done with nothing merged behind it
	}
	releases := fetchRecentReleases(ctx, provenFixReleaseCount)
	sort.Slice(releases, func(i, j int) bool { return releases[i].PublishedAt.Before(releases[j].PublishedAt) })
	for _, rel := range releases {
		contains, err := releaseContains(ctx, rel, merge)
		if err != nil {
			return nil, err
		}
		if contains {
			return fixRecord(issueKey, rel, merge), nil
		}
	}
	return nil, nil
}

func fixRecord(issueKey string, rel shippedRelease, merge closingMerge) *ProvenFix {
	return &ProvenFix{
		IssueKey:   issueKey,
		Version:    releaseVersion(rel.Tag, rel.Name),
		ReleaseURL: rel.URL,
		MergedAt:   merge.MergedAt,
	}
}

// releaseVersion turns "desktop-v1.6.3" into "1.6.3", falling back to the
// release name when the tag is not shaped like one.
func releaseVersion(tag, name string) string {
	v := strings.TrimSpace(tag)
	v = strings.TrimPrefix(v, "desktop-")
	v = strings.TrimPrefix(v, "v")
	if v == "" {
		return strings.TrimSpace(name)
	}
	return v
}

// ===== Staleness ==================================================

// caseStaleDays is how many days ago the user last said anything on a ticket.
// Zero when we do not know, which reads as "not stale" everywhere — the stale
// rule adds a reason to ask, and a missing timestamp is not one.
func caseStaleDays(ctx context.Context, ticketNumber string) int {
	if platform.DBPool == nil || strings.TrimSpace(ticketNumber) == "" {
		return 0
	}
	var last *time.Time
	err := platform.DBPool.QueryRow(ctx, `
		SELECT COALESCE(
			(SELECT max(created_at) FROM support_messages
			 WHERE ticket_number = $1 AND kind = 'user'),
			(SELECT opened_at FROM support_cases WHERE ticket_number = $1))`,
		ticketNumber).Scan(&last)
	if err != nil || last == nil {
		return 0
	}
	days := int(time.Since(*last).Hours() / 24)
	if days < 0 {
		return 0
	}
	return days
}
