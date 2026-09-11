package accounts

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
	"github.com/redis/go-redis/v9"
)

type PostHogConsent struct {
	Decision       string `json:"decision"`
	DeletionStatus string `json:"deletion_status,omitempty"`
}

var errPostHogDeletionPending = errors.New("PostHog deletion is pending")

var postHogLogtoUser = GetLogtoUser
var postHogCaptureDesktopEvent = capturePostHogEvent

func HandleVerifyRecentWebsiteSignup(c *fiber.Ctx) error {
	userID := platform.GetUserID(c)
	if userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(platform.ErrorResponse{Status: "unauthorized", Error: "Authentication required"})
	}
	user, err := postHogLogtoUser(userID)
	if err != nil || user == nil || os.Getenv("POSTHOG_DISTINCT_ID_SALT") == "" {
		return c.JSON(fiber.Map{"eligible": false, "verified": false})
	}
	staff, err := postHogStaff(context.Background(), userID, user.PrimaryEmail)
	if err != nil {
		return c.JSON(fiber.Map{"eligible": false, "verified": false})
	}
	if staff || postHogActorExcluded(userID) {
		return c.JSON(fiber.Map{"eligible": false, "verified": false})
	}
	return c.JSON(fiber.Map{
		"eligible":              true,
		"verified":              recentWebsiteSignup(*user, time.Now().UTC()),
		"analytics_distinct_id": postHogDistinctID(userID),
	})
}

func recentWebsiteSignup(user LogtoUser, now time.Time) bool {
	created := time.UnixMilli(user.CreatedAt)
	return user.ApplicationID == os.Getenv("LOGTO_WEB_APP_ID") &&
		!created.After(now) && now.Sub(created) <= 15*time.Minute
}

func postHogActorExcluded(userID string) bool {
	for _, excluded := range strings.Split(os.Getenv("POSTHOG_EXCLUDED_LOGTO_SUBS"), ",") {
		if strings.TrimSpace(excluded) == userID {
			return true
		}
	}
	return false
}

