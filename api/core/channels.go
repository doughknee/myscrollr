package core

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
)

var lifecycleClient = &http.Client{
	Timeout: 10 * time.Second,
}

// GetUserChannels fetches all channels for a user.
func GetUserChannels(logtoSub string) ([]Channel, error) {
	rows, err := DBPool.Query(context.Background(), `
		SELECT id, logto_sub, channel_type, enabled, visible, config, created_at, updated_at
		FROM user_channels
		WHERE logto_sub = $1
		ORDER BY created_at ASC, id ASC
	`, logtoSub)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	channels := make([]Channel, 0)
	for rows.Next() {
		var ch Channel
		var configJSON []byte
		if err := rows.Scan(&ch.ID, &ch.LogtoSub, &ch.ChannelType, &ch.Enabled, &ch.Visible, &configJSON, &ch.CreatedAt, &ch.UpdatedAt); err != nil {
			log.Printf("[Channels] Scan error: %v", err)
			continue
		}
		if err := json.Unmarshal(configJSON, &ch.Config); err != nil {
			ch.Config = map[string]interface{}{}
		}
		channels = append(channels, ch)
	}

	return channels, nil
}

// CountEnabledChannels returns how many enabled channels (widgets) a user
// currently has — the "slots in use" for the widget/slot model. Used by
// CreateChannel to gate new additions against the tier's MaxWidgets cap.
func CountEnabledChannels(ctx context.Context, logtoSub string) (int, error) {
	var n int
	err := DBPool.QueryRow(ctx,
		`SELECT count(*) FROM user_channels WHERE logto_sub = $1 AND enabled = true`,
		logtoSub).Scan(&n)
	return n, err
}

// SyncChannelSubscriptions rebuilds Redis subscription sets for a user from their
// current channels in the database. Called on dashboard load and after channel CRUD.
func SyncChannelSubscriptions(logtoSub string) {
	channels, err := GetUserChannels(logtoSub)
	if err != nil {
		log.Printf("[Channels] Failed to sync subscriptions for %s: %v", logtoSub, err)
		return
	}

	ctx := context.Background()

	// Compute DESIRED membership first, across all widgets, then apply.
	// Split widgets share source-level subscriber sets (sports_nfl and
	// sports_nba both live in channel:subscribers:sports), so per-row
	// add/remove is order-dependent: a disabled sibling iterated after an
	// enabled one would remove the subscription the enabled widget needs.
	// The set semantics are "member iff ANY enabled widget uses it".
	wantSource := map[string]bool{} // source -> any enabled widget?
	wantLeague := map[string]bool{} // league -> any enabled sports widget?
	for _, ch := range channels {
		source := DataSourceForWidget(ch.ChannelType)
		if source == "" {
			continue
		}
		if _, seen := wantSource[source]; !seen {
			wantSource[source] = false
		}
		if ch.Enabled {
			wantSource[source] = true
		}
		if source == "sports" {
			for _, league := range extractSportsLeaguesFromConfig(ch.Config) {
				if _, seen := wantLeague[league]; !seen {
					wantLeague[league] = false
				}
				if ch.Enabled {
					wantLeague[league] = true
				}
			}
		}
	}

	for source, want := range wantSource {
		setKey := RedisChannelSubscribersPrefix + source
		if want {
			AddSubscriber(ctx, setKey, logtoSub)
		} else {
			RemoveSubscriber(ctx, setKey, logtoSub)
		}
	}
	var addLeagues, removeLeagues []string
	for league, want := range wantLeague {
		if want {
			addLeagues = append(addLeagues, SportsLeagueSubscribersPrefix+league)
		} else {
			removeLeagues = append(removeLeagues, SportsLeagueSubscribersPrefix+league)
		}
	}
	if len(addLeagues) > 0 {
		if err := AddSubscriberMulti(ctx, addLeagues, logtoSub); err != nil {
			log.Printf("[Channels] Failed to sync sports league subscriptions for %s: %v", logtoSub, err)
		}
	}
	if len(removeLeagues) > 0 {
		if err := RemoveSubscriberMulti(ctx, removeLeagues, logtoSub); err != nil {
			log.Printf("[Channels] Failed to remove sports league subscriptions for %s: %v", logtoSub, err)
		}
	}

	// Call channel lifecycle hooks via HTTP (per widget, as before).
	for _, ch := range channels {
		callChannelLifecycle(ctx, ch.ChannelType, "sync", logtoSub, ch.Config, nil, &ch.Enabled)
	}
}

