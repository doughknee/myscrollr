package core

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
	"github.com/redis/go-redis/v9"
	"golang.org/x/sync/singleflight"
)

// ─── Response types ─────────────────────────────────────────────────

// OverviewResponse is the unified read shape for GET /users/me/overview.
// Single round-trip for the desktop account pane: identity, tier, billing,
// channel summary, GDPR state, fantasy summary, and useful outbound links.
//
// The endpoint is cached per-user in Redis for 30s with singleflight in
// front of the assemble path; cache invalidation hooks fire from the
// Stripe webhook, channel CRUD handlers, and the GDPR request lifecycle
// so user-visible state never lags more than one request.
type OverviewResponse struct {
	Identity     OverviewIdentity      `json:"identity"`
	Tier         OverviewTier          `json:"tier"`
	Subscription *SubscriptionResponse `json:"subscription"`
	Channels     OverviewChannels      `json:"channels"`
	Fantasy      *OverviewFantasy      `json:"fantasy"`
	GDPR         OverviewGDPR          `json:"gdpr"`
	Links        OverviewLinks         `json:"links"`
}

// OverviewIdentity carries the JWT-sourced identity claims. Username is
// empty until the user picks one in the invite flow — clients render an
// "claim your username" affordance when this is "".
type OverviewIdentity struct {
	Sub      string `json:"sub"`
	Email    string `json:"email"`
	Name     string `json:"name"`
	Username string `json:"username"`
}

// OverviewTier resolves the tier from JWT roles and embeds the matching
// limits row so clients don't need a second `/tier-limits` round-trip.
type OverviewTier struct {
	Current     string        `json:"current"`
	IsSuperUser bool          `json:"is_super_user"`
	Label       string        `json:"label"`
	Limits      ChannelLimits `json:"limits"`
}

// OverviewChannels summarises the user_channels table for the account
// pane. `total` and `enabled` drive the headline counts; `by_type` is
// the per-channel toggle state used to render the channel list.
type OverviewChannels struct {
	Total   int                  `json:"total"`
	Enabled int                  `json:"enabled"`
	ByType  []OverviewChannelRow `json:"by_type"`
}

type OverviewChannelRow struct {
	Type    string `json:"type"`
	Enabled bool   `json:"enabled"`
	Visible bool   `json:"visible"`
}

// OverviewFantasy is the optional fan-out result from the fantasy
// channel's /users/me/yahoo-summary endpoint. nil when the user has no
// enabled fantasy channel, when the channel hasn't registered, or when
// the fan-out call fails (timeout, non-200, or transport error). The
// account pane treats nil as "fantasy section hidden".
type OverviewFantasy struct {
	YahooConnected bool `json:"yahoo_connected"`
	YahooSynced    bool `json:"yahoo_synced"`
	LeagueCount    int  `json:"league_count"`
}

// OverviewGDPR mirrors the deletion-request row in a typed shape. Status
// is one of "none" | "pending" | "canceled" | "purged". Timestamps are
// RFC3339 strings (rather than time.Time) so JSON null is the natural
// representation when the field is missing.
type OverviewGDPR struct {
	DeletionStatus string  `json:"deletion_status"`
	RequestedAt    *string `json:"requested_at"`
	PurgeAt        *string `json:"purge_at"`
}

// OverviewLinks holds outbound URLs the account pane needs to render.
// LogtoAccount is empty when LOGTO_ENDPOINT/LOGTO_APP_ID are unset (e.g.
// in tests) — clients hide the link in that case.
type OverviewLinks struct {
	LogtoAccount string `json:"logto_account"`
}

// ─── Cache constants ────────────────────────────────────────────────

const (
	// RedisOverviewCachePrefix is the per-user key prefix for the
	// overview cache. Format: overview:{logto_sub}.
	RedisOverviewCachePrefix = "overview:"

	// OverviewCacheTTL caps stale reads at 30s. Invalidation hooks fire
	// on every state-changing endpoint that affects the response, so
	// the TTL is a safety net rather than the primary correctness lever.
	OverviewCacheTTL = 30 * time.Second

	// FantasyFanoutTimeout bounds the optional fantasy-channel call.
	// The overview is a foreground request; we'd rather return without
	// a fantasy block than hold the page on a slow channel.
	FantasyFanoutTimeout = 1 * time.Second
)

// overviewGroup coalesces concurrent cache misses for the same user
// into a single assemble pass. Mirrors the dashboardGroup pattern in
// server.go.
var overviewGroup singleflight.Group

