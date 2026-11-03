package support

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path"
	"regexp"
	"strings"
	"time"
)

var provenFixGitHubURL = "https://api.github.com/repos/doughknee/myscrollr"
var provenFixDownloadURL = "https://github.com/doughknee/myscrollr/releases/download"
var stableDesktopTag = regexp.MustCompile(`^desktop-v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$`)
var commitSHA = regexp.MustCompile(`^[a-f0-9]{40}$`)
var pullPath = regexp.MustCompile(`^/(doughknee|brandon-relentnet)/myscrollr/pull/([1-9][0-9]*)$`)

// IsStableDesktopTag rejects beta/backend events before any support side effect.
func IsStableDesktopTag(tag string) bool { return stableDesktopTag.MatchString(tag) }

func proofJSON(ctx context.Context, route string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, provenFixGitHubURL+route, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	for _, key := range []string{"GITHUB_TOKEN", "GH_TOKEN"} {
		if token := os.Getenv(key); token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
			break
		}
	}
	data, err := doJSON(req)
	if err != nil {
		return err
	}
	return json.Unmarshal(data, out)
}

type closingMerge struct {
	SHA      string
	MergedAt time.Time
}

// Resolve the actual merge SHA from GitHub, never a model/attachment timestamp.
func closesIssue(text string, keys ...string) bool {
	for _, key := range keys {
		if key == "" {
			continue
		}
		// Conservative convention: a dedicated affirmative closing line, not
		// a related mention, quoted discussion, or "does not fix ..." prose.
		pattern := `(?im)^\s*(?:[-*]\s+)?(?:closes?|closed|fixes|fixed|fix|resolves?|resolved)[ \t]+(?:\[|https://linear\.app/[^/\s]+/issue/)?` + regexp.QuoteMeta(key) + `(?:\b)`
		if regexp.MustCompile(pattern).MatchString(text) {
			return true
		}
	}
	return false
}

func closingPull(ctx context.Context, rawURL string, keys ...string) (closingMerge, error) {
	u, err := url.Parse(rawURL)
	if err != nil || u.Scheme != "https" || u.Host != "github.com" || u.User != nil {
		return closingMerge{}, nil
	}
	match := pullPath.FindStringSubmatch(u.Path)
	if match == nil {
		return closingMerge{}, nil
	}
	var pr struct {
		Merged   bool      `json:"merged"`
		SHA      string    `json:"merge_commit_sha"`
		MergedAt time.Time `json:"merged_at"`
		Title    string    `json:"title"`
		Body     string    `json:"body"`
		Base     struct {
			Repo struct {
				FullName string `json:"full_name"`
			} `json:"repo"`
		} `json:"base"`
	}
	if err := proofJSON(ctx, "/pulls/"+match[2], &pr); err != nil {
		return closingMerge{}, err
	}
	if !pr.Merged || !commitSHA.MatchString(pr.SHA) || pr.MergedAt.IsZero() || pr.Base.Repo.FullName != "doughknee/myscrollr" || !closesIssue(pr.Title+"\n"+pr.Body, keys...) {
		return closingMerge{}, nil
	}
	return closingMerge{pr.SHA, pr.MergedAt}, nil
}

func hasDesktopInstallers(names []string, version string) bool {
	var windows, mac, linux, manifest bool
	for _, name := range names {
		windows = windows || name == "Scrollr_"+version+"_x64-setup.exe"
		mac = mac || name == "Scrollr_"+version+"_aarch64.dmg"
		linux = linux || name == "Scrollr_"+version+"_amd64.AppImage"
		manifest = manifest || name == "latest.json"
	}
	return windows && mac && linux && manifest
}

func releaseContains(ctx context.Context, rel shippedRelease, merge closingMerge) (bool, error) {
	if !IsStableDesktopTag(rel.Tag) || rel.Prerelease || rel.PublishedAt.IsZero() || rel.PublishedAt.Before(merge.MergedAt) ||
		!commitSHA.MatchString(merge.SHA) || !hasDesktopInstallers(rel.Assets, releaseVersion(rel.Tag, rel.Name)) {
		return false, nil
	}
	if rel.VerifiedSource == "" {
		ok, err := verifyPublishedAssets(ctx, &rel)
		if err != nil || !ok {
			return false, err
		}
	}
	var comparison struct {
		Status string `json:"status"`
		Base   struct {
			SHA string `json:"sha"`
		} `json:"base_commit"`
		MergeBase struct {
			SHA string `json:"sha"`
		} `json:"merge_base_commit"`
	}
	err := proofJSON(ctx, "/compare/"+merge.SHA+"..."+rel.VerifiedSource, &comparison)
	if err != nil {
		return false, err
	}
	return (comparison.Status == "ahead" || comparison.Status == "identical") && comparison.Base.SHA == merge.SHA && comparison.MergeBase.SHA == merge.SHA, nil
}

