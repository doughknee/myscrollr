package core

import (
	"fmt"

	"github.com/gofiber/fiber/v2"
)

// ChannelLimits is the per-tier cap for every channel feature the frontend
// lets users configure. A nil pointer means "unlimited" — this lets us
// round-trip cleanly through JSON (where Go's Infinity has no analogue)
// and lets clients treat null as "no cap."
type ChannelLimits struct {
	Symbols                *int `json:"symbols"`
	Feeds                  *int `json:"feeds"`
	CustomFeeds            *int `json:"custom_feeds"`
	Leagues                *int `json:"leagues"`
	Fantasy                *int `json:"fantasy"`
	MaxTickerRows          int  `json:"max_ticker_rows"`          // 0 means "inherit free default of 1"
	MaxTickerCustomization bool `json:"max_ticker_customization"` // per-row scroll mode/direction/speed overrides
}

// TierLimitsResponse is the payload of GET /tier-limits.
type TierLimitsResponse struct {
	Tiers map[string]ChannelLimits `json:"tiers"`
}

// DefaultTierLimits is the authoritative source of truth for per-tier caps.
//
// SOURCE OF TRUTH — any change here MUST also propagate to:
//   - api/core/tier_limits.json     (shared sync snapshot — a Go test and
//     both frontends' Vitest suites pin their copies to it, so CI fails
//     on whichever side was left stale)
//   - desktop/src/tierLimits.ts     (kept in sync manually; synchronous
//     reads required by config panels during render)
//   - myscrollr.com/src/lib/fallbackTierLimits.ts (`FALLBACK_LIMITS`,
//     used only for first-paint while the API response is in flight)
//   - api/core/tier_limits_test.go  (assertion protecting this table
//     from silent edits — run `go test ./core/...` after any change)
//
// Once Sprint 3 wires backend enforcement on POST/PUT /users/me/channels,
// these values directly gate what the DB will accept, so drift is
// unforgiving.
var DefaultTierLimits = map[string]ChannelLimits{
	"free":            {Symbols: intPtr(5), Feeds: intPtr(1), CustomFeeds: intPtr(0), Leagues: intPtr(1), Fantasy: intPtr(0), MaxTickerRows: 1, MaxTickerCustomization: false},
	"uplink":          {Symbols: intPtr(25), Feeds: intPtr(25), CustomFeeds: intPtr(1), Leagues: intPtr(8), Fantasy: intPtr(1), MaxTickerRows: 2, MaxTickerCustomization: false},
	"uplink_pro":      {Symbols: intPtr(75), Feeds: intPtr(100), CustomFeeds: intPtr(3), Leagues: intPtr(20), Fantasy: intPtr(3), MaxTickerRows: 3, MaxTickerCustomization: false},
	"uplink_ultimate": {Symbols: nil, Feeds: nil, CustomFeeds: intPtr(10), Leagues: nil, Fantasy: intPtr(10), MaxTickerRows: 3, MaxTickerCustomization: true},
	"super_user":      {Symbols: nil, Feeds: nil, CustomFeeds: nil, Leagues: nil, Fantasy: nil, MaxTickerRows: 3, MaxTickerCustomization: true},
}

// HandleGetTierLimits serves the tier limits map to any caller — clients
// render pricing/comparison UIs from this, and integration tests use it
// to confirm desktop and marketing values agree with the backend.
//
// Unauthenticated on purpose: these numbers are marketing-visible, and
// we want the pricing page to load without a session.
func HandleGetTierLimits(c *fiber.Ctx) error {
	// Short browser + CDN cache. The pricing page fetches this on mount;
	// a 5-minute cache is generous enough to reduce load while still
	// letting us ship a limit change without waiting hours.
	c.Set("Cache-Control", "public, max-age=300")
	return c.JSON(TierLimitsResponse{Tiers: DefaultTierLimits})
}

// intPtr returns a pointer to an int literal — convenience for the table
// above so each row stays readable.
func intPtr(n int) *int {
	return &n
}

// ─── Server-side enforcement ─────────────────────────────────────────

// TierLimitError describes exactly which cap a config submission breached.
// It implements `error` so it can thread through normal return paths, but
// handlers also unwrap it via errors.As to surface a structured 403 body
// the UI can render a precise message from.
type TierLimitError struct {
	Tier        string // "free", "uplink", etc.
	ChannelType string // "finance", "sports", "rss"
	Field       string // "symbols" | "feeds" | "custom_feeds" | "leagues"
	Limit       int
	Got         int
}

func (e *TierLimitError) Error() string {
	return fmt.Sprintf(
		"tier %q allows at most %d %s for %s; got %d",
		e.Tier, e.Limit, e.Field, e.ChannelType, e.Got,
	)
}