// addChannelSubscriptions adds Redis subscription entries for a newly created/enabled channel.
// For sports, this also adds the user to all per-league subscriber sets.
// Also updates the in-memory topic registry for active SSE connections.
func addChannelSubscriptions(ctx context.Context, logtoSub, channelType string, config map[string]interface{}) {
	source := DataSourceForWidget(channelType)
	AddSubscriber(ctx, RedisChannelSubscribersPrefix+source, logtoSub)

	// Sports: populate per-league subscriber sets for user's configured leagues.
	if source == "sports" {
		leagues := extractSportsLeaguesFromConfig(config)
		if len(leagues) > 0 {
			leagueKeys := make([]string, len(leagues))
			for i, league := range leagues {
				leagueKeys[i] = SportsLeagueSubscribersPrefix + league
			}
			if err := AddSubscriberMulti(ctx, leagueKeys, logtoSub); err != nil {
				log.Printf("[Channels] Failed to add sports league subscriptions for %s: %v", logtoSub, err)
			}
		}
	}

	// Rebuild topic subscriptions on every replica holding an SSE
	// connection for this user (Redis control message, ADR-0001)
	NotifyTopicSubscriptionChange(logtoSub)

	enabled := true
	callChannelLifecycle(ctx, channelType, "sync", logtoSub, config, nil, &enabled)
}

// removeChannelSubscriptions removes Redis subscription entries for a deleted/disabled channel.
// For sports, this also removes the user from per-league subscriber sets.
// Also updates the in-memory topic registry for active SSE connections.
//
// Split widgets share source-level (and can share league-level) subscriber
// sets, so removals are guarded on the user's REMAINING enabled widgets:
// disabling sports_nba must not yank channel:subscribers:sports while
// sports_nfl is still enabled. Both callers (UpdateChannel disable,
// DeleteChannel) update the DB before calling this, so GetUserChannels
// reflects the post-removal state. On a listing error we skip the removals
// entirely — a stale subscription self-heals on the next sync; a wrongly
// dropped one silently kills live data for the surviving widgets.
func removeChannelSubscriptions(ctx context.Context, logtoSub, channelType string, config map[string]interface{}) {
	source := DataSourceForWidget(channelType)

	remaining, err := GetUserChannels(logtoSub)
	if err != nil {
		log.Printf("[Channels] Skipping subscription removal for %s/%s (listing failed: %v)", logtoSub, channelType, err)
	} else {
		sourceStillNeeded := false
		keptLeagues := map[string]bool{}
		for _, ch := range remaining {
			if !ch.Enabled || ch.ChannelType == channelType {
				continue
			}
			chSource := DataSourceForWidget(ch.ChannelType)
			if chSource == source {
				sourceStillNeeded = true
			}
			if chSource == "sports" {
				for _, league := range extractSportsLeaguesFromConfig(ch.Config) {
					keptLeagues[league] = true
				}
			}
		}

		if !sourceStillNeeded {
			RemoveSubscriber(ctx, RedisChannelSubscribersPrefix+source, logtoSub)
		}
		if source == "sports" {
			var stale []string
			for _, league := range extractSportsLeaguesFromConfig(config) {
				if !keptLeagues[league] {
					stale = append(stale, SportsLeagueSubscribersPrefix+league)
				}
			}
			if len(stale) > 0 {
				if err := RemoveSubscriberMulti(ctx, stale, logtoSub); err != nil {
					log.Printf("[Channels] Failed to remove sports league subscriptions for %s: %v", logtoSub, err)
				}
			}
		}
	}

	// Rebuild topic subscriptions on every replica so active SSE
	// connections stop receiving this channel (Redis control message,
	// ADR-0001)
	NotifyTopicSubscriptionChange(logtoSub)

	enabled := false
	callChannelLifecycle(ctx, channelType, "sync", logtoSub, config, nil, &enabled)
}

