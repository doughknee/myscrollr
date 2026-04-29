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
		ORDER BY created_at ASC
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

// SyncChannelSubscriptions rebuilds Redis subscription sets for a user from their
// current channels in the database. Called on dashboard load and after channel CRUD.
func SyncChannelSubscriptions(logtoSub string) {
	channels, err := GetUserChannels(logtoSub)
	if err != nil {
		log.Printf("[Channels] Failed to sync subscriptions for %s: %v", logtoSub, err)
		return
	}

	ctx := context.Background()
	for _, ch := range channels {
		setKey := RedisChannelSubscribersPrefix + ch.ChannelType
		if ch.Enabled {
			AddSubscriber(ctx, setKey, logtoSub)
		} else {
			RemoveSubscriber(ctx, setKey, logtoSub)
		}

		// Sports: sync per-league subscriber sets based on user's configured leagues
		if ch.ChannelType == "sports" {
			leagues := extractSportsLeaguesFromConfig(ch.Config)
			if len(leagues) > 0 {
				leagueKeys := make([]string, len(leagues))
				for i, league := range leagues {
					leagueKeys[i] = SportsLeagueSubscribersPrefix + league
				}
				if ch.Enabled {
					if err := AddSubscriberMulti(ctx, leagueKeys, logtoSub); err != nil {
						log.Printf("[Channels] Failed to sync sports league subscriptions for %s: %v", logtoSub, err)
					}
				} else {
					if err := RemoveSubscriberMulti(ctx, leagueKeys, logtoSub); err != nil {
						log.Printf("[Channels] Failed to remove sports league subscriptions for %s: %v", logtoSub, err)
					}
				}
			}
		}

		// Call channel lifecycle hook via HTTP
		callChannelLifecycle(ctx, ch.ChannelType, "sync", logtoSub, ch.Config, nil, &ch.Enabled)
	}
}

