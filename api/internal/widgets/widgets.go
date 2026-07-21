package widgets

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/events"
	"github.com/brandon-relentnet/myscrollr/api/internal/ingestread"
	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/gofiber/fiber/v2"
)

var lifecycleClient = &http.Client{
	Timeout: 10 * time.Second,
}

// CountEnabledWidgets returns how many enabled widgets a user
// currently has — the "slots in use" for the widget/slot model. Used by
// CreateWidget to gate new additions against the tier's MaxWidgets cap.
func CountEnabledWidgets(ctx context.Context, logtoSub string) (int, error) {
	var n int
	err := platform.DBPool.QueryRow(ctx,
		`SELECT count(*) FROM user_widgets WHERE logto_sub = $1 AND enabled = true`,
		logtoSub).Scan(&n)
	return n, err
}

// callWidgetLifecycle sends a widget lifecycle event to the backing service
// if it has the channel_lifecycle capability (wire name unchanged).
func callWidgetLifecycle(ctx context.Context, widgetType, event, userSub string, config, oldConfig map[string]interface{}, enabled *bool) {
	// Resolve to the backing data source so widget types (e.g. "news") reach
	// the right service's lifecycle hook (rss). Legacy coarse types map to
	// themselves.
	source := platform.DataSourceForWidget(widgetType)

	// Local widget sources (ADR-0002): most sources only need per-user
	// cache invalidation (the one live behavior of the HTTP lifecycle
	// contract — Appendix A); rss provides a full lifecycle hook because
	// it also syncs custom feeds into the polling-target tables.
	if ingestread.DispatchLifecycle(source, event, userSub, config, oldConfig, enabled) {
		return
	}

	ch := platform.GetChannel(source)
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
		log.Printf("[Widgets] Failed to marshal lifecycle request: %v", err)
		return
	}

	url := ch.InternalURL + "/internal/channel-lifecycle"
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(reqBody))
	if err != nil {
		log.Printf("[Widgets] Failed to create lifecycle request: %v", err)
		return
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := lifecycleClient.Do(req)
	if err != nil {
		log.Printf("[Widgets] Lifecycle call to %s/%s failed: %v", ch.Name, event, err)
		return
	}
	defer resp.Body.Close()
	io.Copy(io.Discard, resp.Body)

	if resp.StatusCode != 200 {
		log.Printf("[Widgets] Lifecycle call to %s/%s returned status %d", ch.Name, event, resp.StatusCode)
	}
}

// GetWidgets returns all widgets for the authenticated user.
func GetWidgets(c *fiber.Ctx) error {
	userID := platform.GetUserID(c)
	if userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(platform.ErrorResponse{
			Status: "unauthorized",
			Error:  "Authentication required",
		})
	}

	widgets, err := platform.GetUserWidgets(userID)
	if err != nil {
		log.Printf("[Widgets] Error fetching widgets: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(platform.ErrorResponse{
			Status: "error",
			Error:  "Failed to fetch channels",
		})
	}

	return c.JSON(fiber.Map{"widgets": widgets})
}