// callChannelLifecycle sends a lifecycle event to a channel if it has the channel_lifecycle capability.
func callChannelLifecycle(ctx context.Context, channelType, event, userSub string, config, oldConfig map[string]interface{}, enabled *bool) {
	// Resolve to the backing data source so widget types (e.g. "news") reach
	// the right service's lifecycle hook (rss). Legacy coarse types map to
	// themselves.
	source := DataSourceForWidget(channelType)

	// Local widget sources (ADR-0002): the only live behavior of the HTTP
	// lifecycle contract was per-user cache invalidation (Appendix A) —
	// subscriber-set maintenance had no readers. "created" and "sync"
	// events only touched those dead sets, so they are no-ops here.
	if src, ok := localSources[source]; ok {
		if src.invalidateUser != nil && (event == "updated" || event == "deleted") {
			src.invalidateUser(userSub)
		}
		return
	}

	ch := GetChannel(source)
	if ch == nil || !ch.HasCapability("channel_lifecycle") {
		return
	}

	body := map[string]interface{}{
		"event":  event,
		"user":   userSub,
		"config": config,
	}
	if oldConfig != nil {
		body["old_config"] = oldConfig
	}
	if enabled != nil {
		body["enabled"] = *enabled
	}

	reqBody, err := json.Marshal(body)
	if err != nil {
		log.Printf("[Channels] Failed to marshal lifecycle request: %v", err)
		return
	}

	url := ch.InternalURL + "/internal/channel-lifecycle"
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(reqBody))
	if err != nil {
		log.Printf("[Channels] Failed to create lifecycle request: %v", err)
		return
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := lifecycleClient.Do(req)
	if err != nil {
		log.Printf("[Channels] Lifecycle call to %s/%s failed: %v", ch.Name, event, err)
		return
	}
	defer resp.Body.Close()
	io.Copy(io.Discard, resp.Body)

	if resp.StatusCode != 200 {
		log.Printf("[Channels] Lifecycle call to %s/%s returned status %d", ch.Name, event, resp.StatusCode)
	}
}

// GetChannels returns all channels for the authenticated user.
//
func GetChannels(c *fiber.Ctx) error {
	userID := GetUserID(c)
	if userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(ErrorResponse{
			Status: "unauthorized",
			Error:  "Authentication required",
		})
	}

	channels, err := GetUserChannels(userID)
	if err != nil {
		log.Printf("[Channels] Error fetching channels: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Status: "error",
			Error:  "Failed to fetch channels",
		})
	}

	return c.JSON(fiber.Map{"channels": channels})
}

