package support

import (
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

	// "Current desktop version" is the newest published Stable release, never a
	// prerelease (SCROLLR-445): desktop/package.json carries the Beta line.
	if v := currentDesktopVersion(); v == "" || !platform.ValidVersion(v) || platform.IsPrerelease(v) {
		t.Errorf("knowledge base current desktop version = %q, want a Stable release", v)
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
