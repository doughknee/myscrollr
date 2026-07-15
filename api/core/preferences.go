package core

import (
	"context"
	"encoding/json"
	"log"
	"time"

	"github.com/gofiber/fiber/v2"
)

// tierFromRoles determines the subscription tier based on JWT roles.
// Priority: super_user > uplink_ultimate > uplink_pro > uplink > free.
func tierFromRoles(roles []string) string {
	tier := "free"
	for _, r := range roles {
		switch r {
		case "super_user":
			return "super_user" // highest — return immediately
		case "uplink_ultimate":
			return "uplink_ultimate"
		case "uplink_pro":
			if tier != "uplink_ultimate" {
				tier = "uplink_pro"
			}
		case "uplink":
			if tier == "free" {
				tier = "uplink"
			}
		}
	}
	return tier
}

// GetOrCreatePreferences fetches preferences for a user, creating defaults if none exist.
// If roles are provided, the subscription_tier is synced from JWT roles → DB.
func GetOrCreatePreferences(logtoSub string, roles ...[]string) (*UserPreferences, error) {
	var prefs UserPreferences
	var enabledSites, disabledSites []byte
	var updatedAt time.Time

	err := DBPool.QueryRow(context.Background(),
		`SELECT logto_sub, feed_mode, feed_position, feed_behavior, feed_enabled,
		        enabled_sites, disabled_sites, subscription_tier, updated_at
		 FROM user_preferences WHERE logto_sub = $1`, logtoSub,
	).Scan(
		&prefs.LogtoSub, &prefs.FeedMode, &prefs.FeedPosition, &prefs.FeedBehavior,
		&prefs.FeedEnabled, &enabledSites, &disabledSites, &prefs.SubscriptionTier, &updatedAt,
	)

	if err != nil {
		var esBytes, dsBytes []byte
		var insertedAt time.Time
		err = DBPool.QueryRow(context.Background(),
			`INSERT INTO user_preferences (logto_sub)
			 VALUES ($1)
			 ON CONFLICT (logto_sub) DO UPDATE SET logto_sub = EXCLUDED.logto_sub
			 RETURNING logto_sub, feed_mode, feed_position, feed_behavior, feed_enabled,
			           enabled_sites, disabled_sites, subscription_tier, updated_at`,
			logtoSub,
		).Scan(
			&prefs.LogtoSub, &prefs.FeedMode, &prefs.FeedPosition, &prefs.FeedBehavior,
			&prefs.FeedEnabled, &esBytes, &dsBytes, &prefs.SubscriptionTier, &insertedAt,
		)
		if err != nil {
			return nil, err
		}
		enabledSites = esBytes
		disabledSites = dsBytes
		updatedAt = insertedAt
	}

	if err := json.Unmarshal(enabledSites, &prefs.EnabledSites); err != nil {
		prefs.EnabledSites = []string{}
	}
	if err := json.Unmarshal(disabledSites, &prefs.DisabledSites); err != nil {
		prefs.DisabledSites = []string{}
	}
	prefs.UpdatedAt = updatedAt.Format(time.RFC3339)

	// Sync subscription tier from JWT roles if provided
	if len(roles) > 0 && roles[0] != nil {
		expectedTier := tierFromRoles(roles[0])
		if prefs.SubscriptionTier != expectedTier {
			_, syncErr := DBPool.Exec(context.Background(),
				`UPDATE user_preferences SET subscription_tier = $1 WHERE logto_sub = $2`,
				expectedTier, logtoSub,
			)
			if syncErr != nil {
				log.Printf("[Preferences] Failed to sync tier for %s: %v", logtoSub, syncErr)
			} else {
				log.Printf("[Preferences] Synced tier for %s: %s → %s", logtoSub, prefs.SubscriptionTier, expectedTier)
				prefs.SubscriptionTier = expectedTier
			}
		}
	}

	return &prefs, nil
}

// HandleGetPreferences returns the current user's preferences.
func HandleGetPreferences(c *fiber.Ctx) error {
	userID := GetUserID(c)
	if userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(ErrorResponse{
			Status: "unauthorized",
			Error:  "Missing user identity",
		})
	}

	prefs, err := GetOrCreatePreferences(userID, GetUserRoles(c))
	if err != nil {
		log.Printf("[Preferences] Error fetching preferences for %s: %v", userID, err)
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Status: "error",
			Error:  "Failed to fetch preferences",
		})
	}

	return c.JSON(prefs)
}