func postHogStaff(ctx context.Context, userID, email string) (bool, error) {
	var staff bool
	err := platform.DBPool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM admin_users
			WHERE logto_sub = $1 OR ($2 <> '' AND lower(email) = lower($2))
		)`, userID, email).Scan(&staff)
	return staff, err
}

func postHogDesktopStaff(ctx context.Context, userID, emailHint string) (bool, error) {
	staff, err := postHogStaff(ctx, userID, "")
	if err != nil || staff {
		return staff, err
	}
	if emailHint != "" {
		staff, err = postHogStaff(ctx, "", emailHint)
		if err != nil || !staff {
			return staff, err
		}
	}
	user, err := postHogLogtoUser(userID)
	if err != nil || user == nil {
		return false, err
	}
	return postHogStaff(ctx, userID, user.PrimaryEmail)
}

type postHogDesktopEvent struct {
	Event   string `json:"event"`
	Feature string `json:"feature,omitempty"`
}

func loadPostHogAnalyticsExport(ctx context.Context, userID string) (map[string]any, error) {
	result := map[string]any{}
	var decision, deletionStatus string
	err := platform.DBPool.QueryRow(ctx, `
		SELECT decision, deletion_status FROM posthog_analytics_consents WHERE logto_sub = $1`, userID).
		Scan(&decision, &deletionStatus)
	if errors.Is(err, pgx.ErrNoRows) {
		return map[string]any{"decision": "unknown", "events": []map[string]any{}}, nil
	}
	if err != nil {
		return nil, err
	}
	result["decision"] = decision
	result["deletion_status"] = deletionStatus
	rows, err := platform.DBPool.Query(ctx, `
		SELECT event, feature, app_version, occurred_at, delivered
		FROM posthog_analytics_events WHERE logto_sub = $1 ORDER BY occurred_at`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	events := []map[string]any{}
	for rows.Next() {
		var event string
		var feature, appVersion *string
		var occurredAt time.Time
		var delivered bool
		if err := rows.Scan(&event, &feature, &appVersion, &occurredAt, &delivered); err != nil {
			return nil, err
		}
		events = append(events, map[string]any{
			"event": event, "feature": feature, "app_version": appVersion,
			"occurred_at": occurredAt, "delivered": delivered,
		})
	}
	result["events"] = events
	return result, rows.Err()
}

var postHogFeatures = map[string]struct{}{
	"sports": {}, "markets": {}, "news": {}, "fantasy": {},
	"predictions": {}, "utilities": {},
}

func decodePostHogDesktopEvent(body []byte) (postHogDesktopEvent, error) {
	var event postHogDesktopEvent
	if err := decodeStrict(body, &event); err != nil {
		return event, err
	}
	switch event.Event {
	case "desktop_app_opened", "desktop_app_running", "desktop_presence":
		if event.Feature != "" {
			return event, errors.New("feature is only valid for desktop_feature_configured")
		}
	case "desktop_feature_configured":
		if _, ok := postHogFeatures[event.Feature]; !ok {
			return event, errors.New("unknown feature")
		}
	default:
		return event, errors.New("unknown event")
	}
	return event, nil
}

func HandleGetPostHogConsent(c *fiber.Ctx) error {
	userID := platform.GetUserID(c)
	if userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(platform.ErrorResponse{Status: "unauthorized", Error: "Authentication required"})
	}
	var result PostHogConsent
	err := platform.DBPool.QueryRow(context.Background(), `
		SELECT decision, deletion_status FROM posthog_analytics_consents WHERE logto_sub = $1`, userID).
		Scan(&result.Decision, &result.DeletionStatus)
	if errors.Is(err, pgx.ErrNoRows) {
		email, _ := c.Locals("user_email").(string)
		staff, staffErr := postHogDesktopStaff(context.Background(), userID, email)
		if staffErr != nil {
			log.Printf("[PostHog Analytics] verify default setting: %v", staffErr)
			return c.Status(fiber.StatusInternalServerError).JSON(platform.ErrorResponse{Status: "error", Error: "Could not read analytics setting"})
		}
		if staff || postHogActorExcluded(userID) {
			return c.JSON(PostHogConsent{Decision: "declined"})
		}
		if _, err := setPostHogConsent(context.Background(), userID, "enabled"); err != nil {
			log.Printf("[PostHog Analytics] apply default setting: %v", err)
			return c.Status(fiber.StatusInternalServerError).JSON(platform.ErrorResponse{Status: "error", Error: "Could not read analytics setting"})
		}
		return c.JSON(PostHogConsent{Decision: "enabled", DeletionStatus: "not_requested"})
	}
	if err != nil {
		log.Printf("[PostHog Analytics] read consent: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(platform.ErrorResponse{Status: "error", Error: "Could not read analytics setting"})
	}
	return c.JSON(result)
}

func HandleSetPostHogConsent(c *fiber.Ctx) error {
	userID := platform.GetUserID(c)
	if userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(platform.ErrorResponse{Status: "unauthorized", Error: "Authentication required"})
	}
	var req struct {
		Decision string `json:"decision"`
	}
	if err := decodeStrict(c.Body(), &req); err != nil || (req.Decision != "enabled" && req.Decision != "declined") {
		return c.Status(fiber.StatusBadRequest).JSON(platform.ErrorResponse{Status: "error", Error: "Body must contain only a decision of enabled or declined"})
	}
	deletionStatus, err := setPostHogConsent(context.Background(), userID, req.Decision)
	if errors.Is(err, errAccountDeleting) {
		return c.Status(fiber.StatusConflict).JSON(platform.ErrorResponse{Status: "error", Error: "Analytics cannot be enabled while account deletion is pending or complete"})
	}
	if errors.Is(err, errPostHogDeletionPending) {
		return c.Status(fiber.StatusConflict).JSON(platform.ErrorResponse{Status: "error", Error: "Analytics cannot be re-enabled until the prior deletion request completes"})
	}
	if err != nil {
		log.Printf("[PostHog Analytics] update consent: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(platform.ErrorResponse{Status: "error", Error: "Could not update analytics setting"})
	}
	if deletionStatus == "pending" && postHogDeletionConfigured() {
		go requestPostHogDeletion(userID)
	}
	if req.Decision == "declined" {
		removeRecentPresence(userID)
	}
	return HandleGetPostHogConsent(c)
}

func setPostHogConsent(ctx context.Context, userID, decision string) (string, error) {
	deletionStatus := "not_requested"
	if decision == "declined" {
		deletionStatus = "pending"
	}
	tx, err := platform.DBPool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)
	if err := lockAccountMutation(ctx, tx, userID); err != nil {
		return "", err
	}
	if decision == "enabled" {
		var priorDeletion string
		err := tx.QueryRow(ctx, `SELECT deletion_status FROM posthog_analytics_consents WHERE logto_sub = $1`, userID).Scan(&priorDeletion)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return "", err
		}
		if err == nil && priorDeletion == "pending" {
			return "", errPostHogDeletionPending
		}
		var status string
		err = tx.QueryRow(ctx, `SELECT status FROM user_deletion_requests WHERE logto_sub = $1`, userID).Scan(&status)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return "", err
		}
		if err == nil && status != "canceled" {
			return "", errAccountDeleting
		}
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO posthog_analytics_consents (logto_sub, decision, deletion_status)
		VALUES ($1, $2, $3)
		ON CONFLICT (logto_sub) DO UPDATE
		SET decision = EXCLUDED.decision,
		    deletion_status = EXCLUDED.deletion_status,
		    decided_at = NOW(), updated_at = NOW()`, userID, decision, deletionStatus)
	if err != nil {
		return "", err
	}
	if err := tx.Commit(ctx); err != nil {
		return "", err
	}
	return deletionStatus, nil
}