// ─── Identity ───────────────────────────────────────────────────────

// buildIdentityFromContext reads the four identity claims that
// LogtoAuth (auth.go) parks in c.Locals. Missing claims coerce to
// empty strings — the JWT middleware writes "" for missing name /
// username so callers can rely on .(string) reads here.
func buildIdentityFromContext(c *fiber.Ctx) OverviewIdentity {
	getStr := func(key string) string {
		v, _ := c.Locals(key).(string)
		return v
	}
	return OverviewIdentity{
		Sub:      getStr("user_id"),
		Email:    getStr("user_email"),
		Name:     getStr("user_name"),
		Username: getStr("user_username"),
	}
}

// ─── Tier ───────────────────────────────────────────────────────────

// buildTierFromContext resolves the user's tier from JWT roles and
// embeds the matching limits row. This matches the resolution used
// elsewhere (preferences.go, channels.go) so the overview never
// disagrees with what the channel handlers actually enforce.
func buildTierFromContext(c *fiber.Ctx) OverviewTier {
	tier := tierFromRoles(GetUserRoles(c))
	limits, ok := DefaultTierLimits[tier]
	if !ok {
		limits = DefaultTierLimits["free"]
	}
	return OverviewTier{
		Current:     tier,
		IsSuperUser: tier == "super_user",
		Label:       TierDisplayName(tier),
		Limits:      limits,
	}
}

// ─── Channel summary ────────────────────────────────────────────────

// getChannelSummary aggregates user_channels into the headline counts
// + per-row toggle state in a single query. Empty users return zero
// counts and an empty by_type slice.
func getChannelSummary(ctx context.Context, userID string) (OverviewChannels, error) {
	const q = `
		SELECT
			COUNT(*) AS total,
			COUNT(*) FILTER (WHERE enabled = true) AS enabled_count,
			COALESCE(json_agg(json_build_object(
				'type', channel_type,
				'enabled', enabled,
				'visible', visible
			) ORDER BY channel_type) FILTER (WHERE channel_type IS NOT NULL), '[]'::json) AS by_type
		FROM user_channels
		WHERE logto_sub = $1
	`

	var (
		total      int
		enabled    int
		byTypeJSON []byte
	)
	err := DBPool.QueryRow(ctx, q, userID).Scan(&total, &enabled, &byTypeJSON)
	if err != nil {
		return OverviewChannels{}, fmt.Errorf("getChannelSummary query: %w", err)
	}

	byType := []OverviewChannelRow{}
	if len(byTypeJSON) > 0 {
		if err := json.Unmarshal(byTypeJSON, &byType); err != nil {
			return OverviewChannels{}, fmt.Errorf("getChannelSummary unmarshal: %w", err)
		}
	}

	return OverviewChannels{
		Total:   total,
		Enabled: enabled,
		ByType:  byType,
	}, nil
}

// ─── Fantasy fan-out ────────────────────────────────────────────────

// fetchFantasySummary calls the fantasy channel's
// GET /users/me/yahoo-summary endpoint with a tight timeout. Returns
// nil on any failure path (channel not registered, timeout, non-200,
// unmarshal error) so the overview gracefully degrades: the account
// pane just hides the fantasy section.
func fetchFantasySummary(ctx context.Context, userID string) *OverviewFantasy {
	baseURL := getFantasyBaseURL()
	if baseURL == "" {
		return nil
	}

	url := strings.TrimRight(baseURL, "/") + "/users/me/yahoo-summary"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		log.Printf("[Overview] build fantasy request: %v", err)
		return nil
	}
	// X-User-Sub is the same convention the proxy uses to forward
	// identity into channel APIs (see proxy.go).
	req.Header.Set("X-User-Sub", userID)

	client := &http.Client{Timeout: FantasyFanoutTimeout}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("[Overview] fantasy fan-out failed (timeout/network): %v", err)
		return nil
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		log.Printf("[Overview] fantasy fan-out non-200: %d", resp.StatusCode)
		return nil
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Printf("[Overview] fantasy fan-out read body: %v", err)
		return nil
	}

	var out OverviewFantasy
	if err := json.Unmarshal(body, &out); err != nil {
		log.Printf("[Overview] fantasy fan-out unmarshal: %v", err)
		return nil
	}
	return &out
}

// getFantasyBaseURL resolves the fantasy channel's internal base URL
// via the discovery registry (Redis-backed). Returns "" if the channel
// hasn't registered yet; callers treat that as "skip fan-out".
func getFantasyBaseURL() string {
	info := GetChannel("fantasy")
	if info == nil {
		return ""
	}
	return info.InternalURL
}