// UserFacingMessage returns copy suitable for the `error` field of a 403
// response body. Kept short and specific so the UI can show it verbatim.
func (e *TierLimitError) UserFacingMessage() string {
	return fmt.Sprintf(
		"Your %s plan allows %d %s; you tried to save %d.",
		TierDisplayName(e.Tier), e.Limit, e.Field, e.Got,
	)
}

// TierDisplayName maps a tier slug to the short name used in user-facing
// copy. Unknown tiers fall back to the slug itself so we never silently
// drop a label.
func TierDisplayName(tier string) string {
	switch tier {
	case "free":
		return "Free"
	case "uplink":
		return "Uplink"
	case "uplink_pro":
		return "Uplink Pro"
	case "uplink_ultimate":
		return "Uplink Ultimate"
	case "super_user":
		return "Super User"
	default:
		return tier
	}
}

// ValidateChannelConfig rejects configs that exceed the caps for the
// given tier. Returns nil on success, a *TierLimitError on violation.
//
// Unknown tiers fall back to the "free" row — a defensive default if
// the JWT ever carries a role we don't recognize. Unknown channel types
// are not validated (new channels can register dynamically; their shape
// is not yet known to this file, and silently passing is safer than
// hard-rejecting).
func ValidateChannelConfig(tier, channelType string, config map[string]any) error {
	limits, ok := DefaultTierLimits[tier]
	if !ok {
		limits = DefaultTierLimits["free"]
		tier = "free"
	}

	switch channelType {
	case "finance":
		return validateArrayCap(tier, channelType, "symbols", config["symbols"], limits.Symbols)
	case "sports":
		return validateArrayCap(tier, channelType, "leagues", config["leagues"], limits.Leagues)
	case "rss":
		// RSS caps both total feeds and user-added ("custom") feeds.
		// The custom cap is tighter than the total cap, so the natural
		// error mode is custom-first when both are breached.
		//
		// `is_custom` is determined SERVER-SIDE in production: a URL is
		// considered custom iff it's NOT in the curated catalog
		// (tracked_feeds.is_default = true). Falling back to the
		// client-asserted `is_custom` flag when the curated set is
		// unavailable (e.g. running without DB in unit tests) keeps
		// tests deterministic without weakening prod safety.
		feedsRaw, _ := config["feeds"].([]any)
		totalFeeds := len(feedsRaw)
		curated := getCuratedFeedURLs() // nil when DB unavailable / test mode
		customCount := 0
		for _, item := range feedsRaw {
			m, ok := item.(map[string]any)
			if !ok {
				continue
			}
			isCustom := isCustomFeed(m, curated)
			if isCustom {
				customCount++
			}
		}
		if limits.CustomFeeds != nil && customCount > *limits.CustomFeeds {
			return &TierLimitError{
				Tier:        tier,
				ChannelType: channelType,
				Field:       "custom_feeds",
				Limit:       *limits.CustomFeeds,
				Got:         customCount,
			}
		}
		if limits.Feeds != nil && totalFeeds > *limits.Feeds {
			return &TierLimitError{
				Tier:        tier,
				ChannelType: channelType,
				Field:       "feeds",
				Limit:       *limits.Feeds,
				Got:         totalFeeds,
			}
		}
	}
	return nil
}

// isCustomFeed decides whether a feeds[] item is a user-added (custom)
// feed.
//
// Resolution order:
//
//  1. If a curated URL set is provided AND the item has a non-empty
//     URL, the answer is server-derived: custom iff URL not in curated.
//     This is the production path.
//
//  2. Otherwise, fall back to the client-asserted `is_custom` flag.
//     This is the test path (no DBPool, so no curated set) and the
//     graceful-degradation path (DB query failed, so we trust the
//     client; this is no worse than the pre-derivation behavior).
//
// Returning true means "counts against the custom_feeds tier cap".
func isCustomFeed(item map[string]any, curated map[string]bool) bool {
	urlStr, _ := item["url"].(string)
	if curated != nil && urlStr != "" {
		return !curated[urlStr]
	}
	flag, _ := item["is_custom"].(bool)
	return flag
}

// validateArrayCap counts entries in an array-shaped JSONB value and
// returns a *TierLimitError if it exceeds cap. A nil cap pointer means
// "unlimited" — common case for Ultimate/super_user tiers.
func validateArrayCap(tier, channelType, field string, raw any, cap *int) error {
	if cap == nil {
		return nil
	}
	arr, _ := raw.([]any)
	if len(arr) <= *cap {
		return nil
	}
	return &TierLimitError{
		Tier:        tier,
		ChannelType: channelType,
		Field:       field,
		Limit:       *cap,
		Got:         len(arr),
	}
}