// CreateChannel adds a new channel for the authenticated user.
//
func CreateChannel(c *fiber.Ctx) error {
	userID := GetUserID(c)
	if userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(ErrorResponse{
			Status: "unauthorized",
			Error:  "Authentication required",
		})
	}

	var req struct {
		ChannelType string                 `json:"channel_type"`
		Config      map[string]interface{} `json:"config"`
		// LocalWidgets is the client's count of enabled utility widgets
		// (clock/weather/…). They live in preferences, not user_channels, but
		// every widget counts toward the slot cap — so the client reports them
		// and the slot gate adds them to the DB channel count. Absent (older
		// client) = 0, degrading to a data-channel-only gate.
		LocalWidgets int `json:"local_widgets"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Status: "error",
			Error:  "Invalid request body",
		})
	}

	// Validate channel type: accept either a registered backend channel
	// (Redis service discovery) or a known widget type (the code registry in
	// widgets.go). Additive during the widget/slot transition so legacy
	// coarse types ("sports") and new split widgets ("sports_nfl") both pass.
	if !GetValidChannelTypes()[req.ChannelType] && !IsKnownWidgetType(req.ChannelType) {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Status: "error",
			Error:  "Invalid channel type",
		})
	}
	// Utility widgets (clock/weather/…) live in desktop preferences, not
	// user_channels. A row for one would land in a bogus "" subscriber set
	// and double-count against the slot cap (once here, once via
	// local_widgets), so reject it outright.
	if IsUtilityWidgetType(req.ChannelType) {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Status: "error",
			Error:  "Utility widgets are stored locally, not as channels",
		})
	}
	// The client attests its local utility-widget count; never let a
	// negative value subtract from the server-side slot count.
	if req.LocalWidgets < 0 {
		req.LocalWidgets = 0
	}

	if req.Config == nil {
		req.Config = map[string]interface{}{}
	}

	// Tier-gate the config shape. Frontend already enforces these caps
	// but the API is the only place that actually matters — the Rust
	// ingestion services trust user_channels.config verbatim.
	tier := tierFromRoles(GetUserRoles(c))

	// Slot gate (widget/slot model, 2026-06-30): block adding a *new*
	// widget once the user is at their tier's MaxWidgets cap. Existing
	// over-cap users are grandfathered — we never disable what they
	// already have, we only block new adds. nil cap = unlimited. A count
	// error is logged but not fatal: failing open here is safer than
	// blocking a legitimate add on a transient DB blip (the per-feature
	// validation below still runs).
	if max := MaxWidgetsForTier(tier); max != nil {
		if count, err := CountEnabledChannels(context.Background(), userID); err != nil {
			log.Printf("[Channels] slot count failed for %s: %v", userID, err)
		} else {
			// Every widget counts toward the slot cap. Utility widgets live
			// client-side (preferences), so add the client-reported count to
			// the DB channel count.
			used := count + req.LocalWidgets
			if used >= *max {
				tle := &TierLimitError{Tier: tier, ChannelType: req.ChannelType, Field: "widgets", Limit: *max, Got: used + 1}
				log.Printf("[Channels] slot limit reached for %s: %d/%d (incl %d local)", userID, used, *max, req.LocalWidgets)
				return c.Status(fiber.StatusForbidden).JSON(tierLimitErrorResponse(tle))
			}
		}
	}

	if err := ValidateChannelConfig(tier, req.ChannelType, req.Config); err != nil {
		var tle *TierLimitError
		if errors.As(err, &tle) {
			log.Printf("[Channels] Tier limit exceeded for %s: %s", userID, tle.Error())
			return c.Status(fiber.StatusForbidden).JSON(tierLimitErrorResponse(tle))
		}
		// Defensive — the validator should only return *TierLimitError.
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Status: "error",
			Error:  err.Error(),
		})
	}

	configJSON, _ := json.Marshal(req.Config)

	var ch Channel
	var configBytes []byte
	err := DBPool.QueryRow(context.Background(), `
		INSERT INTO user_channels (logto_sub, channel_type, config)
		VALUES ($1, $2, $3)
		RETURNING id, logto_sub, channel_type, enabled, visible, config, created_at, updated_at
	`, userID, req.ChannelType, configJSON).Scan(
		&ch.ID, &ch.LogtoSub, &ch.ChannelType, &ch.Enabled, &ch.Visible,
		&configBytes, &ch.CreatedAt, &ch.UpdatedAt,
	)
	if err != nil {
		if strings.Contains(err.Error(), "unique") || strings.Contains(err.Error(), "duplicate") {
			return c.Status(fiber.StatusConflict).JSON(ErrorResponse{
				Status: "error",
				Error:  "Channel of this type already exists",
			})
		}
		log.Printf("[Channels] Create error: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Status: "error",
			Error:  "Failed to create channel",
		})
	}

	if err := json.Unmarshal(configBytes, &ch.Config); err != nil {
		ch.Config = map[string]interface{}{}
	}

	// Maintain Redis subscription sets
	ctx := context.Background()
	if ch.Enabled {
		addChannelSubscriptions(ctx, userID, ch.ChannelType, ch.Config)
	}

	// Call OnChannelCreated hook via HTTP
	callChannelLifecycle(ctx, ch.ChannelType, "created", userID, ch.Config, nil, nil)

	// Invalidate dashboard cache so next poll gets fresh data
	InvalidateDashboardCache(userID)
	// Channel summary in the overview response changed — drop the
	// per-user overview cache so the next /users/me/overview rebuilds.
	InvalidateOverviewCache(ctx, userID)

	return c.Status(fiber.StatusCreated).JSON(ch)
}

// UpdateChannel updates a channel by type for the authenticated user.
//
func UpdateChannel(c *fiber.Ctx) error {
	userID := GetUserID(c)
	if userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(ErrorResponse{
			Status: "unauthorized",
			Error:  "Authentication required",
		})
	}

	channelType := c.Params("type")
	if !GetValidChannelTypes()[channelType] && !IsKnownWidgetType(channelType) {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Status: "error",
			Error:  "Invalid channel type",
		})
	}

	// Both `visible` (legacy, v1.0.3 and earlier) and `ticker_enabled`
	// (modern, v1.0.4+) are accepted. Whichever is set non-nil wins;
	// `ticker_enabled` takes precedence if both are sent. The DB column
	// is still `visible` — the rename is wire-format only.
	var req struct {
		Enabled       *bool                  `json:"enabled"`
		Visible       *bool                  `json:"visible"`
		TickerEnabled *bool                  `json:"ticker_enabled"`
		Config        map[string]interface{} `json:"config"`
		// LocalWidgets mirrors CreateChannel: the client's count of enabled
		// utility widgets, added to the DB count when gating a re-enable.
		// Absent (older client) = 0.
		LocalWidgets int `json:"local_widgets"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Status: "error",
			Error:  "Invalid request body",
		})
	}
	if req.TickerEnabled != nil {
		req.Visible = req.TickerEnabled
	}
	if req.LocalWidgets < 0 {
		req.LocalWidgets = 0
	}

	// Gate RE-ENABLING against the widget-slot cap, exactly like
	// CreateChannel gates new adds. Without this the cap is a one-way door:
	// disable a widget, add a new one in the freed slot, re-enable the old
	// one ungated — repeat past any tier limit (and past a Stripe-downgrade
	// prune). Enabling an already-enabled widget stays a no-op passthrough.
	if req.Enabled != nil && *req.Enabled {
		tier := tierFromRoles(GetUserRoles(c))
		if max := MaxWidgetsForTier(tier); max != nil {
			var currentlyEnabled bool
			err := DBPool.QueryRow(context.Background(), `
				SELECT enabled FROM user_channels WHERE logto_sub = $1 AND channel_type = $2
			`, userID, channelType).Scan(&currentlyEnabled)
			// Row-lookup errors fall through: a missing row 404s on the
			// UPDATE below, and transient errors fail open like CreateChannel.
			if err == nil && !currentlyEnabled {
				if count, err := CountEnabledChannels(context.Background(), userID); err != nil {
					log.Printf("[Channels] slot count failed for %s: %v", userID, err)
				} else if used := count + req.LocalWidgets; used >= *max {
					tle := &TierLimitError{Tier: tier, ChannelType: channelType, Field: "widgets", Limit: *max, Got: used + 1}
					log.Printf("[Channels] slot limit blocks re-enable for %s: %d/%d (incl %d local)", userID, used, *max, req.LocalWidgets)
					return c.Status(fiber.StatusForbidden).JSON(tierLimitErrorResponse(tle))
				}
			}
		}
	}

	// Tier-gate any incoming config. We only check when config is
	// provided — updates that only toggle enabled/visible should not
	// re-validate (they're expected to be cheap + frequent, e.g. pause
	// the channel).
	if req.Config != nil {
		tier := tierFromRoles(GetUserRoles(c))
		if err := ValidateChannelConfig(tier, channelType, req.Config); err != nil {
			var tle *TierLimitError
			if errors.As(err, &tle) {
				log.Printf("[Channels] Tier limit exceeded for %s: %s", userID, tle.Error())
				return c.Status(fiber.StatusForbidden).JSON(tierLimitErrorResponse(tle))
			}
			return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
				Status: "error",
				Error:  err.Error(),
			})
		}
	}

	// Fetch old config before UPDATE so channels can diff
	var oldConfig map[string]interface{}
	if req.Config != nil {
		var oldConfigBytes []byte
		_ = DBPool.QueryRow(context.Background(), `
			SELECT config FROM user_channels WHERE logto_sub = $1 AND channel_type = $2
		`, userID, channelType).Scan(&oldConfigBytes)
		if len(oldConfigBytes) > 0 {
			json.Unmarshal(oldConfigBytes, &oldConfig)
		}
	}

	// Build dynamic UPDATE query
	setClauses := []string{"updated_at = now()"}
	args := []interface{}{userID, channelType}
	argIdx := 3

	if req.Enabled != nil {
		setClauses = append(setClauses, fmt.Sprintf("enabled = $%d", argIdx))
		args = append(args, *req.Enabled)
		argIdx++
	}
	if req.Visible != nil {
		setClauses = append(setClauses, fmt.Sprintf("visible = $%d", argIdx))
		args = append(args, *req.Visible)
		argIdx++
	}
	if req.Config != nil {
		configJSON, _ := json.Marshal(req.Config)
		setClauses = append(setClauses, fmt.Sprintf("config = $%d", argIdx))
		args = append(args, configJSON)
		argIdx++
	}

	query := fmt.Sprintf(`
		UPDATE user_channels
		SET %s
		WHERE logto_sub = $1 AND channel_type = $2
		RETURNING id, logto_sub, channel_type, enabled, visible, config, created_at, updated_at
	`, strings.Join(setClauses, ", "))

	var ch Channel
	var configBytes []byte
	err := DBPool.QueryRow(context.Background(), query, args...).Scan(
		&ch.ID, &ch.LogtoSub, &ch.ChannelType, &ch.Enabled, &ch.Visible,
		&configBytes, &ch.CreatedAt, &ch.UpdatedAt,
	)
	if err != nil {
		errStr := err.Error()
		if strings.Contains(errStr, "no rows") {
			return c.Status(fiber.StatusNotFound).JSON(ErrorResponse{
				Status: "error",
				Error:  "Channel not found",
			})
		}
		log.Printf("[Channels] Update error: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Status: "error",
			Error:  "Failed to update channel",
		})
	}

	if err := json.Unmarshal(configBytes, &ch.Config); err != nil {
		ch.Config = map[string]interface{}{}
	}

	// Maintain Redis subscription sets based on new enabled state
	ctx := context.Background()
	if ch.Enabled {
		addChannelSubscriptions(ctx, userID, ch.ChannelType, ch.Config)
	} else {
		removeChannelSubscriptions(ctx, userID, ch.ChannelType, ch.Config)
	}

	// Call OnChannelUpdated hook via HTTP
	callChannelLifecycle(ctx, channelType, "updated", userID, ch.Config, oldConfig, nil)

	// Invalidate dashboard cache so next poll gets fresh data
	InvalidateDashboardCache(userID)
	// Enabled/visible toggles change the overview's by_type summary.
	InvalidateOverviewCache(ctx, userID)

	return c.JSON(ch)
}