// CreateWidget adds a new widget for the authenticated user.
func CreateWidget(c *fiber.Ctx) error {
	userID := platform.GetUserID(c)
	if userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(platform.ErrorResponse{
			Status: "unauthorized",
			Error:  "Authentication required",
		})
	}

	var req struct {
		WidgetType string                 `json:"widget_type"`
		Config     map[string]interface{} `json:"config"`
		// LocalWidgets is the client's count of enabled utility widgets
		// (clock/weather/…). They live in preferences, not user_widgets, but
		// every widget counts toward the slot cap — so the client reports them
		// and the slot gate adds them to the DB widget count. Absent (older
		// client) = 0, degrading to a data-widget-only gate.
		LocalWidgets int `json:"local_widgets"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(platform.ErrorResponse{
			Status: "error",
			Error:  "Invalid request body",
		})
	}

	// The catalog is the only authority on what a widget is.
	//
	// This used to also accept anything in GetValidChannelTypes(), which is the
	// set of DISCOVERED BACKEND SERVICES — a different concept entirely. It let
	// widget_type "fantasy" through (the service registers under that name)
	// while the catalog id is "fantasy_yahoo", producing a row with no catalog
	// entry: it consumed a slot, resolved to no source, subscribed to no SSE
	// topic, fired no lifecycle event, and could not render. The OR was added
	// so coarse types ("sports") kept working during the widget/slot
	// transition; that transition is over and those types no longer exist.
	if !platform.IsKnownWidgetType(req.WidgetType) {
		return c.Status(fiber.StatusBadRequest).JSON(platform.ErrorResponse{
			Status: "error",
			Error:  "Unknown widget type",
		})
	}
	// Utility widgets (clock/weather/…) live in desktop preferences, not
	// user_widgets. A row for one has no backing data source and would
	// double-count against the slot cap (once here, once via
	// local_widgets), so reject it outright.
	if platform.IsUtilityWidgetType(req.WidgetType) {
		return c.Status(fiber.StatusBadRequest).JSON(platform.ErrorResponse{
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

	tier := platform.TierFromRoles(platform.GetUserRoles(c))

	// Availability gate: the catalog's required_tier. The desktop already
	// checks this and renders "Requires <tier> — Upgrade", but only the API
	// decides what actually gets stored, so a direct POST bypassed it. Every
	// catalog entry is "free" today, which makes this a no-op right now — and
	// is exactly why it was worth adding before the first paid widget, rather
	// than discovering the gate was decorative afterwards.
	if def, ok := platform.WidgetByID(req.WidgetType); ok && !TierMeets(tier, def.RequiredTier) {
		log.Printf("[Widgets] %s on %s attempted %s (requires %s)", userID, tier, req.WidgetType, def.RequiredTier)
		return c.Status(fiber.StatusForbidden).JSON(platform.ErrorResponse{
			Status: "error",
			Error: fmt.Sprintf("%s requires the %s plan.",
				def.Name, TierDisplayName(def.RequiredTier)),
		})
	}

	// Slot gate (widget/slot model, 2026-06-30): block adding a *new*
	// widget once the user is at their tier's MaxWidgets cap. Existing
	// over-cap users are grandfathered — we never disable what they
	// already have, we only block new adds. nil cap = unlimited. A count
	// error is logged but not fatal: failing open here is safer than
	// blocking a legitimate add on a transient DB blip.
	if max := MaxWidgetsForTier(tier); max != nil {
		if count, err := CountEnabledWidgets(context.Background(), userID); err != nil {
			log.Printf("[Widgets] slot count failed for %s: %v", userID, err)
		} else {
			// Every widget counts toward the slot cap. Utility widgets live
			// client-side (preferences), so add the client-reported count to
			// the DB widget count.
			used := count + req.LocalWidgets
			if used >= *max {
				tle := &TierLimitError{Tier: tier, WidgetType: req.WidgetType, Field: "widgets", Limit: *max, Got: used + 1}
				log.Printf("[Widgets] slot limit reached for %s: %d/%d (incl %d local)", userID, used, *max, req.LocalWidgets)
				return c.Status(fiber.StatusForbidden).JSON(tierLimitErrorResponse(tle))
			}
		}
	}

	configJSON, _ := json.Marshal(req.Config)

	var ch platform.Widget
	var configBytes []byte
	err := platform.DBPool.QueryRow(context.Background(), `
		INSERT INTO user_widgets (logto_sub, widget_type, config)
		VALUES ($1, $2, $3)
		RETURNING id, logto_sub, widget_type, enabled, ticker_enabled, config, created_at, updated_at
	`, userID, req.WidgetType, configJSON).Scan(
		&ch.ID, &ch.LogtoSub, &ch.WidgetType, &ch.Enabled, &ch.TickerEnabled,
		&configBytes, &ch.CreatedAt, &ch.UpdatedAt,
	)
	if err != nil {
		if strings.Contains(err.Error(), "unique") || strings.Contains(err.Error(), "duplicate") {
			return c.Status(fiber.StatusConflict).JSON(platform.ErrorResponse{
				Status: "error",
				Error:  "Channel of this type already exists",
			})
		}
		log.Printf("[Widgets] Create error: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(platform.ErrorResponse{
			Status: "error",
			Error:  "Failed to create channel",
		})
	}

	if err := json.Unmarshal(configBytes, &ch.Config); err != nil {
		ch.Config = map[string]interface{}{}
	}

	// Rebuild SSE topic subscriptions on every replica holding a
	// connection for this user (Redis control message, ADR-0001)
	ctx := context.Background()
	if ch.Enabled {
		events.NotifyTopicSubscriptionChange(userID)
	}

	// Fire the "created" lifecycle hook (in-process for local sources)
	callWidgetLifecycle(ctx, ch.WidgetType, "created", userID, ch.Config, nil, nil)

	// Invalidate dashboard cache so next poll gets fresh data
	platform.InvalidateDashboardCache(userID)
	// Widget summary in the overview response changed — drop the
	// per-user overview cache so the next /users/me/overview rebuilds.
	platform.InvalidateOverviewCache(ctx, userID)

	return c.Status(fiber.StatusCreated).JSON(ch)
}

// UpdateWidget updates a widget by type for the authenticated user.
func UpdateWidget(c *fiber.Ctx) error {
	userID := platform.GetUserID(c)
	if userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(platform.ErrorResponse{
			Status: "unauthorized",
			Error:  "Authentication required",
		})
	}

	widgetType := c.Params("type")
	// Catalog-only, same as CreateWidget — see the note there.
	if !platform.IsKnownWidgetType(widgetType) {
		return c.Status(fiber.StatusBadRequest).JSON(platform.ErrorResponse{
			Status: "error",
			Error:  "Unknown widget type",
		})
	}

	var req struct {
		Enabled       *bool                  `json:"enabled"`
		TickerEnabled *bool                  `json:"ticker_enabled"`
		Config        map[string]interface{} `json:"config"`
		// LocalWidgets mirrors CreateWidget: the client's count of enabled
		// utility widgets, added to the DB count when gating a re-enable.
		// Absent (older client) = 0.
		LocalWidgets int `json:"local_widgets"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(platform.ErrorResponse{
			Status: "error",
			Error:  "Invalid request body",
		})
	}
	if req.LocalWidgets < 0 {
		req.LocalWidgets = 0
	}

	// Gate RE-ENABLING against the widget-slot cap, exactly like
	// CreateWidget gates new adds. Without this the cap is a one-way door:
	// disable a widget, add a new one in the freed slot, re-enable the old
	// one ungated — repeat past any tier limit (and past a Stripe-downgrade
	// prune). Enabling an already-enabled widget stays a no-op passthrough.
	if req.Enabled != nil && *req.Enabled {
		tier := platform.TierFromRoles(platform.GetUserRoles(c))
		if max := MaxWidgetsForTier(tier); max != nil {
			var currentlyEnabled bool
			err := platform.DBPool.QueryRow(context.Background(), `
				SELECT enabled FROM user_widgets WHERE logto_sub = $1 AND widget_type = $2
			`, userID, widgetType).Scan(&currentlyEnabled)
			// Row-lookup errors fall through: a missing row 404s on the
			// UPDATE below, and transient errors fail open like CreateWidget.
			if err == nil && !currentlyEnabled {
				if count, err := CountEnabledWidgets(context.Background(), userID); err != nil {
					log.Printf("[Widgets] slot count failed for %s: %v", userID, err)
				} else if used := count + req.LocalWidgets; used >= *max {
					tle := &TierLimitError{Tier: tier, WidgetType: widgetType, Field: "widgets", Limit: *max, Got: used + 1}
					log.Printf("[Widgets] slot limit blocks re-enable for %s: %d/%d (incl %d local)", userID, used, *max, req.LocalWidgets)
					return c.Status(fiber.StatusForbidden).JSON(tierLimitErrorResponse(tle))
				}
			}
		}
	}

	// Fetch old config before UPDATE so lifecycle hooks can diff
	var oldConfig map[string]interface{}
	if req.Config != nil {
		var oldConfigBytes []byte
		_ = platform.DBPool.QueryRow(context.Background(), `
			SELECT config FROM user_widgets WHERE logto_sub = $1 AND widget_type = $2
		`, userID, widgetType).Scan(&oldConfigBytes)
		if len(oldConfigBytes) > 0 {
			json.Unmarshal(oldConfigBytes, &oldConfig)
		}
	}

	// Build dynamic UPDATE query
	setClauses := []string{"updated_at = now()"}
	args := []interface{}{userID, widgetType}
	argIdx := 3

	if req.Enabled != nil {
		setClauses = append(setClauses, fmt.Sprintf("enabled = $%d", argIdx))
		args = append(args, *req.Enabled)
		argIdx++
	}
	if req.TickerEnabled != nil {
		setClauses = append(setClauses, fmt.Sprintf("ticker_enabled = $%d", argIdx))
		args = append(args, *req.TickerEnabled)
		argIdx++
	}
	if req.Config != nil {
		configJSON, _ := json.Marshal(req.Config)
		setClauses = append(setClauses, fmt.Sprintf("config = $%d", argIdx))
		args = append(args, configJSON)
		argIdx++
	}

	query := fmt.Sprintf(`
		UPDATE user_widgets
		SET %s
		WHERE logto_sub = $1 AND widget_type = $2
		RETURNING id, logto_sub, widget_type, enabled, ticker_enabled, config, created_at, updated_at
	`, strings.Join(setClauses, ", "))

	var ch platform.Widget
	var configBytes []byte
	err := platform.DBPool.QueryRow(context.Background(), query, args...).Scan(
		&ch.ID, &ch.LogtoSub, &ch.WidgetType, &ch.Enabled, &ch.TickerEnabled,
		&configBytes, &ch.CreatedAt, &ch.UpdatedAt,
	)
	if err != nil {
		errStr := err.Error()
		if strings.Contains(errStr, "no rows") {
			return c.Status(fiber.StatusNotFound).JSON(platform.ErrorResponse{
				Status: "error",
				Error:  "Channel not found",
			})
		}
		log.Printf("[Widgets] Update error: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(platform.ErrorResponse{
			Status: "error",
			Error:  "Failed to update channel",
		})
	}

	if err := json.Unmarshal(configBytes, &ch.Config); err != nil {
		ch.Config = map[string]interface{}{}
	}

	// Rebuild SSE topic subscriptions on every replica holding a
	// connection for this user (Redis control message, ADR-0001)
	ctx := context.Background()
	events.NotifyTopicSubscriptionChange(userID)

	// Fire the "updated" lifecycle hook (in-process for local sources)
	callWidgetLifecycle(ctx, widgetType, "updated", userID, ch.Config, oldConfig, nil)

	// Invalidate dashboard cache so next poll gets fresh data
	platform.InvalidateDashboardCache(userID)
	// Enabled/visible toggles change the overview's by_type summary.
	platform.InvalidateOverviewCache(ctx, userID)

	return c.JSON(ch)
}