// tierLimitErrorResponse builds the structured 403 body for a
// *TierLimitError. Handlers use this so the UI can render a precise
// message and, if desired, drill into the structured `detail` field.
func tierLimitErrorResponse(e *TierLimitError) fiber.Map {
	return fiber.Map{
		"status": "tier_limit_exceeded",
		"error":  e.UserFacingMessage(),
		"detail": fiber.Map{
			"tier":    e.Tier,
			"channel": e.ChannelType,
			"field":   e.Field,
			"limit":   e.Limit,
			"got":     e.Got,
		},
	}
}

// PruneReport describes what PruneChannelConfig trimmed. Fields are
// zero when nothing of that kind was over-cap. Used for logging +
// potential future "we removed these" notifications.
type PruneReport struct {
	SymbolsBefore, SymbolsAfter         int
	FeedsBefore, FeedsAfter             int
	CustomFeedsBefore, CustomFeedsAfter int
	LeaguesBefore, LeaguesAfter         int
}

// Changed returns true if the prune report describes any actual trim.
// Callers skip the UPDATE when false.
func (r PruneReport) Changed() bool {
	return r.SymbolsBefore != r.SymbolsAfter ||
		r.FeedsBefore != r.FeedsAfter ||
		r.CustomFeedsBefore != r.CustomFeedsAfter ||
		r.LeaguesBefore != r.LeaguesAfter
}

// PruneChannelConfig returns a new config map trimmed to fit the given
// tier's caps. Non-array fields pass through untouched. Reports what
// was trimmed so callers can log the diff.
//
// RSS trims custom feeds first (the scarce resource) and then drops
// non-custom feeds from the tail until the total fits too.
func PruneChannelConfig(tier, channelType string, config map[string]any) (map[string]any, PruneReport) {
	limits, ok := DefaultTierLimits[tier]
	if !ok {
		limits = DefaultTierLimits["free"]
	}
	report := PruneReport{}
	out := cloneMap(config)

	switch channelType {
	case "finance":
		if arr, capv := asArray(out["symbols"]), limits.Symbols; capv != nil {
			report.SymbolsBefore = len(arr)
			if len(arr) > *capv {
				arr = arr[:*capv]
			}
			report.SymbolsAfter = len(arr)
			out["symbols"] = arr
		}
	case "sports":
		if arr, capv := asArray(out["leagues"]), limits.Leagues; capv != nil {
			report.LeaguesBefore = len(arr)
			if len(arr) > *capv {
				arr = arr[:*capv]
			}
			report.LeaguesAfter = len(arr)
			out["leagues"] = arr
		}
	case "rss":
		feeds := asArray(out["feeds"])
		report.FeedsBefore = len(feeds)
		customCount := 0
		for _, f := range feeds {
			if m, ok := f.(map[string]any); ok {
				if isCustom, _ := m["is_custom"].(bool); isCustom {
					customCount++
				}
			}
		}
		report.CustomFeedsBefore = customCount

		// Pass 1: enforce custom feed cap. Walk front-to-back, keeping
		// non-custom feeds unconditionally and custom feeds only while
		// the running custom count is under cap.
		if limits.CustomFeeds != nil && customCount > *limits.CustomFeeds {
			kept := make([]any, 0, len(feeds))
			customKept := 0
			for _, f := range feeds {
				m, ok := f.(map[string]any)
				isCustom := false
				if ok {
					isCustom, _ = m["is_custom"].(bool)
				}
				if isCustom {
					if customKept >= *limits.CustomFeeds {
						continue
					}
					customKept++
				}
				kept = append(kept, f)
			}
			feeds = kept
		}

		// Pass 2: enforce total feed cap by dropping from the tail.
		if limits.Feeds != nil && len(feeds) > *limits.Feeds {
			feeds = feeds[:*limits.Feeds]
		}

		report.FeedsAfter = len(feeds)
		newCustom := 0
		for _, f := range feeds {
			if m, ok := f.(map[string]any); ok {
				if isCustom, _ := m["is_custom"].(bool); isCustom {
					newCustom++
				}
			}
		}
		report.CustomFeedsAfter = newCustom
		out["feeds"] = feeds
	}

	return out, report
}

func asArray(v any) []any {
	arr, _ := v.([]any)
	return arr
}

// cloneMap returns a shallow copy. The channel configs we prune always
// have array values (which we never mutate in place — we reslice), so
// a shallow copy is sufficient.
func cloneMap(m map[string]any) map[string]any {
	if m == nil {
		return map[string]any{}
	}
	out := make(map[string]any, len(m))
	for k, v := range m {
		out[k] = v
	}
	return out
}
