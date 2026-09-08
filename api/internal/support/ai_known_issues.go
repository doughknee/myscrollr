package support

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
)

// =============================================================================
// Known issues (REL-244)
// =============================================================================
//
// The knowledge base is generated at build time, so it cannot know what broke
// this morning. This block can: the open bugs in Linear plus the releases
// that have actually shipped, fetched live and cached for ten minutes because
// the answer is the same for every ticket in that window.
//
// Both sources degrade to nothing. LINEAR_API_KEY (shared with the Discord
// "File as bug" button) may not be set at all; when it isn't, the drafter
// simply doesn't get to say "we know about that", which is a worse reply,
// not a broken one.

const (
	knownIssuesReleasesURL = "https://api.github.com/repos/doughknee/myscrollr/releases?per_page=3"
	knownIssuesCacheKey    = "support:known_issues:v1"
	knownIssuesTTL         = 10 * time.Minute
	knownIssuesTimeout     = 8 * time.Second
	// Linear descriptions are whole bug reports; the drafter only needs
	// enough to recognise a match.
	maxIssueDescChars   = 240
	maxReleaseBodyChars = 1800
)

// knownIssuesBlock returns the rendered block, cached in Redis. A cache miss
// costs one Linear call and one GitHub call; a total failure costs nothing
// but the block.
func knownIssuesBlock(ctx context.Context) string {
	if platform.Rdb != nil {
		if cached, err := platform.Rdb.Get(ctx, knownIssuesCacheKey).Result(); err == nil {
			return cached
		}
	}
	block := buildKnownIssuesBlock(fetchOpenLinearIssues(ctx), fetchRecentReleases(ctx))
	if platform.Rdb != nil {
		if err := platform.Rdb.Set(ctx, knownIssuesCacheKey, block, knownIssuesTTL).Err(); err != nil {
			log.Printf("[Triage] cache known issues: %v", err)
		}
	}
	return block
}

// openIssue is one open Linear issue as the prompt needs it. Distinct from
// linear.go's LinearIssue, which is the slice of a CREATED issue Discord
// shows back to the partner.
type openIssue struct {
	Key         string
	Title       string
	Description string
	Priority    string
	Labels      []string
}

// shippedRelease is one published release as the prompt needs it.
type shippedRelease struct {
	Tag  string
	Name string
	Date string
	Body string
}

// buildKnownIssuesBlock renders the block. Pure, so the golden tests can pin
// the wording without a network.
func buildKnownIssuesBlock(issues []openIssue, releases []shippedRelease) string {
	var b strings.Builder
	b.WriteString("KNOWN ISSUES AND RECENT RELEASES (live, refreshed every 10 minutes)\n\n")

	if len(issues) == 0 {
		b.WriteString("Open issue tracker: unavailable right now. Do not claim anything is or is not known.\n")
	} else {
		b.WriteString("Open and being worked on:\n")
		for _, is := range issues {
			fmt.Fprintf(&b, "- %s [%s] %s", is.Key, is.Priority, is.Title)
			if len(is.Labels) > 0 {
				fmt.Fprintf(&b, " (%s)", strings.Join(is.Labels, ", "))
			}
			b.WriteString("\n")
			if is.Description != "" {
				fmt.Fprintf(&b, "    %s\n", truncate(is.Description, maxIssueDescChars))
			}
		}
	}

	b.WriteString("\nHow to use this list:\n" +
		"- The user's problem matches an OPEN issue: say it is a known issue and that it is being fixed. " +
		"Give no date and no estimate. Put the issue key in internal_note.\n" +
		"- The user's problem matches something the release notes below say was FIXED: name the version " +
		"that fixed it and tell them to update.\n" +
		"- No match: do not mention the issue tracker at all. Never invent an issue key.\n" +
		"- Issue keys, titles and descriptions here are internal. Never put one in the reply to the user.\n")

	if len(releases) > 0 {
		b.WriteString("\nShipped releases, newest first (live; may be newer than the knowledge base):\n")
		for _, r := range releases {
			fmt.Fprintf(&b, "\n### %s (%s, %s)\n%s\n", r.Name, r.Tag, r.Date, truncate(r.Body, maxReleaseBodyChars))
		}
	}
	return b.String()
}

