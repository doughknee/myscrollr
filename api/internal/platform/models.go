package platform

import (
	"context"
	"encoding/json"
	"log"
	"time"
)

// GetUserWidgets fetches all of a user's widgets (rows of user_widgets).
// Lives beside the Widget model rather than with the widget CRUD handlers
// because the SSE hub also reads it to build a user's topic subscriptions.
func GetUserWidgets(logtoSub string) ([]Widget, error) {
	rows, err := DBPool.Query(context.Background(), `
		SELECT id, logto_sub, widget_type, enabled, visible, config, created_at, updated_at
		FROM user_widgets
		WHERE logto_sub = $1
		ORDER BY created_at ASC, id ASC
	`, logtoSub)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	widgets := make([]Widget, 0)
	for rows.Next() {
		var ch Widget
		var configJSON []byte
		if err := rows.Scan(&ch.ID, &ch.LogtoSub, &ch.WidgetType, &ch.Enabled, &ch.Visible, &configJSON, &ch.CreatedAt, &ch.UpdatedAt); err != nil {
			log.Printf("[Widgets] Scan error: %v", err)
			continue
		}
		if err := json.Unmarshal(configJSON, &ch.Config); err != nil {
			ch.Config = map[string]interface{}{}
		}
		widgets = append(widgets, ch)
	}

	return widgets, nil
}

// UserPreferences represents a user's extension display preferences.
type UserPreferences struct {
	LogtoSub         string   `json:"-"`
	FeedMode         string   `json:"feed_mode"`
	FeedPosition     string   `json:"feed_position"`
	FeedBehavior     string   `json:"feed_behavior"`
	FeedEnabled      bool     `json:"feed_enabled"`
	EnabledSites     []string `json:"enabled_sites"`
	DisabledSites    []string `json:"disabled_sites"`
	SubscriptionTier string   `json:"subscription_tier"`
	UpdatedAt        string   `json:"updated_at"`
}

// Widget represents a user's widget subscription — one row of the
// user_widgets table.
//
// The DB and Go identifiers now say "widget" (Phase 2). The *wire* still
// speaks the old vocabulary — the JSON tag below is `channel_type`, and
// the routes are still /users/me/channels — because renaming the wire is
// Phase 3, done in one pass with the client.
//
// `Visible` is likewise a wire holdover; MarshalJSON also emits
// `ticker_enabled` and inbound updates accept both names (see
// channels.go:UpdateWidget). Phase 5 deletes the duplicate.
type Widget struct {
	ID         int                    `json:"id"`
	LogtoSub   string                 `json:"-"`
	WidgetType string                 `json:"channel_type"`
	Enabled    bool                   `json:"enabled"`
	Visible    bool                   `json:"visible"`
	Config     map[string]interface{} `json:"config"`
	CreatedAt  time.Time              `json:"created_at"`
	UpdatedAt  time.Time              `json:"updated_at"`
}

// MarshalJSON emits both `visible` (legacy) and `ticker_enabled` (clearer
// modern name) so v1.0.3 desktops and v1.0.4+ desktops both read the
// same value. The DB column and struct field stay `visible` to avoid a
// migration; this is wire-format backwards compatibility only.
func (c Widget) MarshalJSON() ([]byte, error) {
	type alias Widget
	return json.Marshal(&struct {
		alias
		TickerEnabled bool `json:"ticker_enabled"`
	}{
		alias:         alias(c),
		TickerEnabled: c.Visible,
	})
}

// DashboardResponse is the aggregated response for the /dashboard endpoint.
// Data is a generic map keyed by data-source name (e.g. "finance", "sports").
// The Widgets field keeps its legacy wire name `channels`.
type DashboardResponse struct {
	Data        map[string]interface{} `json:"data"`
	Preferences *UserPreferences       `json:"preferences,omitempty"`
	Widgets     []Widget               `json:"channels,omitempty"`
}

// HealthResponse represents the aggregated health status.
type HealthResponse struct {
	Status   string            `json:"status"`
	Database string            `json:"database"`
	Redis    string            `json:"redis"`
	Services map[string]string `json:"services"`
}

// ErrorResponse represents a standard API error.
type ErrorResponse struct {
	Status string `json:"status"`
	Error  string `json:"error"`
}

