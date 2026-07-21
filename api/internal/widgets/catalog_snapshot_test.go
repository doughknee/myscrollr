package widgets

import (
	"encoding/json"
	"flag"
	"os"
	"path/filepath"
	"testing"
)

// Regenerate the bundled snapshot instead of asserting against it:
//
//	go -C api test ./internal/widgets -run TestCatalogSnapshot -update
//
// Replaces the previous instruction to curl a running server and pipe it
// through python — that needed a booted API with a live database just to
// re-emit a value this package already computes.
var updateSnapshot = flag.Bool("update", false, "rewrite desktop/src/catalog.snapshot.json from this catalog")

// The desktop bundles desktop/src/catalog.snapshot.json so the ticker renders
// offline and on first run (VISION §4.2, constraint 1). That snapshot is
// GENERATED from this server's catalog and must never be hand-edited — a
// stale one ships wrong names, colors, or a missing widget to every user who
// starts up offline.
//
// This is the same drift-guard shape as tier_limits.json: one side is the
// authority, a test pins the other to it, and CI fails on whichever was left
// behind.
//
// To regenerate after changing the catalog, re-run this test with -update
// (see the flag above).
func TestCatalogSnapshotMatchesServer(t *testing.T) {
	path := filepath.Join("..", "..", "..", "desktop", "src", "catalog.snapshot.json")

	if *updateSnapshot {
		catalogOnce.Do(buildCatalog)
		out, err := json.MarshalIndent(catalogBody, "", "    ")
		if err != nil {
			t.Fatalf("marshal catalog: %v", err)
		}
		if err := os.WriteFile(path, append(out, '\n'), 0o644); err != nil {
			t.Fatalf("write snapshot: %v", err)
		}
		t.Logf("regenerated %s (%d widgets, version %s)", path, len(catalogBody.Widgets), catalogBody.Version)
		return
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read bundled snapshot: %v", err)
	}

	var bundled CatalogResponse
	if err := json.Unmarshal(raw, &bundled); err != nil {
		t.Fatalf("parse bundled snapshot: %v", err)
	}

	catalogOnce.Do(buildCatalog)
	live := catalogBody

	if bundled.Version != live.Version {
		t.Errorf("snapshot version %q != server %q — the catalog changed but "+
			"desktop/src/catalog.snapshot.json was not regenerated (see the "+
			"command in this test's doc comment)", bundled.Version, live.Version)
	}

	if len(bundled.Widgets) != len(live.Widgets) {
		t.Fatalf("snapshot has %d widgets, server has %d", len(bundled.Widgets), len(live.Widgets))
	}

	// Compare field-by-field rather than reflect.DeepEqual so a mismatch
	// names the widget and field that drifted.
	for i, want := range live.Widgets {
		got := bundled.Widgets[i]
		if got.ID != want.ID {
			t.Errorf("widget[%d]: snapshot id %q, server %q", i, got.ID, want.ID)
			continue
		}
		gotJSON, _ := json.Marshal(got)
		wantJSON, _ := json.Marshal(want)
		if string(gotJSON) != string(wantJSON) {
			t.Errorf("widget %q drifted:\n  snapshot: %s\n  server:   %s", want.ID, gotJSON, wantJSON)
		}
	}
}
