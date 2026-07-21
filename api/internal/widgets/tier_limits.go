package widgets

import (
	"fmt"

	"github.com/gofiber/fiber/v2"
)

// WidgetLimits is the per-tier cap for every widget feature the frontend
// lets users configure. A nil pointer means "unlimited" — this lets us
// round-trip cleanly through JSON (where Go's Infinity has no analogue)
// and lets clients treat null as "no cap."
type WidgetLimits struct {
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
	Tiers map[string]WidgetLimits `json:"tiers"`
}

// DefaultTierLimits is the authoritative source of truth for per-tier caps.
//
// SOURCE OF TRUTH — any change here MUST also propagate to:
//   - api/internal/widgets/tier_limits.json     (shared sync snapshot — a Go test and
//     both frontends' Vitest suites pin their copies to it, so CI fails
//     on whichever side was left stale)
//   - desktop/src/tierLimits.ts     (kept in sync manually; synchronous
//     reads required by config panels during render)
//   - myscrollr.com/src/lib/fallbackTierLimits.ts (`FALLBACK_LIMITS`,
//     used only for first-paint while the API response is in flight)
//   - api/internal/widgets/tier_limits_test.go  (assertion protecting this table
//     from silent edits — run `go test ./core/...` after any change)
//
// MaxWidgets gates what POST /users/me/widgets accepts, so drift here is
// unforgiving.
// Per-feature depth caps (Symbols/Feeds/CustomFeeds/Leagues/Fantasy) were
// RETIRED 2026-07-02 — a nil pointer means unlimited, and every tier now has
// unlimited depth inside a widget. MaxWidgets (the slot lever) is the only
// per-tier gate; the ticker-row fields are kept for compatibility.
var DefaultTierLimits = map[string]WidgetLimits{
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
// default used elsewhere, so an unrecognized JWT role can never grant
// more slots than the free plan.
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
	Tier       string // "free", "uplink", etc.
	WidgetType string // catalog id, e.g. "sports_nfl"
	Field      string // "widgets" — the slot cap is the only lever left
	Limit      int
	Got        int
}

func (e *TierLimitError) Error() string {
	return fmt.Sprintf(
		"tier %q allows at most %d %s for %s; got %d",
		e.Tier, e.Limit, e.Field, e.WidgetType, e.Got,
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

// tierOrder is the subscription ladder, cheapest first. Mirrors TIER_ORDER in
// desktop/src/routes/widget.$id.info.tsx; both must agree or the client would
// offer an upgrade the server rejects (or vice versa).
var tierOrder = []string{"free", "uplink", "uplink_pro", "uplink_ultimate", "super_user"}

func tierRank(tier string) int {
	for i, t := range tierOrder {
		if t == tier {
			return i
		}
	}
	return 0 // unknown tier is treated as free, never as privileged
}

// TierMeets reports whether `current` is at least `required`.
func TierMeets(current, required string) bool {
	return tierRank(current) >= tierRank(required)
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

// tierLimitErrorResponse builds the structured 403 body for a
// *TierLimitError. Handlers use this so the UI can render a precise
// message and, if desired, drill into the structured `detail` field.
func tierLimitErrorResponse(e *TierLimitError) fiber.Map {
	return fiber.Map{
		"status": "tier_limit_exceeded",
		"error":  e.UserFacingMessage(),
		"detail": fiber.Map{
			"tier":    e.Tier,
			"widget":  e.WidgetType,
			"field":   e.Field,
			"limit":   e.Limit,
			"got":     e.Got,
		},
	}
}