// HandleUpdatePreferences performs a partial update of the user's preferences.
func HandleUpdatePreferences(c *fiber.Ctx) error {
	userID := GetUserID(c)
	if userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(ErrorResponse{
			Status: "unauthorized",
			Error:  "Missing user identity",
		})
	}

	var body map[string]interface{}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Status: "error",
			Error:  "Invalid JSON body",
		})
	}

	if v, ok := body["feed_mode"]; ok {
		s, isStr := v.(string)
		if !isStr || (s != "comfort" && s != "compact") {
			return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
				Status: "error",
				Error:  "feed_mode must be 'comfort' or 'compact'",
			})
		}
	}
	if v, ok := body["feed_position"]; ok {
		s, isStr := v.(string)
		if !isStr || (s != "top" && s != "bottom") {
			return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
				Status: "error",
				Error:  "feed_position must be 'top' or 'bottom'",
			})
		}
	}
	if v, ok := body["feed_behavior"]; ok {
		s, isStr := v.(string)
		if !isStr || (s != "overlay" && s != "push") {
			return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
				Status: "error",
				Error:  "feed_behavior must be 'overlay' or 'push'",
			})
		}
	}
	if v, ok := body["feed_enabled"]; ok {
		if _, isBool := v.(bool); !isBool {
			return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
				Status: "error",
				Error:  "feed_enabled must be a boolean",
			})
		}
	}
	if v, ok := body["enabled_sites"]; ok {
		if _, isArr := v.([]interface{}); !isArr {
			return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
				Status: "error",
				Error:  "enabled_sites must be a string array",
			})
		}
	}
	if v, ok := body["disabled_sites"]; ok {
		if _, isArr := v.([]interface{}); !isArr {
			return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
				Status: "error",
				Error:  "disabled_sites must be a string array",
			})
		}
	}

	query := `
		INSERT INTO user_preferences (logto_sub, feed_mode, feed_position, feed_behavior, feed_enabled, enabled_sites, disabled_sites, updated_at)
		VALUES ($1,
			COALESCE($2, 'comfort'),
			COALESCE($3, 'bottom'),
			COALESCE($4, 'overlay'),
			COALESCE($5, true),
			COALESCE($6, '[]'::jsonb),
			COALESCE($7, '[]'::jsonb),
			now()
		)
		ON CONFLICT (logto_sub) DO UPDATE SET
			feed_mode      = COALESCE($2, user_preferences.feed_mode),
			feed_position  = COALESCE($3, user_preferences.feed_position),
			feed_behavior  = COALESCE($4, user_preferences.feed_behavior),
			feed_enabled   = COALESCE($5, user_preferences.feed_enabled),
			enabled_sites  = COALESCE($6, user_preferences.enabled_sites),
			disabled_sites = COALESCE($7, user_preferences.disabled_sites),
			updated_at     = now()
		RETURNING logto_sub, feed_mode, feed_position, feed_behavior, feed_enabled,
		          enabled_sites, disabled_sites, updated_at
	`

	var feedMode, feedPosition, feedBehavior *string
	var feedEnabled *bool
	var enabledSitesJSON, disabledSitesJSON []byte

	if v, ok := body["feed_mode"].(string); ok {
		feedMode = &v
	}
	if v, ok := body["feed_position"].(string); ok {
		feedPosition = &v
	}
	if v, ok := body["feed_behavior"].(string); ok {
		feedBehavior = &v
	}
	if v, ok := body["feed_enabled"].(bool); ok {
		feedEnabled = &v
	}
	if v, ok := body["enabled_sites"]; ok {
		b, _ := json.Marshal(v)
		enabledSitesJSON = b
	}
	if v, ok := body["disabled_sites"]; ok {
		b, _ := json.Marshal(v)
		disabledSitesJSON = b
	}

	var prefs UserPreferences
	var esBytes, dsBytes []byte
	var updatedAt time.Time

	err := DBPool.QueryRow(context.Background(), query,
		userID, feedMode, feedPosition, feedBehavior, feedEnabled,
		enabledSitesJSON, disabledSitesJSON,
	).Scan(
		&prefs.LogtoSub, &prefs.FeedMode, &prefs.FeedPosition, &prefs.FeedBehavior,
		&prefs.FeedEnabled, &esBytes, &dsBytes, &updatedAt,
	)
	if err != nil {
		log.Printf("[Preferences] Error updating preferences for %s: %v", userID, err)
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Status: "error",
			Error:  "Failed to update preferences",
		})
	}

	if err := json.Unmarshal(esBytes, &prefs.EnabledSites); err != nil {
		prefs.EnabledSites = []string{}
	}
	if err := json.Unmarshal(dsBytes, &prefs.DisabledSites); err != nil {
		prefs.DisabledSites = []string{}
	}
	prefs.UpdatedAt = updatedAt.Format(time.RFC3339)

	// Invalidate dashboard cache so next poll gets fresh preferences
	InvalidateDashboardCache(userID)

	return c.JSON(prefs)
}