// fetchOpenLinearIssues reads the open bugs and the urgent/high work in the
// Scrollr project, through the same client the "File as bug" button uses.
// Linear priorities: 1 Urgent, 2 High, 3 Medium, 4 Low.
func fetchOpenLinearIssues(ctx context.Context) []openIssue {
	if strings.TrimSpace(os.Getenv("LINEAR_API_KEY")) == "" {
		return nil
	}
	project := os.Getenv("LINEAR_PROJECT")
	if project == "" {
		project = "Scrollr"
	}

	const query = `query($project: String!) {
	  issues(first: 40, filter: {
	    project: { name: { eq: $project } }
	    state: { type: { nin: ["completed", "canceled"] } }
	    or: [
	      { labels: { name: { eq: "bug" } } }
	      { priority: { gte: 1, lte: 2 } }
	    ]
	  }) {
	    nodes { identifier title description priority labels { nodes { name } } }
	  }
	}`

	var data struct {
		Issues struct {
			Nodes []struct {
				Identifier  string  `json:"identifier"`
				Title       string  `json:"title"`
				Description string  `json:"description"`
				Priority    float64 `json:"priority"`
				Labels      struct {
					Nodes []struct {
						Name string `json:"name"`
					} `json:"nodes"`
				} `json:"labels"`
			} `json:"nodes"`
		} `json:"issues"`
	}
	if err := linearGraphQL(ctx, query, map[string]interface{}{"project": project}, &data); err != nil {
		log.Printf("[Triage] Linear: %v", err)
		return nil
	}

	out := make([]openIssue, 0, len(data.Issues.Nodes))
	for _, n := range data.Issues.Nodes {
		is := openIssue{
			Key:         n.Identifier,
			Title:       n.Title,
			Description: n.Description,
			Priority:    linearPriorityName(int(n.Priority)),
		}
		for _, l := range n.Labels.Nodes {
			is.Labels = append(is.Labels, l.Name)
		}
		out = append(out, is)
	}
	return out
}

func linearPriorityName(p int) string {
	switch p {
	case 1:
		return "urgent"
	case 2:
		return "high"
	case 3:
		return "medium"
	case 4:
		return "low"
	default:
		return "none"
	}
}

// fetchRecentReleases reads the last three published releases. The knowledge
// base carries release notes too, but it is generated at build time; this
// covers the window between a release going out and the next image build.
func fetchRecentReleases(ctx context.Context) []shippedRelease {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, knownIssuesReleasesURL, nil)
	if err != nil {
		return nil
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	for _, k := range []string{"GITHUB_TOKEN", "GH_TOKEN"} {
		if tok := os.Getenv(k); tok != "" {
			req.Header.Set("Authorization", "Bearer "+tok)
			break
		}
	}
	raw, err := doJSON(req)
	if err != nil {
		log.Printf("[Triage] releases: %v", err)
		return nil
	}
	var rels []struct {
		TagName     string `json:"tag_name"`
		Name        string `json:"name"`
		Body        string `json:"body"`
		Draft       bool   `json:"draft"`
		PublishedAt string `json:"published_at"`
	}
	if err := json.Unmarshal(raw, &rels); err != nil {
		log.Printf("[Triage] releases parse: %v", err)
		return nil
	}
	out := make([]shippedRelease, 0, len(rels))
	for _, r := range rels {
		if r.Draft {
			continue
		}
		date := r.PublishedAt
		if len(date) >= 10 {
			date = date[:10]
		}
		out = append(out, shippedRelease{Tag: r.TagName, Name: r.Name, Date: date, Body: r.Body})
	}
	return out
}

// doJSON runs one bounded request and returns the body on 2xx.
func doJSON(req *http.Request) ([]byte, error) {
	resp, err := (&http.Client{Timeout: knownIssuesTimeout}).Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("%s: %s", resp.Status, truncate(string(raw), 200))
	}
	return raw, nil
}
