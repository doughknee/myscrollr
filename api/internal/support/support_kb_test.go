package support

import (
	"encoding/json"
	"os"
	"regexp"
	"strings"
	"testing"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
)

// The knowledge base is what the AI repeats to users, so this pins the
// facts that went wrong last time: the version it names, the widgets it
// knows, the retired per-tier polling story, and the size budget. The
// CI guard (`make kb` + git diff) proves it is current; this proves it is
// right in the ways that matter.
func TestKnowledgeBase(t *testing.T) {
	kb := supportKnowledgeBase()

	if n := len(kb); n > 80*1024 {
		t.Fatalf("knowledge base is %d bytes; the limit is 80 KB", n)
	}

	// Names the desktop version the repo is at. package.json lives outside
	// the api module, so skip (visibly) when it is not on disk — the same
	// carve-out gents_test makes for `make shell svc=core-api`.
	if raw, err := os.ReadFile("../../../desktop/package.json"); err == nil {
		var pkg struct{ Version string }
		if err := json.Unmarshal(raw, &pkg); err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(kb, "Current desktop version: **"+pkg.Version+"**") {
			t.Errorf("knowledge base does not name desktop version %s; run `make kb`", pkg.Version)
		}
	} else {
		t.Log("desktop/package.json not on disk; skipping the version check")
	}

	// Every catalog widget, utilities included — the old KB denied that
	// weather, clock, timer and sysmon existed.
	for _, w := range platform.Catalog() {
		if !strings.Contains(kb, "**"+w.Name+"**") {
			t.Errorf("catalog widget %q is missing from the knowledge base", w.Name)
		}
	}

	for _, re := range []string{
		`v1\.0\.4`,
		`(?i)polling-based`,
		`(?i)real-time SSE`,
		// Internal infrastructure is never named to users, so it is not in
		// the document at all (POLICIES "Never say").
		`(?i)\b(sequin|logto|coolify|kubernetes|k8s|digitalocean|osticket|redis|postgres)\b`,
	} {
		if m := regexp.MustCompile(re).FindString(kb); m != "" {
			t.Errorf("knowledge base contains %q (matched %s)", m, re)
		}
	}

	for _, must := range []string{
		"## Policies", "## Plans and limits", "## Widget catalog", "## Settings",
		"## How the ticker works", "## Recent release notes",
		"Settings › Ticker › Show the ticker:", "<!-- source: docs/support/POLICIES.md @ ",
	} {
		if !strings.Contains(kb, must) {
			t.Errorf("knowledge base lacks %q", must)
		}
	}
}