// addChannelSubscriptions adds Redis subscription entries for a newly created/enabled channel.
// For sports, this also adds the user to all per-league subscriber sets.
// Also updates the in-memory topic registry for active SSE connections.
func addChannelSubscriptions(ctx context.Context, logtoSub, channelType string, config map[string]interface{}) {
	AddSubscriber(ctx, RedisChannelSubscribersPrefix+channelType, logtoSub)

	// Sports: populate per-league subscriber sets for user's configured leagues.
	if channelType == "sports" {
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

	// Rebuild topic subscriptions so active SSE connections get the new channel
	UpdateUserTopicSubscriptions(logtoSub)

	enabled := true
	callChannelLifecycle(ctx, channelType, "sync", logtoSub, config, nil, &enabled)
}

// removeChannelSubscriptions removes Redis subscription entries for a deleted/disabled channel.
// For sports, this also removes the user from all per-league subscriber sets.
// Also updates the in-memory topic registry for active SSE connections.
func removeChannelSubscriptions(ctx context.Context, logtoSub, channelType string, config map[string]interface{}) {
	RemoveSubscriber(ctx, RedisChannelSubscribersPrefix+channelType, logtoSub)

	// Sports: remove from per-league subscriber sets for user's configured leagues.
	if channelType == "sports" {
		leagues := extractSportsLeaguesFromConfig(config)
		if len(leagues) > 0 {
			leagueKeys := make([]string, len(leagues))
			for i, league := range leagues {
				leagueKeys[i] = SportsLeagueSubscribersPrefix + league
			}
			if err := RemoveSubscriberMulti(ctx, leagueKeys, logtoSub); err != nil {
				log.Printf("[Channels] Failed to remove sports league subscriptions for %s: %v", logtoSub, err)
			}
		}
	}

	// Rebuild topic subscriptions so active SSE connections stop receiving this channel
	UpdateUserTopicSubscriptions(logtoSub)

	enabled := false
	callChannelLifecycle(ctx, channelType, "sync", logtoSub, config, nil, &enabled)
}

// callChannelLifecycle sends a lifecycle event to a channel if it has the channel_lifecycle capability.
func callChannelLifecycle(ctx context.Context, channelType, event, userSub string, config, oldConfig map[string]interface{}, enabled *bool) {
	ch := GetChannel(channelType)
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
// @Summary Get user channels
// @Description Returns all active channels for the authenticated user
// @Tags Channels
// @Produce json
// @Success 200 {object} object{channels=[]Channel}
// @Security LogtoAuth
// @Router /users/me/channels [get]
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
// @Summary Create a channel
// @Description Add a new channel for the authenticated user
// @Tags Channels
// @Accept json
// @Produce json
// @Param body body object true "Channel creation request" example({"channel_type":"rss","config":{}})
// @Success 201 {object} Channel
// @Failure 400 {object} ErrorResponse
// @Failure 409 {object} ErrorResponse
// @Security LogtoAuth
// @Router /users/me/channels [post]
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
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Status: "error",
			Error:  "Invalid request body",
		})
	}

	// Validate channel type against discovered channels
	validTypes := GetValidChannelTypes()
	if !validTypes[req.ChannelType] {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Status: "error",
			Error:  "Invalid channel type",
		})
	}

	if req.Config == nil {
		req.Config = map[string]interface{}{}
	}

	// Tier-gate the config shape. Frontend already enforces these caps
	// but the API is the only place that actually matters — the Rust
	// ingestion services trust user_channels.config verbatim.
	tier := tierFromRoles(GetUserRoles(c))
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
// @Summary Update a channel
// @Description Update channel settings (enabled, visible, config) by channel type
// @Tags Channels
// @Accept json
// @Produce json
// @Param type path string true "Channel type (finance, sports, fantasy, rss)"
// @Param body body object true "Channel update request"
// @Success 200 {object} Channel
// @Failure 404 {object} ErrorResponse
// @Security LogtoAuth
// @Router /users/me/channels/{type} [put]
func UpdateChannel(c *fiber.Ctx) error {
	userID := GetUserID(c)
	if userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(ErrorResponse{
			Status: "unauthorized",
			Error:  "Authentication required",
		})
	}

	channelType := c.Params("type")
	validTypes := GetValidChannelTypes()
	if !validTypes[channelType] {
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
// @Summary Delete a channel
// @Description Remove a channel by type
// @Tags Channels
// @Produce json
// @Param type path string true "Channel type"
// @Success 200 {object} object{status=string,message=string}
// @Failure 404 {object} ErrorResponse
// @Security LogtoAuth
// @Router /users/me/channels/{type} [delete]
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

// PruneUserChannelsForTier walks all user_channels rows for a user and
// trims each config to the caps of the given tier. UPDATEs are skipped
// for rows that were already within-cap. Intended to be called from the
// Stripe webhook whenever a subscription change demotes the user to a
// lower tier — stops silent over-use of TwelveData/Yahoo budgets that
// the frontend cap-gate can't protect against.
//
// Returns nothing — failures are logged but do not propagate, because
// the webhook handler's primary job (role assignment, DB status update)
// must complete even if a prune fails.
func PruneUserChannelsForTier(ctx context.Context, logtoSub, tier string) {
	channels, err := GetUserChannels(logtoSub)
	if err != nil {
		log.Printf("[Prune] Failed to list channels for %s: %v", logtoSub, err)
		return
	}
	for _, ch := range channels {
		newConfig, report := PruneChannelConfig(tier, ch.ChannelType, ch.Config)
		if !report.Changed() {
			continue
		}
		newJSON, err := json.Marshal(newConfig)
		if err != nil {
			log.Printf("[Prune] Failed to marshal pruned config for %s/%s: %v", logtoSub, ch.ChannelType, err)
			continue
		}
		_, err = DBPool.Exec(ctx, `
			UPDATE user_channels SET config = $3, updated_at = now()
			WHERE logto_sub = $1 AND channel_type = $2
		`, logtoSub, ch.ChannelType, newJSON)
		if err != nil {
			log.Printf("[Prune] Failed to UPDATE %s/%s: %v", logtoSub, ch.ChannelType, err)
			continue
		}
		log.Printf("[Prune] %s/%s to tier %s: symbols=%d→%d feeds=%d→%d custom=%d→%d leagues=%d→%d",
			logtoSub, ch.ChannelType, tier,
			report.SymbolsBefore, report.SymbolsAfter,
			report.FeedsBefore, report.FeedsAfter,
			report.CustomFeedsBefore, report.CustomFeedsAfter,
			report.LeaguesBefore, report.LeaguesAfter,
		)
		// Refresh subscriptions + lifecycle hook so the Rust service
		// sees the trimmed config immediately instead of on next sync.
		if ch.Enabled {
			addChannelSubscriptions(ctx, logtoSub, ch.ChannelType, newConfig)
		}
		callChannelLifecycle(ctx, ch.ChannelType, "updated", logtoSub, newConfig, ch.Config, nil)
	}
	InvalidateDashboardCache(logtoSub)
	InvalidateOverviewCache(ctx, logtoSub)
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
