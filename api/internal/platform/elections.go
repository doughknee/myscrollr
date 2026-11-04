package platform

import (
	"math"
	"os"
	"slices"
)

// Election previews require both an opted-in server and a capable client.
func ElectionsBetaEnabled() bool { return os.Getenv("ELECTIONS_BETA_ENABLED") == "true" }

func ElectionsPreview(preview string) bool {
	return preview == "elections" && ElectionsBetaEnabled()
}

var electionWidget = WidgetDef{
	ID: "elections", Name: "Election Results", Source: "elections", Category: "news",
	Color: "#818cf8", Group: "Elections", RequiredTier: "free", Order: len(catalog),
	Description:   "Follow vote counts as selected U.S. races report.",
	About:         "Follow selected U.S. election results from CivicAPI. Vote counts are preliminary and may change.",
	Usage:         []string{"Open Election Results and follow a supported race."},
	Keywords:      []string{"election", "voting", "governor", "politics"},
	DefaultConfig: map[string]any{"race_ids": []int{}},
}

// ElectionsCatalog is a separate variant. Bundled snapshots, public pages and
// stable clients all continue to use Catalog.
func ElectionsCatalog() []WidgetDef {
	return append(slices.Clone(catalog), electionWidget)
}

// VisibleWidgets removes private-preview rows for clients without the renderer.
// The caller owns rows (per-request DB result or decoded dashboard).
func VisibleWidgets(rows []Widget, preview bool) []Widget {
	if preview {
		return rows
	}
	return slices.DeleteFunc(rows, func(w Widget) bool { return w.WidgetType == "elections" })
}

// ElectionRaceIDs parses the stored JSON shape for both writes and topic
// subscriptions. Only integers in the SQL INTEGER range are valid IDs.
func ElectionRaceIDs(config map[string]any) ([]int, bool) {
	values, ok := config["race_ids"].([]any)
	if !ok || len(config) != 1 || len(values) > 12 {
		return nil, false
	}
	ids := make([]int, 0, len(values))
	for _, v := range values {
		n, ok := v.(float64)
		if !ok || n < 1 || n > math.MaxInt32 || n != math.Trunc(n) || slices.Contains(ids, int(n)) {
			return nil, false
		}
		ids = append(ids, int(n))
	}
	return ids, true
}
