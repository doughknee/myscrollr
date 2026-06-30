package core

import "strings"

// Widget registry — the user-facing primitive of the 2026-06-30 widget/slot
// redesign. A "widget" is a named, pre-filtered view over a backing data
// source (or a local-only utility). This registry is code-defined and
// DECOUPLED from Redis service discovery (GetValidChannelTypes): a widget
// type is valid because it maps to a known data source, not because a
// service registered a channel of that exact name.
//
// Two responsibilities on the API side:
//  1. Validate `channel_type` on create/update (IsKnownWidgetType), additive
//     alongside the legacy service-discovery validation during the transition.
//  2. Map a widget to its backing data source (DataSourceForWidget) so the
//     CDC subscription logic in events.go / channels.go stays source-driven
//     instead of hardcoding `if channelType == "sports"`.
//
// Sports leagues and finance asset classes are dynamic (the sports league
// set is a server catalog), so those widgets are matched by source PREFIX
// (`sports_*` → sports, `finance_*` → finance) rather than enumerated. The
// per-league/per-symbol routing already keys off the row's config, which the
// migration carries forward — so `sports_nfl` with config.leagues=["NFL"]
// routes to cdc:sports:NFL with no hardcoded league table.

// WidgetKind distinguishes data-backed widgets from local-only utilities.
type WidgetKind string

const (
	WidgetData    WidgetKind = "data"    // backed by a data source + CDC
	WidgetUtility WidgetKind = "utility" // local-only (clock, weather, …)
)

// WidgetDef is the catalog entry for one widget. Every widget costs exactly
// one slot. DataSource is the backing channel/service name ("" for utilities).
type WidgetDef struct {
	ID         string     `json:"id"`
	Label      string     `json:"label"`
	Kind       WidgetKind `json:"kind"`
	DataSource string     `json:"data_source"`
}

// featuredWidgets is the curated catalog of first-class widgets shown in the
// desktop Library. Sports leagues beyond these still work via the "sports_"
// source prefix (the league set is a dynamic server catalog); the marquee
// leagues are enumerated here so the catalog and labels are stable.
var featuredWidgets = []WidgetDef{
	// Sports — one widget per marquee league (source: sports).
	{ID: "sports_nfl", Label: "NFL", Kind: WidgetData, DataSource: "sports"},
	{ID: "sports_nba", Label: "NBA", Kind: WidgetData, DataSource: "sports"},
	{ID: "sports_nhl", Label: "NHL", Kind: WidgetData, DataSource: "sports"},
	{ID: "sports_mlb", Label: "MLB", Kind: WidgetData, DataSource: "sports"},
	{ID: "sports_f1", Label: "F1", Kind: WidgetData, DataSource: "sports"},
	{ID: "sports_worldcup", Label: "World Cup", Kind: WidgetData, DataSource: "sports"},
	// Finance — split by asset class (source: finance).
	{ID: "finance_stocks", Label: "Stocks", Kind: WidgetData, DataSource: "finance"},
	{ID: "finance_crypto", Label: "Crypto", Kind: WidgetData, DataSource: "finance"},
	// News (rss), Fantasy (yahoo), Predictions (kalshi).
	{ID: "news", Label: "News", Kind: WidgetData, DataSource: "rss"},
	{ID: "fantasy_yahoo", Label: "Yahoo Fantasy", Kind: WidgetData, DataSource: "fantasy"},
	{ID: "predictions", Label: "Predictions", Kind: WidgetData, DataSource: "predictions"},
	// Local-only utility widgets — no data source, no CDC, but still cost a slot.
	{ID: "clock", Label: "Clock", Kind: WidgetUtility},
	{ID: "timer", Label: "Timer", Kind: WidgetUtility},
	{ID: "weather", Label: "Weather", Kind: WidgetUtility},
	{ID: "sysmon", Label: "System Monitor", Kind: WidgetUtility},
	{ID: "uptime", Label: "Uptime", Kind: WidgetUtility},
	{ID: "github", Label: "GitHub", Kind: WidgetUtility},
}

// widgetByID indexes featuredWidgets for O(1) lookup.
var widgetByID = func() map[string]WidgetDef {
	m := make(map[string]WidgetDef, len(featuredWidgets))
	for _, w := range featuredWidgets {
		m[w.ID] = w
	}
	return m
}()

// widgetSourcePrefixes maps a widget-type prefix to its backing data source.
// Handles the dynamic dimensions (sports leagues, finance asset classes,
// fantasy providers) without enumerating every value.
var widgetSourcePrefixes = map[string]string{
	"sports_":  "sports",
	"finance_": "finance",
	"fantasy_": "fantasy",
}

// legacyChannelTypes are the pre-migration coarse channel_type values. They
// remain valid (existing rows, and they ARE the service names) and map to
// themselves so the transition is seamless.
var legacyChannelTypes = map[string]string{
	"finance":     "finance",
	"sports":      "sports",
	"rss":         "rss",
	"fantasy":     "fantasy",
	"predictions": "predictions",
}

// DataSourceForWidget returns the backing data source for a widget/channel
// type. Resolution order: explicit registry entry → "news" alias → source
// prefix (sports_*, finance_*, fantasy_*) → legacy coarse type → "" (unknown
// or a utility with no data source). Subscription code switches on this so it
// never hardcodes a channel name.
func DataSourceForWidget(widgetType string) string {
	if def, ok := widgetByID[widgetType]; ok {
		return def.DataSource
	}
	if widgetType == "news" {
		return "rss"
	}
	for prefix, src := range widgetSourcePrefixes {
		if len(widgetType) > len(prefix) && strings.HasPrefix(widgetType, prefix) {
			return src
		}
	}
	if src, ok := legacyChannelTypes[widgetType]; ok {
		return src
	}
	return ""
}

// IsKnownWidgetType reports whether a widget_type is acceptable on create.
// Accepts featured widgets (incl. utilities), anything mapping to a known
// data source (covers dynamic sports leagues / finance classes / fantasy
// providers), and legacy coarse types. Used ADDITIVELY alongside the Redis
// service-discovery check, so both old and new types pass during the
// transition. A bare prefix with no suffix (e.g. "sports_") is rejected
// because DataSourceForWidget requires a non-empty suffix.
func IsKnownWidgetType(widgetType string) bool {
	if _, ok := widgetByID[widgetType]; ok {
		return true
	}
	return DataSourceForWidget(widgetType) != ""
}

// GetFeaturedWidgets returns the curated widget catalog (for a future
// /widgets discovery endpoint and the desktop Library).
func GetFeaturedWidgets() []WidgetDef {
	out := make([]WidgetDef, len(featuredWidgets))
	copy(out, featuredWidgets)
	return out
}