// DeleteChannel removes a channel by type for the authenticated user.
//
func DeleteChannel(c *fiber.Ctx) error {
	userID := GetUserID(c)
	if userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(ErrorResponse{
			Status: "unauthorized",
			Error:  "Authentication required",
		})
	}

	channelType := c.Params("type")

	// Fetch the channel config before deleting (needed for cleanup hooks)
	var configBytes []byte
	_ = DBPool.QueryRow(context.Background(), `
		SELECT config FROM user_channels WHERE logto_sub = $1 AND channel_type = $2
	`, userID, channelType).Scan(&configBytes)

	tag, err := DBPool.Exec(context.Background(), `
		DELETE FROM user_channels WHERE logto_sub = $1 AND channel_type = $2
	`, userID, channelType)
	if err != nil {
		log.Printf("[Channels] Delete error: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Status: "error",
			Error:  "Failed to delete channel",
		})
	}

	if tag.RowsAffected() == 0 {
		return c.Status(fiber.StatusNotFound).JSON(ErrorResponse{
			Status: "error",
			Error:  "Channel not found",
		})
	}

	// Clean up Redis subscription sets
	ctx := context.Background()
	var config map[string]interface{}
	if len(configBytes) > 0 {
		json.Unmarshal(configBytes, &config)
	}
	if config == nil {
		config = map[string]interface{}{}
	}
	removeChannelSubscriptions(ctx, userID, channelType, config)

	// Call OnChannelDeleted hook via HTTP
	callChannelLifecycle(ctx, channelType, "deleted", userID, config, nil, nil)

	// Invalidate dashboard cache so next poll gets fresh data
	InvalidateDashboardCache(userID)
	// Total/enabled counts in the overview are now stale.
	InvalidateOverviewCache(ctx, userID)

	return c.JSON(fiber.Map{"status": "ok", "message": "Channel removed"})
}