func HandlePostHogDesktopEvent(c *fiber.Ctx) error {
	userID := platform.GetUserID(c)
	if userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(platform.ErrorResponse{Status: "unauthorized", Error: "Authentication required"})
	}
	event, err := decodePostHogDesktopEvent(c.Body())
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(platform.ErrorResponse{Status: "error", Error: "Unknown analytics event or property"})
	}
	if !postHogCaptureConfigured() {
		return c.SendStatus(fiber.StatusNoContent)
	}
	ctx := context.Background()
	email, _ := c.Locals("user_email").(string)
	staff, err := postHogDesktopStaff(ctx, userID, email)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(platform.ErrorResponse{Status: "error", Error: "Could not verify analytics setting"})
	}
	if staff || postHogActorExcluded(userID) {
		removeRecentPresence(userID)
		return c.SendStatus(fiber.StatusNoContent)
	}
	tx, err := platform.DBPool.Begin(ctx)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(platform.ErrorResponse{Status: "error", Error: "Could not verify analytics setting"})
	}
	defer tx.Rollback(ctx)
	if err := lockAccountMutation(ctx, tx, userID); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(platform.ErrorResponse{Status: "error", Error: "Could not verify analytics setting"})
	}
	var enabled bool
	if err := tx.QueryRow(ctx, `
		SELECT decision = 'enabled' FROM posthog_analytics_consents WHERE logto_sub = $1`, userID).Scan(&enabled); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return c.SendStatus(fiber.StatusNoContent)
		}
		return c.Status(fiber.StatusInternalServerError).JSON(platform.ErrorResponse{Status: "error", Error: "Could not verify analytics setting"})
	}
	if !enabled {
		return c.SendStatus(fiber.StatusNoContent)
	}
	recordRecentPresence(userID)
	if event.Event == "desktop_presence" {
		return c.SendStatus(fiber.StatusNoContent)
	}
	_ = postHogCaptureDesktopEvent(userID, event)
	return c.SendStatus(fiber.StatusAccepted)
}

func recordRecentPresence(userID string) {
	if platform.Rdb == nil {
		return
	}
	now := time.Now().UTC()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	pipe := platform.Rdb.Pipeline()
	pipe.ZAdd(ctx, "posthog:recent-presence", redis.Z{
		Score: float64(now.Unix()), Member: postHogPresenceID(userID),
	})
	pipe.ZRemRangeByScore(ctx, "posthog:recent-presence", "-inf", fmt.Sprint(now.Add(-15*time.Minute).Unix()))
	pipe.Expire(ctx, "posthog:recent-presence", 30*time.Minute)
	_, _ = pipe.Exec(ctx)
}

func removeRecentPresence(userID string) {
	if platform.Rdb == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	_ = platform.Rdb.ZRem(ctx, "posthog:recent-presence", postHogPresenceID(userID)).Err()
}

func postHogPresenceID(userID string) string {
	digest := sha256.Sum256([]byte(userID))
	return hex.EncodeToString(digest[:])
}

func postHogDistinctID(userID string) string {
	mac := hmac.New(sha256.New, []byte(os.Getenv("POSTHOG_DISTINCT_ID_SALT")))
	_, _ = mac.Write([]byte(userID))
	return hex.EncodeToString(mac.Sum(nil))
}