// ─── GDPR ───────────────────────────────────────────────────────────

// getDeletionStatusForOverview wraps the existing getUserDeletionStatus
// helper (which returns a map[string]any used by other endpoints) and
// re-shapes it into the typed OverviewGDPR. Errors and missing rows
// both collapse to "none" — the overview must never fail because the
// GDPR table is unreachable.
func getDeletionStatusForOverview(ctx context.Context, userID string) OverviewGDPR {
	status, err := getUserDeletionStatus(ctx, userID)
	if err != nil {
		log.Printf("[Overview] deletion status for %s: %v", userID, err)
		return OverviewGDPR{DeletionStatus: "none"}
	}
	if status == nil {
		return OverviewGDPR{DeletionStatus: "none"}
	}

	out := OverviewGDPR{DeletionStatus: "none"}
	if s, ok := status["status"].(string); ok {
		out.DeletionStatus = s
	}
	if t, ok := status["requested_at"].(time.Time); ok {
		s := t.UTC().Format(time.RFC3339)
		out.RequestedAt = &s
	}
	if t, ok := status["purge_at"].(time.Time); ok {
		s := t.UTC().Format(time.RFC3339)
		out.PurgeAt = &s
	}
	return out
}

// ─── Subscription ───────────────────────────────────────────────────

// getSubscriptionForOverview returns a DB-only snapshot of the user's
// subscription. Unlike HandleGetSubscription, this does NOT call out to
// Stripe — the overview is a foreground, cacheable read, and a 200ms
// Stripe round-trip per pageload (or per cache miss) is too expensive.
//
// Trade-off: the live billing details (Amount/Currency/Interval/TrialEnd
// + pending downgrade schedule) come from Stripe in HandleGetSubscription
// but are unavailable here. The account pane that wants those details
// fetches /users/me/subscription separately. The overview's purpose is
// the headline plan/status, which the local DB has.
//
// Returns nil for users on the free plan (no stripe_customers row).
func getSubscriptionForOverview(ctx context.Context, userID string) *SubscriptionResponse {
	var sc StripeCustomer
	err := DBPool.QueryRow(ctx,
		`SELECT logto_sub, stripe_customer_id, stripe_subscription_id, plan, status,
		        current_period_end, lifetime, created_at, updated_at
		 FROM stripe_customers WHERE logto_sub = $1`, userID,
	).Scan(&sc.LogtoSub, &sc.StripeCustomerID, &sc.StripeSubscriptionID,
		&sc.Plan, &sc.Status, &sc.CurrentPeriodEnd, &sc.Lifetime,
		&sc.CreatedAt, &sc.UpdatedAt)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil
		}
		log.Printf("[Overview] subscription query for %s: %v", userID, err)
		return nil
	}

	return &SubscriptionResponse{
		Plan:             sc.Plan,
		Status:           sc.Status,
		CurrentPeriodEnd: sc.CurrentPeriodEnd,
		Lifetime:         sc.Lifetime,
	}
}

// ─── Links ──────────────────────────────────────────────────────────

// buildAccountLinks composes outbound URLs the account pane renders.
// Empty when LOGTO_ENDPOINT or LOGTO_APP_ID is unset (tests, local dev
// without Logto configured) — the client hides the affected link.
func buildAccountLinks() OverviewLinks {
	endpoint := strings.TrimRight(os.Getenv("LOGTO_ENDPOINT"), "/")
	appID := os.Getenv("LOGTO_APP_ID")
	if endpoint == "" || appID == "" {
		return OverviewLinks{LogtoAccount: ""}
	}
	return OverviewLinks{
		LogtoAccount: fmt.Sprintf("%s/account?client_id=%s", endpoint, appID),
	}
}

// ─── Assemble ───────────────────────────────────────────────────────