// DeleteWidget removes a widget by type for the authenticated user.
func DeleteWidget(c *fiber.Ctx) error {
	userID := platform.GetUserID(c)
	if userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(platform.ErrorResponse{
			Status: "unauthorized",
			Error:  "Authentication required",
		})
	}

	widgetType := c.Params("type")

	// Fetch the widget config before deleting (needed for cleanup hooks)
	var configBytes []byte
	_ = platform.DBPool.QueryRow(context.Background(), `
		SELECT config FROM user_widgets WHERE logto_sub = $1 AND widget_type = $2
	`, userID, widgetType).Scan(&configBytes)

	tag, err := platform.DBPool.Exec(context.Background(), `
		DELETE FROM user_widgets WHERE logto_sub = $1 AND widget_type = $2
	`, userID, widgetType)
	if err != nil {
		log.Printf("[Widgets] Delete error: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(platform.ErrorResponse{
			Status: "error",
			Error:  "Failed to delete channel",
		})
	}

	if tag.RowsAffected() == 0 {
		return c.Status(fiber.StatusNotFound).JSON(platform.ErrorResponse{
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
	// Rebuild SSE topic subscriptions on every replica so active
	// connections stop receiving this widget's data (ADR-0001)
	events.NotifyTopicSubscriptionChange(userID)

	// Fire the "deleted" lifecycle hook (in-process for local sources)
	callWidgetLifecycle(ctx, widgetType, "deleted", userID, config, nil, nil)

	// Invalidate dashboard cache so next poll gets fresh data
	platform.InvalidateDashboardCache(userID)
	// Total/enabled counts in the overview are now stale.
	platform.InvalidateOverviewCache(ctx, userID)

	return c.JSON(fiber.Map{"status": "ok", "message": "Channel removed"})
}

// PruneWidgetsForTier disables (never deletes) a user's newest enabled
// widgets until the count fits the tier's slot cap — the downgrade
// safety net of the widget/slot model. Oldest widgets survive
// (created_at ASC); rows stay in user_widgets so the user can
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
	widgets, err := platform.GetUserWidgets(logtoSub) // ordered created_at ASC
	if err != nil {
		log.Printf("[Prune] Failed to list widgets for %s: %v", logtoSub, err)
		return
	}
	_, pruned := partitionWidgetsForCap(widgets, *max)
	if len(pruned) == 0 {
		return
	}

	for _, ch := range pruned {
		_, err := platform.DBPool.Exec(ctx, `
			UPDATE user_widgets SET enabled = false, updated_at = now()
			WHERE logto_sub = $1 AND widget_type = $2
		`, logtoSub, ch.WidgetType)
		if err != nil {
			log.Printf("[Prune] Failed to disable %s/%s: %v", logtoSub, ch.WidgetType, err)
			continue
		}
		log.Printf("[Prune] Disabled %s/%s: tier %s allows %d widget slots", logtoSub, ch.WidgetType, tier, *max)
	}

	// Rebuild SSE topics on every replica holding a connection for this
	// user (Redis control message, ADR-0001), then refresh cached views.
	events.NotifyTopicSubscriptionChange(logtoSub)
	platform.InvalidateDashboardCache(logtoSub)
	platform.InvalidateOverviewCache(ctx, logtoSub)
}

// partitionWidgetsForCap splits a created_at-ascending widget list into
// the enabled widgets that fit the slot cap (oldest first) and the
// enabled overflow to disable. Disabled rows pass through untouched.
func partitionWidgetsForCap(widgets []platform.Widget, max int) (kept, pruned []platform.Widget) {
	for _, ch := range widgets {
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
