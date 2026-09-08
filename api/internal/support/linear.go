package support

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

// =============================================================================
// Linear — file a bug from a support thread (REL-245)
// =============================================================================
//
// One button in the Discord queue turns a ticket into a Linear issue, and
// one release webhook asks whether the issue behind a case is Done yet.
// That is the whole surface, so this is a hand-rolled GraphQL client over
// net/http rather than a generated one: three queries, no schema to track.
//
// LINEAR_API_KEY lives in the scrollr-secrets Secret. When it is absent
// every entry point here returns an error the caller shows in the thread —
// nothing else in the pipeline degrades.

const linearTimeout = 10 * time.Second

// linearAPIURL is a var so the proven-fix tests can point the client at a
// stub, exactly as discordAPIBase does.
var linearAPIURL = "https://api.linear.app/graphql"

// linearTeamKey is the team new issues are filed into. Scrollr's work all
// lives in one Linear team, so this is a config value, not a picker.
func linearTeamKey() string {
	if k := strings.TrimSpace(os.Getenv("LINEAR_TEAM_KEY")); k != "" {
		return k
	}
	return "REL"
}

var linearHTTPClient = &http.Client{Timeout: linearTimeout}

// linearTeamIDCache memoises the team-key → team-id lookup. Team ids never
// change, so once per pod is enough.
var linearTeamIDCache sync.Map // map[teamKey string] -> teamID string

// linearGraphQL runs one query and unmarshals `data` into out. GraphQL
// answers 200 with an `errors` array on failure, so the status check alone
// is not enough.
func linearGraphQL(ctx context.Context, query string, vars map[string]interface{}, out interface{}) error {
	apiKey := strings.TrimSpace(os.Getenv("LINEAR_API_KEY"))
	if apiKey == "" {
		return fmt.Errorf("LINEAR_API_KEY not configured")
	}

	body, err := json.Marshal(map[string]interface{}{"query": query, "variables": vars})
	if err != nil {
		return fmt.Errorf("marshal query: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, linearAPIURL, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Authorization", apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := linearHTTPClient.Do(req)
	if err != nil {
		return fmt.Errorf("linear request: %w", err)
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("read response: %w", err)
	}
	if resp.StatusCode >= 400 {
		return fmt.Errorf("linear status %d: %s", resp.StatusCode, truncateForLog(string(respBody)))
	}

	var envelope struct {
		Data   json.RawMessage `json:"data"`
		Errors []struct {
			Message string `json:"message"`
		} `json:"errors"`
	}
	if err := json.Unmarshal(respBody, &envelope); err != nil {
		return fmt.Errorf("parse response: %w", err)
	}
	if len(envelope.Errors) > 0 {
		return fmt.Errorf("linear: %s", envelope.Errors[0].Message)
	}
	if out == nil {
		return nil
	}
	if err := json.Unmarshal(envelope.Data, out); err != nil {
		return fmt.Errorf("parse data: %w", err)
	}
	return nil
}

// linearResolveTeamID turns the team key ("REL") into the UUID the issue
// mutation wants.
func linearResolveTeamID(ctx context.Context) (string, error) {
	key := linearTeamKey()
	if v, ok := linearTeamIDCache.Load(key); ok {
		return v.(string), nil
	}
	const q = `query($key: String!) { teams(filter: { key: { eq: $key } }, first: 1) { nodes { id } } }`
	var out struct {
		Teams struct {
			Nodes []struct {
				ID string `json:"id"`
			} `json:"nodes"`
		} `json:"teams"`
	}
	if err := linearGraphQL(ctx, q, map[string]interface{}{"key": key}, &out); err != nil {
		return "", err
	}
	if len(out.Teams.Nodes) == 0 {
		return "", fmt.Errorf("no Linear team with key %q", key)
	}
	id := out.Teams.Nodes[0].ID
	linearTeamIDCache.Store(key, id)
	return id, nil
}

// LinearIssue is the slice of a created issue we surface back in Discord.
type LinearIssue struct {
	Identifier string `json:"identifier"` // e.g. "REL-251"
	URL        string `json:"url"`
}

// linearCreateIssue files one issue in the configured team. LINEAR_PROJECT_ID
// is optional — when set the issue lands in that project, otherwise in the
// team's backlog.
func linearCreateIssue(ctx context.Context, title, description string) (*LinearIssue, error) {
	teamID, err := linearResolveTeamID(ctx)
	if err != nil {
		return nil, err
	}
	input := map[string]interface{}{
		"teamId":      teamID,
		"title":       title,
		"description": description,
	}
	if p := strings.TrimSpace(os.Getenv("LINEAR_PROJECT_ID")); p != "" {
		input["projectId"] = p
	}

	const q = `mutation($input: IssueCreateInput!) {
		issueCreate(input: $input) { success issue { identifier url } }
	}`
	var out struct {
		IssueCreate struct {
			Success bool         `json:"success"`
			Issue   *LinearIssue `json:"issue"`
		} `json:"issueCreate"`
	}
	if err := linearGraphQL(ctx, q, map[string]interface{}{"input": input}, &out); err != nil {
		return nil, err
	}
	if !out.IssueCreate.Success || out.IssueCreate.Issue == nil {
		return nil, fmt.Errorf("linear issueCreate returned no issue")
	}
	return out.IssueCreate.Issue, nil
}

// linearIssueIsDone reports whether the issue identified by e.g. "REL-239"
// sits in a completed workflow state. Linear's state `type` is the stable
// field here — the display name is per-team and renameable.
func linearIssueIsDone(ctx context.Context, identifier string) (bool, error) {
	const q = `query($id: String!) { issue(id: $id) { state { type } } }`
	var out struct {
		Issue *struct {
			State struct {
				Type string `json:"type"`
			} `json:"state"`
		} `json:"issue"`
	}
	if err := linearGraphQL(ctx, q, map[string]interface{}{"id": identifier}, &out); err != nil {
		return false, err
	}
	if out.Issue == nil {
		return false, fmt.Errorf("no Linear issue %q", identifier)
	}
	return out.Issue.State.Type == "completed", nil
}

// truncateForLog keeps an upstream error body out of the log at full length.
func truncateForLog(s string) string {
	if len(s) > 300 {
		return s[:300] + "…"
	}
	return s
}