// PruneWidgetsForTier disables (never deletes) a user's newest enabled
// widgets until the count fits the tier's slot cap — the downgrade
// safety net of the widget/slot model. Oldest widgets survive
// (created_at ASC); rows stay in user_channels so the user can
// re-enable them after re-upgrading. Intended to be called from the
// Stripe webhook whenever a subscription change demotes the user to a
// lower tier. Local utility widgets live client-side and are enforced
// by the desktop cap-gate, not here.
//
// Returns nothing — failures are logged but do not propagate, because
// the webhook handler's primary job (role assignment, DB status update)
// must complete even if a prune fails.
func PruneWidgetsForTier(ctx context.Context, logtoSub, tier string) {
	max := MaxWidgetsForTier(tier)
	if max == nil {
		return // unlimited slots — nothing to prune
	}
	channels, err := GetUserChannels(logtoSub) // ordered created_at ASC
	if err != nil {
		log.Printf("[Prune] Failed to list widgets for %s: %v", logtoSub, err)
		return
	}
	kept, pruned := partitionWidgetsForCap(channels, *max)
	if len(pruned) == 0 {
		return
	}

	// Sources and sports leagues the surviving widgets still need. Split
	// widgets share source-level subscriber sets (sports_nfl and
	// sports_nba both live in channel:subscribers:sports), so a pruned
	// widget must not yank a subscription a kept sibling depends on.
	keptSources := map[string]bool{}
	keptLeagues := map[string]bool{}
	for _, ch := range kept {
		keptSources[DataSourceForWidget(ch.ChannelType)] = true
		for _, lg := range extractSportsLeaguesFromConfig(ch.Config) {
			keptLeagues[lg] = true
		}
	}

	for _, ch := range pruned {
		_, err := DBPool.Exec(ctx, `
			UPDATE user_channels SET enabled = false, updated_at = now()
			WHERE logto_sub = $1 AND channel_type = $2
		`, logtoSub, ch.ChannelType)
		if err != nil {
			log.Printf("[Prune] Failed to disable %s/%s: %v", logtoSub, ch.ChannelType, err)
			continue
		}
		log.Printf("[Prune] Disabled %s/%s: tier %s allows %d widget slots", logtoSub, ch.ChannelType, tier, *max)

		source := DataSourceForWidget(ch.ChannelType)
		if !keptSources[source] {
			RemoveSubscriber(ctx, RedisChannelSubscribersPrefix+source, logtoSub)
		}
		if source == "sports" {
			var stale []string
			for _, lg := range extractSportsLeaguesFromConfig(ch.Config) {
				if !keptLeagues[lg] {
					stale = append(stale, SportsLeagueSubscribersPrefix+lg)
				}
			}
			if len(stale) > 0 {
				if err := RemoveSubscriberMulti(ctx, stale, logtoSub); err != nil {
					log.Printf("[Prune] Failed to remove league subscriptions for %s: %v", logtoSub, err)
				}
			}
		}

		// Tell the backing service this widget went dark.
		enabled := false
		callChannelLifecycle(ctx, ch.ChannelType, "sync", logtoSub, ch.Config, nil, &enabled)
	}

	// Rebuild SSE topics on every replica holding a connection for this
	// user (Redis control message, ADR-0001), then refresh cached views.
	NotifyTopicSubscriptionChange(logtoSub)
	InvalidateDashboardCache(logtoSub)
	InvalidateOverviewCache(ctx, logtoSub)
}

// partitionWidgetsForCap splits a created_at-ascending channel list into
// the enabled widgets that fit the slot cap (oldest first) and the
// enabled overflow to disable. Disabled rows pass through untouched.
func partitionWidgetsForCap(channels []Channel, max int) (kept, pruned []Channel) {
	for _, ch := range channels {
		if !ch.Enabled {
			continue
		}
		if len(kept) < max {
			kept = append(kept, ch)
		} else {
			pruned = append(pruned, ch)
		}
	}
	return kept, pruned
}

// extractSportsLeaguesFromConfig reads the "leagues" array from a sports
// channel's config JSONB map. Config shape: {"leagues": ["NFL", "NBA", ...]}
func extractSportsLeaguesFromConfig(config map[string]interface{}) []string {
	if config == nil {
		return nil
	}
	raw, ok := config["leagues"]
	if !ok {
		return nil
	}
	arr, ok := raw.([]interface{})
	if !ok {
		return nil
	}
	leagues := make([]string, 0, len(arr))
	for _, v := range arr {
		if s, ok := v.(string); ok && s != "" {
			leagues = append(leagues, s)
		}
	}
	return leagues
}