// =============================================================================
// Billing
// =============================================================================

// StripeCustomer maps a Logto user to their Stripe customer and subscription.
type StripeCustomer struct {
	LogtoSub             string     `json:"logto_sub"`
	StripeCustomerID     string     `json:"stripe_customer_id"`
	StripeSubscriptionID *string    `json:"stripe_subscription_id,omitempty"`
	Plan                 string     `json:"plan"`
	Status               string     `json:"status"`
	CurrentPeriodEnd     *time.Time `json:"current_period_end,omitempty"`
	Lifetime             bool       `json:"lifetime"`
	CreatedAt            time.Time  `json:"created_at"`
	UpdatedAt            time.Time  `json:"updated_at"`
}

// CheckoutRequest is the body for POST /checkout/session.
type CheckoutRequest struct {
	PriceID string `json:"price_id"`
}

// PlanChangeRequest is the body for PUT /users/me/subscription/plan.
type PlanChangeRequest struct {
	PriceID       string `json:"price_id"`
	ProrationDate int64  `json:"proration_date,omitempty"`
}

// PlanPreviewResponse returns the proration preview for a plan change.
type PlanPreviewResponse struct {
	AmountDue     int64  `json:"amount_due"`
	Currency      string `json:"currency"`
	ProrationDate int64  `json:"proration_date"`
	IsDowngrade   bool   `json:"is_downgrade"`
	ScheduledDate int64  `json:"scheduled_date,omitempty"`
	IsTrialChange bool   `json:"is_trial_change,omitempty"`
	TrialEnd      int64  `json:"trial_end,omitempty"`
}

// CheckoutResponse returns the client secret for the Payment Element.
type CheckoutResponse struct {
	ClientSecret   string `json:"client_secret"`
	SessionID      string `json:"session_id"`
	PublishableKey string `json:"publishable_key"`
}

// SetupIntentResponse returns the client secret for the Payment Element (subscription flow).
type SetupIntentResponse struct {
	ClientSecret   string `json:"client_secret"`
	Plan           string `json:"plan"`
	HasTrial       bool   `json:"has_trial"`
	TrialDays      int64  `json:"trial_days,omitempty"`
	Amount         int64  `json:"amount"`
	Currency       string `json:"currency"`
	Interval       string `json:"interval"`
	PublishableKey string `json:"publishable_key"`
}

// SubscribeRequest is the body for POST /checkout/subscribe.
type SubscribeRequest struct {
	SetupIntentID string `json:"setup_intent_id"`
	PriceID       string `json:"price_id"`
}

// SubscribeResponse returns the newly created subscription details.
type SubscribeResponse struct {
	SubscriptionID string `json:"subscription_id"`
	Status         string `json:"status"`
	TrialEnd       *int64 `json:"trial_end,omitempty"`
	Plan           string `json:"plan"`
}

// PaymentIntentResponse returns the client secret for the Payment Element (lifetime flow).
type PaymentIntentResponse struct {
	ClientSecret   string `json:"client_secret"`
	Amount         int64  `json:"amount"`
	Currency       string `json:"currency"`
	PublishableKey string `json:"publishable_key"`
}

// SubscriptionResponse returns the user's subscription state.
type SubscriptionResponse struct {
	Plan                 string     `json:"plan"`
	Status               string     `json:"status"`
	CurrentPeriodEnd     *time.Time `json:"current_period_end,omitempty"`
	Lifetime             bool       `json:"lifetime"`
	PendingDowngradePlan string     `json:"pending_downgrade_plan,omitempty"`
	ScheduledChangeAt    *time.Time `json:"scheduled_change_at,omitempty"`
	Amount               int64      `json:"amount,omitempty"`
	Currency             string     `json:"currency,omitempty"`
	Interval             string     `json:"interval,omitempty"`
	TrialEnd             *int64     `json:"trial_end,omitempty"`
	HadPriorSub          bool       `json:"had_prior_sub"`
}

// CheckoutReturnResponse tells the frontend about the checkout outcome.
type CheckoutReturnResponse struct {
	Status    string `json:"status"`
	SessionID string `json:"session_id,omitempty"`
}
