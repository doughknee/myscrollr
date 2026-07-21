package main

import "github.com/gofiber/fiber/v2"

// =============================================================================
// Tier Limits — Fantasy League Imports (RETIRED)
// =============================================================================
//
// v1.1.2 (2026-07-02): the per-tier league cap is GONE. The widget/slot model
// made the widget slot — enforced by the core API's widgets.CreateWidget — the only
// monetization lever, and Yahoo Fantasy is a normal widget on every plan with
// unlimited depth inside it ("as many leagues as you play"). The old ladder
// (free 0 / uplink 1 / pro 3 / ultimate 10) predated that model and survived
// here by accident: this file is a package-local mirror (cross-module imports
// are banned by AGENTS.md), so the 2026-07-02 core-side cap retirement never
// reached it.
//
// FantasyLeagueCap and its call site in user_handlers.go are kept as a seam:
// if a per-tier depth cap ever returns, the enforcement plumbing (header →
// tier → cap → 403) is already wired and tested end-to-end.

// TierFree is the least-privileged tier — GetUserTier's fallback when the
// gateway header is missing.
const TierFree = "free"

// FantasyLeagueCap returns the league-import cap for a tier. -1 means
// unlimited — which is now every tier (see file header).
func FantasyLeagueCap(tier string) int {
	_ = tier
	return -1
}

// GetUserTier reads the X-User-Tier header set by the core gateway for
// authenticated requests. Returns "free" if the header is not present —
// callers should treat a missing tier as the least-privileged one.
func GetUserTier(c *fiber.Ctx) string {
	tier := c.Get("X-User-Tier")
	if tier == "" {
		return TierFree
	}
	return tier
}