// assembleOverview is the slow path called from the cache-miss branch
// of HandleGetOverview. Order:
//
//  1. Identity + tier — pure context reads, no I/O.
//  2. Subscription — single DB query.
//  3. Channels — single DB query (also gates the fantasy fan-out).
//  4. GDPR — single DB query.
//  5. Fantasy — only when the user has an enabled fantasy channel; HTTP
//     call with a 1s timeout so a slow fantasy API can't pin the
//     overview.
//
// Failures in optional sections (subscription, GDPR, fantasy) degrade
// gracefully to nil/none rather than failing the whole call. The
// channels query is the only one that can hard-fail — without it the
// summary is meaningless.
func assembleOverview(ctx context.Context, c *fiber.Ctx, userID string) (*OverviewResponse, error) {
	identity := buildIdentityFromContext(c)
	tier := buildTierFromContext(c)
	subscription := getSubscriptionForOverview(ctx, userID)

	channels, err := getChannelSummary(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("assembleOverview: channels: %w", err)
	}

	gdpr := getDeletionStatusForOverview(ctx, userID)

	var fantasy *OverviewFantasy
	if hasFantasyChannel(channels) {
		fanCtx, cancel := context.WithTimeout(ctx, FantasyFanoutTimeout)
		defer cancel()
		fantasy = fetchFantasySummary(fanCtx, userID)
	}

	return &OverviewResponse{
		Identity:     identity,
		Tier:         tier,
		Subscription: subscription,
		Channels:     channels,
		Fantasy:      fantasy,
		GDPR:         gdpr,
		Links:        buildAccountLinks(),
	}, nil
}

// hasFantasyChannel returns true when the user has an enabled fantasy
// channel — the only condition under which the fantasy fan-out is
// worth the latency cost.
func hasFantasyChannel(channels OverviewChannels) bool {
	for _, c := range channels.ByType {
		if c.Type == "fantasy" && c.Enabled {
			return true
		}
	}
	return false
}

// ─── Cache invalidation ─────────────────────────────────────────────

// InvalidateOverviewCache deletes the per-user overview cache key.
// Called from the Stripe webhook (subscription state changes), the
// channel CRUD handlers (toggle state changes), and the GDPR request
// lifecycle (deletion status changes) so the next request always sees
// fresh data instead of waiting up to OverviewCacheTTL for the cache
// to expire.
//
// Failures are logged and swallowed — the caller's primary write has
// already succeeded; an invalidation miss only delays the visible
// effect by OverviewCacheTTL, which is acceptable.
func InvalidateOverviewCache(ctx context.Context, userID string) {
	if userID == "" || Rdb == nil {
		return
	}
	key := RedisOverviewCachePrefix + userID
	if err := Rdb.Del(ctx, key).Err(); err != nil {
		log.Printf("[Overview] cache invalidate failed for %s: %v", userID, err)
	}
}

// ─── Handler ────────────────────────────────────────────────────────

// HandleGetOverview serves GET /users/me/overview. Fast path: serve
// from Redis. Slow path: assemble + cache, with singleflight to
// coalesce concurrent misses for the same user.
//
// The X-Cache header ("hit" | "miss") helps operators verify the cache
// is doing its job in production traces. The body shape is identical
// on both paths.
func HandleGetOverview(c *fiber.Ctx) error {
	userID := GetUserID(c)
	if userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(ErrorResponse{
			Status: "unauthorized",
			Error:  "Authentication required",
		})
	}

	cacheKey := RedisOverviewCachePrefix + userID

	// Fast path: serve from Redis. We use raw bytes (Send) instead of
	// JSON-decode-then-re-encode so cache hits are zero-copy.
	if Rdb != nil {
		if cached, err := Rdb.Get(c.Context(), cacheKey).Bytes(); err == nil {
			c.Set("X-Cache", "hit")
			c.Set("Content-Type", "application/json")
			return c.Send(cached)
		} else if err != redis.Nil {
			log.Printf("[Overview] cache read for %s: %v", userID, err)
		}
	}

	// Slow path: singleflight ensures concurrent misses for the same
	// user assemble exactly once.
	result, err, _ := overviewGroup.Do(userID, func() (interface{}, error) {
		return assembleOverview(c.Context(), c, userID)
	})
	if err != nil {
		log.Printf("[Overview] assemble for %s: %v", userID, err)
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Status: "error",
			Error:  "Failed to assemble overview",
		})
	}

	overview, ok := result.(*OverviewResponse)
	if !ok || overview == nil {
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Status: "error",
			Error:  "Invalid overview shape",
		})
	}

	payload, err := json.Marshal(overview)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Status: "error",
			Error:  fmt.Sprintf("marshal overview: %v", err),
		})
	}

	if Rdb != nil {
		if setErr := Rdb.Set(c.Context(), cacheKey, payload, OverviewCacheTTL).Err(); setErr != nil {
			log.Printf("[Overview] cache write for %s: %v", userID, setErr)
		}
	}

	c.Set("X-Cache", "miss")
	c.Set("Content-Type", "application/json")
	return c.Send(payload)
}
