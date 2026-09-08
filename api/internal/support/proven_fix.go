package support

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
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
//  3. the pull request that closed it was merged before a published release.
//
// The answer goes into the drafting prompt as a FACT, never as something to
// infer, and the disposition gate re-checks the finished reply against it.
//
// ponytail: (3) is "merged before the release was published", not "this commit
// is an ancestor of that tag". Scrollr cuts releases from main, so the two
// agree; if release branches ever appear, swap the timestamp compare for a
// GitHub compare call against the tag.

// ProvenFix is the record behind a permitted fix claim. A nil *ProvenFix is
// the ordinary case and means exactly one thing: say nothing about a fix.
type ProvenFix struct {
	IssueKey   string    `json:"issue_key"`
	Version    string    `json:"version"` // "1.6.2" — the release the PR shipped in
	ReleaseURL string    `json:"release_url,omitempty"`
	MergedAt   time.Time `json:"merged_at"`
}

const (
	provenFixCachePrefix = "support:proven_fix:v1:"
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
func linearClosingMerge(ctx context.Context, issueKey string) (time.Time, error) {
	const q = `query($id: String!) {
		issue(id: $id) {
			state { type }
			attachments { nodes { sourceType metadata } }
		}
	}`
	var out struct {
		Issue *struct {
			State struct {
				Type string `json:"type"`
			} `json:"state"`
			Attachments struct {
				Nodes []struct {
					SourceType string                 `json:"sourceType"`
					Metadata   map[string]interface{} `json:"metadata"`
				} `json:"nodes"`
			} `json:"attachments"`
		} `json:"issue"`
	}
	if err := linearGraphQL(ctx, q, map[string]interface{}{"id": issueKey}, &out); err != nil {
		return time.Time{}, err
	}
	if out.Issue == nil {
		return time.Time{}, fmt.Errorf("no Linear issue %q", issueKey)
	}
	if out.Issue.State.Type != "completed" {
		return time.Time{}, nil
	}

	// The last merge wins: an issue reopened and fixed again shipped in the
	// later release, and naming the earlier one would be a lie about a bug the
	// user may still have.
	var mergedAt time.Time
	for _, a := range out.Issue.Attachments.Nodes {
		if a.SourceType != "github" || a.Metadata == nil {
			continue
		}
		if s, _ := a.Metadata["status"].(string); !strings.EqualFold(s, "merged") {
			continue
		}
		raw, _ := a.Metadata["mergedAt"].(string)
		t, parseErr := time.Parse(time.RFC3339, raw)
		if parseErr != nil {
			continue
		}
		if t.After(mergedAt) {
			mergedAt = t
		}
	}
	return mergedAt, nil
}

// computeProvenFix does the three checks. (nil, nil) means "no fix on record",
// which is a legitimate answer and gets cached; an error means we could not
// find out, which does not.
func computeProvenFix(ctx context.Context, issueKey string) (*ProvenFix, error) {
	mergedAt, err := linearClosingMerge(ctx, issueKey)
	if err != nil {
		return nil, err
	}
	if mergedAt.IsZero() {
		return nil, nil // not done, or done with nothing merged behind it
	}
	rel := firstReleaseAfter(fetchRecentReleases(ctx, provenFixReleaseCount), mergedAt)
	if rel == nil {
		return nil, nil // fixed, but it has not shipped yet
	}
	return &ProvenFix{
		IssueKey:   issueKey,
		Version:    releaseVersion(rel.Tag, rel.Name),
		ReleaseURL: rel.URL,
		MergedAt:   mergedAt,
	}, nil
}

// firstReleaseAfter picks the earliest published, non-prerelease release that
// went out after the fix was merged. Prereleases are excluded: telling
// somebody their fix is in a build they cannot get is worse than saying
// nothing.
func firstReleaseAfter(releases []shippedRelease, mergedAt time.Time) *shippedRelease {
	var best *shippedRelease
	for i := range releases {
		r := &releases[i]
		if r.Prerelease || r.PublishedAt.IsZero() || !r.PublishedAt.After(mergedAt) {
			continue
		}
		if best == nil || r.PublishedAt.Before(best.PublishedAt) {
			best = r
		}
	}
	return best
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