func publishedDesktopRelease(ctx context.Context, tag string) (*shippedRelease, error) {
	if !IsStableDesktopTag(tag) {
		return nil, nil
	}
	var r struct {
		Tag         string    `json:"tag_name"`
		Name        string    `json:"name"`
		URL         string    `json:"html_url"`
		PublishedAt time.Time `json:"published_at"`
		Draft       bool      `json:"draft"`
		Prerelease  bool      `json:"prerelease"`
		Assets      []struct {
			Name   string `json:"name"`
			Digest string `json:"digest"`
		} `json:"assets"`
	}
	if err := proofJSON(ctx, "/releases/tags/"+url.PathEscape(tag), &r); err != nil {
		return nil, err
	}
	if r.Tag != tag || r.Draft || r.Prerelease || r.PublishedAt.IsZero() {
		return nil, nil
	}
	if r.URL != "https://github.com/doughknee/myscrollr/releases/tag/"+tag {
		return nil, fmt.Errorf("unexpected release URL")
	}
	result := &shippedRelease{Tag: r.Tag, Name: r.Name, URL: r.URL, PublishedAt: r.PublishedAt, Digests: map[string]string{}}
	for _, a := range r.Assets {
		result.Assets = append(result.Assets, a.Name)
		result.Digests[a.Name] = a.Digest
	}
	if !hasDesktopInstallers(result.Assets, releaseVersion(tag, r.Name)) {
		return nil, nil
	}
	if ok, err := verifyPublishedAssets(ctx, result); err != nil || !ok {
		return nil, err
	}
	return result, nil
}

// The finalizer publishes this small record after verifying Actions-bound hashes
// and updater signatures. GitHub's asset digests bind it to the downloadable
// installers; the actual tag must still point at the recorded build source.
// Old releases without this evidence produce no automatic shipped-fix claim.
func verifyPublishedAssets(ctx context.Context, rel *shippedRelease) (bool, error) {
	if rel.Digests["verification.json"] == "" {
		return false, nil
	}
	readAsset := func(name string) ([]byte, error) {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, provenFixDownloadURL+"/"+url.PathEscape(rel.Tag)+"/"+name, nil)
		if err != nil {
			return nil, err
		}
		data, err := doJSON(req)
		if err != nil {
			return nil, err
		}
		if fmt.Sprintf("sha256:%x", sha256.Sum256(data)) != rel.Digests[name] {
			return nil, fmt.Errorf("release evidence digest mismatch")
		}
		return data, nil
	}
	data, err := readAsset("verification.json")
	if err != nil {
		return false, err
	}
	var proof struct {
		Schema  int               `json:"schema"`
		Version string            `json:"version"`
		Source  string            `json:"source"`
		RunID   string            `json:"runId"`
		Assets  map[string]string `json:"assets"`
	}
	if err := json.Unmarshal(data, &proof); err != nil {
		return false, err
	}
	version := releaseVersion(rel.Tag, rel.Name)
	if proof.Schema != 1 || proof.Version != version || !commitSHA.MatchString(proof.Source) || proof.RunID == "" {
		return false, nil
	}
	var provenNames []string
	for name, digest := range proof.Assets {
		if len(digest) != 64 || rel.Digests[name] != "sha256:"+digest {
			return false, nil
		}
		provenNames = append(provenNames, name)
	}
	if !hasDesktopInstallers(provenNames, version) {
		return false, nil
	}
	data, err = readAsset("latest.json")
	if err != nil {
		return false, err
	}
	var manifest struct {
		Version   string `json:"version"`
		Platforms map[string]struct {
			URL       string `json:"url"`
			Signature string `json:"signature"`
		} `json:"platforms"`
	}
	if err := json.Unmarshal(data, &manifest); err != nil {
		return false, err
	}
	if manifest.Version != version {
		return false, nil
	}
	for _, target := range []string{"windows-x86_64", "windows-x86_64-nsis", "darwin-aarch64", "linux-x86_64"} {
		entry, exists := manifest.Platforms[target]
		u, err := url.Parse(entry.URL)
		if !exists || err != nil || u.Scheme != "https" || u.Host != "github.com" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || len(entry.Signature) < 20 {
			return false, nil
		}
		name := path.Base(u.Path)
		if strings.Contains(name, "\\") || u.Path != "/doughknee/myscrollr/releases/download/"+rel.Tag+"/"+name || proof.Assets[name] == "" {
			return false, nil
		}
		expectedName := map[string]string{"windows-x86_64": "Scrollr_" + version + "_x64_en-US.msi", "windows-x86_64-nsis": "Scrollr_" + version + "_x64-setup.exe", "darwin-aarch64": "Scrollr_aarch64.app.tar.gz", "linux-x86_64": "Scrollr_" + version + "_amd64.AppImage"}[target]
		if name != expectedName {
			return false, nil
		}
	}
	var commit struct {
		SHA string `json:"sha"`
	}
	if err := proofJSON(ctx, "/commits/"+url.PathEscape("refs/tags/"+rel.Tag), &commit); err != nil {
		return false, err
	}
	if commit.SHA != proof.Source {
		return false, nil
	}
	rel.VerifiedSource = proof.Source
	return true, nil
}
