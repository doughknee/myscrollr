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
	// MaxWidgets caps how many widgets a user may run at once — the slot
	// model from the 2026-06-30 widget/slot redesign. A nil pointer means
	// "unlimited". During the transition this lever lives alongside the
	// per-feature caps below; those are retired as their UI consumers
	// migrate to the widget catalog.
	MaxWidgets             *int `json:"max_widgets"`
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
// Per-feature depth caps (Symbols/Feeds/CustomFeeds/Leagues/Fantasy) were
// RETIRED 2026-07-02 — a nil pointer means unlimited, and every tier now has
// unlimited depth inside a widget. MaxWidgets (the slot lever) is the only
// per-tier gate; the ticker-row fields are kept for compatibility.
var DefaultTierLimits = map[string]ChannelLimits{
	"free":            {MaxWidgets: intPtr(3), MaxTickerRows: 1},
	"uplink":          {MaxWidgets: intPtr(6), MaxTickerRows: 2},
	"uplink_pro":      {MaxWidgets: intPtr(12), MaxTickerRows: 3},
	"uplink_ultimate": {MaxTickerRows: 3, MaxTickerCustomization: true},
	"super_user":      {MaxTickerRows: 3, MaxTickerCustomization: true},
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

// MaxWidgetsForTier returns the widget-slot cap for a tier (nil =
// unlimited). Unknown tiers fall back to "free", matching the defensive
// default ValidateChannelConfig uses, so an unrecognized JWT role can
// never grant more slots than the free plan.
func MaxWidgetsForTier(tier string) *int {
	limits, ok := DefaultTierLimits[tier]
	if !ok {
		limits = DefaultTierLimits["free"]
	}
	return limits.MaxWidgets
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
	// The widget-slot cap reads more naturally as a "running at once"
	// message than the per-feature "you tried to save N" phrasing.
	if e.Field == "widgets" {
		return fmt.Sprintf(
			"Your %s plan runs %d widgets at once. Disable one to add another, or upgrade for more.",
			TierDisplayName(e.Tier), e.Limit,
		)
	}
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