func postHogCaptureConfigured() bool {
	return os.Getenv("POSTHOG_CAPTURE_ENABLED") == "true" && os.Getenv("POSTHOG_PROJECT_KEY") != "" &&
		os.Getenv("POSTHOG_PROJECT_ID") != "" && os.Getenv("POSTHOG_PERSONAL_API_KEY") != "" && os.Getenv("POSTHOG_DISTINCT_ID_SALT") != "" &&
		strings.HasPrefix(os.Getenv("POSTHOG_HOST"), "https://") && strings.HasPrefix(os.Getenv("POSTHOG_API_HOST"), "https://")
}

func postHogDeletionConfigured() bool {
	return os.Getenv("POSTHOG_PROJECT_ID") != "" && os.Getenv("POSTHOG_PERSONAL_API_KEY") != "" &&
		os.Getenv("POSTHOG_DISTINCT_ID_SALT") != "" && strings.HasPrefix(os.Getenv("POSTHOG_API_HOST"), "https://")
}

func capturePostHogEvent(userID string, event postHogDesktopEvent) error {
	now := time.Now().UTC()
	dedup := postHogDistinctID(userID + "\x00" + event.Event + "\x00" + event.Feature + "\x00" + now.Format("2006-01-02"))
	properties := map[string]any{
		"distinct_id": postHogDistinctID(userID),
		"$ip":         nil,
		"$insert_id":  dedup,
		"surface":     "desktop",
	}
	if version := os.Getenv("APP_VERSION"); version != "" {
		properties["app_version"] = version
	}
	if event.Feature != "" {
		properties["feature"] = event.Feature
	}
	payload := map[string]any{
		"api_key":    os.Getenv("POSTHOG_PROJECT_KEY"),
		"event":      event.Event,
		"properties": properties,
		"timestamp":  now.Format(time.RFC3339),
	}
	if platform.DBPool != nil {
		_, err := platform.DBPool.Exec(context.Background(), `
			INSERT INTO posthog_analytics_events
				(insert_id, logto_sub, event, feature, app_version, occurred_at)
			VALUES ($1, $2, $3, NULLIF($4, ''), NULLIF($5, ''), $6)
			ON CONFLICT (insert_id) DO NOTHING`, dedup, userID, event.Event, event.Feature, os.Getenv("APP_VERSION"), now)
		if err != nil {
			return fmt.Errorf("record export mirror: %w", err)
		}
	}
	if err := postHogRequest(os.Getenv("POSTHOG_HOST"), http.MethodPost, "/i/v0/e/", "", payload); err != nil {
		return err
	}
	if platform.DBPool != nil {
		_, _ = platform.DBPool.Exec(context.Background(), `
			UPDATE posthog_analytics_events SET delivered = TRUE WHERE insert_id = $1`, dedup)
	}
	return nil
}

func requestPostHogDeletion(userID string) {
	payload := map[string]any{
		"distinct_ids":      []string{postHogDistinctID(userID)},
		"delete_events":     true,
		"delete_recordings": true,
	}
	err := postHogRequest(os.Getenv("POSTHOG_API_HOST"), http.MethodPost, "/api/projects/"+os.Getenv("POSTHOG_PROJECT_ID")+"/persons/bulk_delete/", os.Getenv("POSTHOG_PERSONAL_API_KEY"), payload)
	status := "requested"
	if err != nil {
		status = "pending"
		log.Printf("[PostHog Analytics] request deletion: %v", err)
	}
	if platform.DBPool != nil {
		if status == "requested" {
			_, _ = platform.DBPool.Exec(context.Background(), `DELETE FROM posthog_analytics_events WHERE logto_sub = $1`, userID)
		}
		_, _ = platform.DBPool.Exec(context.Background(), `
			UPDATE posthog_analytics_consents SET deletion_status = $2, updated_at = NOW()
			WHERE logto_sub = $1 AND decision = 'declined'`, userID, status)
		if status == "requested" {
			_, _ = platform.DBPool.Exec(context.Background(), `
				DELETE FROM posthog_analytics_consents c
				WHERE c.logto_sub = $1
				  AND EXISTS (
					SELECT 1 FROM user_deletion_requests d
					WHERE d.logto_sub = c.logto_sub AND d.status = 'purged'
				  )`, userID)
		}
	}
}

func postHogRequest(host, method, path, bearer string, payload any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	req, err := http.NewRequest(method, strings.TrimRight(host, "/")+path, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("PostHog returned status %d", resp.StatusCode)
	}
	return nil
}
