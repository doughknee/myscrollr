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
)

func TestStableDesktopReleaseTag(t *testing.T) {
	for _, tag := range []string{"server-2026.11.03.1", "desktop-v1.8.0-beta.1", "desktop-v1.8.0-rc.1", "desktop-v01.8.0", "desktop-v1.8", "1.8.0", "desktop-v1.8.0\n"} {
		if IsStableDesktopTag(tag) {
			t.Errorf("accepted %q", tag)
		}
	}
	if !IsStableDesktopTag("desktop-v1.8.0") {
		t.Fatal("rejected stable")
	}
}

func TestProvenFixRejectsUnrelatedOrUnavailableRelease(t *testing.T) {
	for _, test := range []string{"backend", "hotfix without feature", "missing installer", "mislabeled beta"} {
		t.Run(test, func(t *testing.T) {
			r := release("desktop-v1.7.3", "2026-09-02T12:00:00Z", false)
			switch test {
			case "backend":
				r["tag_name"] = "server-2026.09.02.1"
			case "hotfix without feature":
				r["contains"] = false
			case "missing installer":
				r["assets"] = []map[string]string{{"name": "latest.json"}}
			case "mislabeled beta":
				r["tag_name"] = "desktop-v1.8.0-beta.1"
			}
			stubLinearAndReleases(t, "completed", "2026-09-01T10:00:00Z", []map[string]interface{}{r})
			if pf, err := computeProvenFix(context.Background(), "SCROLLR-419"); err != nil || pf != nil {
				t.Fatalf("unexpected proof: %+v %v", pf, err)
			}
		})
	}
}

func TestProvenFixSkipsUnrelatedHotfixForContainingRelease(t *testing.T) {
	hotfix := release("desktop-v1.7.3", "2026-09-02T12:00:00Z", false)
	hotfix["contains"] = false
	final := release("desktop-v1.8.0", "2026-09-03T12:00:00Z", false)
	stubLinearAndReleases(t, "completed", "2026-09-01T10:00:00Z", []map[string]interface{}{final, hotfix})
	pf, err := computeProvenFix(context.Background(), "SCROLLR-419")
	if err != nil || pf == nil || pf.Version != "1.8.0" {
		t.Fatalf("wrong containing release: %+v %v", pf, err)
	}
}

func TestClosingIssueRequiresExactExplicitClosure(t *testing.T) {
	for _, text := range []string{"Closes SCROLLR-419", "Fixes [SCROLLR-419](https://linear.app/relentnet/issue/SCROLLR-419/foo)", "Resolves https://linear.app/relentnet/issue/SCROLLR-419/foo"} {
		if !closesIssue(text, "SCROLLR-419") {
			t.Errorf("rejected closure %q", text)
		}
	}
	for _, text := range []string{"Related to SCROLLR-419", "Closes SCROLLR-4190", "SCROLLR-419", "Closes REL-419", "This does not fix SCROLLR-419", "This only partially fixes SCROLLR-419", "> Fixes SCROLLR-419"} {
		if closesIssue(text, "SCROLLR-419") {
			t.Errorf("accepted unrelated mention %q", text)
		}
	}
}

func TestPublishedEvidenceFailsClosed(t *testing.T) {
	for _, scenario := range []string{"valid", "missing proof", "replaced metadata", "replaced installer", "wrong version", "wrong tag commit", "cross-release URL", "wrong target installer"} {
		t.Run(scenario, func(t *testing.T) {
			tag := "desktop-v1.8.0"
			files := testReleaseFiles(tag)
			if scenario == "wrong version" || scenario == "cross-release URL" || scenario == "wrong target installer" {
				var manifest map[string]interface{}
				_ = json.Unmarshal(files["latest.json"], &manifest)
				if scenario == "wrong version" {
					manifest["version"] = "1.9.0"
				} else {
					platforms := manifest["platforms"].(map[string]interface{})
					entry := platforms["windows-x86_64"].(map[string]interface{})
					if scenario == "cross-release URL" {
						entry["url"] = strings.Replace(entry["url"].(string), tag, "desktop-v1.7.0", 1)
					} else {
						platforms["windows-x86_64"] = platforms["linux-x86_64"]
					}
				}
				files["latest.json"], _ = json.Marshal(manifest)
				var proof map[string]interface{}
				_ = json.Unmarshal(files["verification.json"], &proof)
				proof["assets"].(map[string]interface{})["latest.json"] = fmt.Sprintf("%x", sha256.Sum256(files["latest.json"]))
				files["verification.json"], _ = json.Marshal(proof)
			}
			rel := shippedRelease{Tag: tag, Digests: map[string]string{}}
			for name, data := range files {
				rel.Assets = append(rel.Assets, name)
				rel.Digests[name] = fmt.Sprintf("sha256:%x", sha256.Sum256(data))
			}
			if scenario == "missing proof" {
				delete(rel.Digests, "verification.json")
			}
			if scenario == "replaced installer" {
				rel.Digests["Scrollr_1.8.0_x64-setup.exe"] = "sha256:" + strings.Repeat("f", 64)
			}
			if scenario == "replaced metadata" {
				files["verification.json"] = []byte(`{}`)
			}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if strings.HasPrefix(r.URL.Path, "/commits/") {
					source := testReleaseSource(tag)
					if scenario == "wrong tag commit" {
						source = strings.Repeat("f", 40)
					}
					_ = json.NewEncoder(w).Encode(map[string]string{"sha": source})
					return
				}
				parts := strings.Split(r.URL.Path, "/")
				_, _ = w.Write(files[parts[len(parts)-1]])
			}))
			defer server.Close()
			oldAPI, oldDownload := provenFixGitHubURL, provenFixDownloadURL
			provenFixGitHubURL, provenFixDownloadURL = server.URL, server.URL
			defer func() { provenFixGitHubURL, provenFixDownloadURL = oldAPI, oldDownload }()
			ok, err := verifyPublishedAssets(context.Background(), &rel)
			if scenario == "valid" {
				if !ok || err != nil {
					t.Fatalf("valid evidence rejected: %v", err)
				}
			} else if ok {
				t.Fatal("invalid evidence accepted")
			}
		})
	}
}
