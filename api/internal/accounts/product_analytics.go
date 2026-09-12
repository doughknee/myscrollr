package accounts

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
)

var (
	productAnalyticsNow = time.Now
	errNotEnrolled      = errors.New("product analytics disabled")
	errAccountDeleting  = errors.New("account deletion is pending or complete")
)

type ProductAnalyticsConsent struct {
	Enabled    bool   `json:"enabled"`
	EnrolledAt string `json:"enrolled_at,omitempty"`
}

var productCategories = map[string]struct{}{
	"sports": {}, "markets": {}, "news": {}, "fantasy": {},
	"predictions": {}, "utilities": {},
}

func decodeStrict(body []byte, dst any) error {
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(dst); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return errors.New("request body must contain one JSON value")
	}
	return nil
}

func HandleGetProductAnalyticsConsent(c *fiber.Ctx) error {
	userID := platform.GetUserID(c)
	if userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(platform.ErrorResponse{Status: "unauthorized", Error: "Authentication required"})
	}

	var enrolledAt time.Time
	err := platform.DBPool.QueryRow(context.Background(),
		`SELECT enrolled_at FROM product_analytics_enrollments WHERE logto_sub = $1`, userID).
		Scan(&enrolledAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return c.JSON(ProductAnalyticsConsent{})
	}
	if err != nil {
		log.Printf("[Product Analytics] read consent: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(platform.ErrorResponse{Status: "error", Error: "Could not read product analytics setting"})
	}
	return c.JSON(ProductAnalyticsConsent{Enabled: true, EnrolledAt: enrolledAt.UTC().Format(time.RFC3339)})
}

func HandleSetProductAnalyticsConsent(c *fiber.Ctx) error {
	userID := platform.GetUserID(c)
	if userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(platform.ErrorResponse{Status: "unauthorized", Error: "Authentication required"})
	}
	var req struct {
		Enabled *bool `json:"enabled"`
	}
	if err := decodeStrict(c.Body(), &req); err != nil || req.Enabled == nil {
		return c.Status(fiber.StatusBadRequest).JSON(platform.ErrorResponse{Status: "error", Error: "Body must contain only an enabled boolean"})
	}
	if err := setProductAnalyticsConsent(context.Background(), userID, *req.Enabled); err != nil {
		if errors.Is(err, errPostHogDeletionPending) {
			return c.Status(fiber.StatusConflict).JSON(platform.ErrorResponse{Status: "error", Error: "Analytics deletion is still pending"})
		}
		if errors.Is(err, errAccountDeleting) {
			return c.Status(fiber.StatusConflict).JSON(platform.ErrorResponse{Status: "error", Error: "Product analytics cannot be enabled while account deletion is pending or complete"})
		}
		log.Printf("[Product Analytics] update consent: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(platform.ErrorResponse{Status: "error", Error: "Could not update product analytics setting"})
	}
	return HandleGetProductAnalyticsConsent(c)
}

func setProductAnalyticsConsent(ctx context.Context, userID string, enabled bool) error {
	decision := "declined"
	if enabled {
		decision = "enabled"
	}
	_, err := setPostHogConsent(ctx, userID, decision)
	return err
}

// syncProductAnalyticsEnrollment mirrors the consent decision into the
// first-party enrollment row.
//
// Staff are enrolled under exactly the same consent as everyone else, flagged
// `internal = true` (SCROLLR-210). Every reader that reports audience or usage
// hides internal rows while the dashboard's "Exclude staff" setting is on,
// and shows them when it is off. Before this, staff were never enrolled at
// all, so their facts were never written and no setting could ever bring
// them back.
//
// Configured test accounts (POSTHOG_EXCLUDED_LOGTO_SUBS) are different: they
// are synthetic traffic, excluded regardless of the setting, so they are
// never enrolled and never write a first-party fact.
func syncProductAnalyticsEnrollment(ctx context.Context, tx pgx.Tx, userID string, enabled bool) error {
	if enabled && !postHogActorExcluded(userID) {
		var staff, unclaimedAdmin bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM admin_users WHERE logto_sub=$1), EXISTS(SELECT 1 FROM admin_users WHERE logto_sub IS NULL)`, userID).Scan(&staff, &unclaimedAdmin); err != nil {
			return err
		}
		// Normally staff are already linked by admin login. Verify an unclaimed
		// admin email too, without trusting a client-supplied email hint.
		if !staff && unclaimedAdmin {
			user, err := postHogLogtoUser(userID)
			if err != nil {
				return err
			}
			if user == nil {
				return errors.New("could not verify analytics eligibility")
			}
			if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM admin_users WHERE lower(email)=lower($1))`, user.PrimaryEmail).Scan(&staff); err != nil {
				return err
			}
		}
		_, err := tx.Exec(ctx, `
			INSERT INTO product_analytics_enrollments (logto_sub, internal) VALUES ($1, $2)
			ON CONFLICT (logto_sub) DO UPDATE SET internal = EXCLUDED.internal`, userID, staff)
		return err
	} else {
		// The daily table cascades. A concurrent reporter holds a row lock on
		// this row, so this delete either removes its committed fact or wins first
		// and prevents the report from observing enrollment.
		if _, err := tx.Exec(ctx,
			`DELETE FROM product_analytics_enrollments WHERE logto_sub = $1`, userID); err != nil {
			return err
		}
	}
	return nil
}

func lockAccountMutation(ctx context.Context, tx pgx.Tx, userID string) error {
	_, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, userID)
	return err
}

func HandleRecordProductActivity(c *fiber.Ctx) error {
	userID := platform.GetUserID(c)
	if userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(platform.ErrorResponse{Status: "unauthorized", Error: "Authentication required"})
	}
	var req struct {
		Categories []string `json:"categories"`
	}
	if err := decodeStrict(c.Body(), &req); err != nil || len(req.Categories) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(platform.ErrorResponse{Status: "error", Error: "Body must contain only a non-empty categories array"})
	}
	seen := make(map[string]struct{}, len(req.Categories))
	for _, category := range req.Categories {
		if _, ok := productCategories[category]; !ok {
			return c.Status(fiber.StatusBadRequest).JSON(platform.ErrorResponse{Status: "error", Error: "Unknown product activity category"})
		}
		if _, duplicate := seen[category]; duplicate {
			return c.Status(fiber.StatusBadRequest).JSON(platform.ErrorResponse{Status: "error", Error: "Duplicate product activity category"})
		}
		seen[category] = struct{}{}
	}
	if err := recordProductActivity(context.Background(), userID, req.Categories, productAnalyticsNow()); err != nil && !errors.Is(err, errNotEnrolled) {
		log.Printf("[Product Analytics] record daily activity: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(platform.ErrorResponse{Status: "error", Error: "Could not record product activity"})
	}
	return c.JSON(fiber.Map{"recorded": true})
}

func recordProductActivity(ctx context.Context, userID string, categories []string, now time.Time) error {
	tx, err := platform.DBPool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var first *time.Time
	if err := tx.QueryRow(ctx, `
		SELECT first_active_day FROM product_analytics_enrollments
		 WHERE logto_sub = $1 FOR UPDATE`, userID).Scan(&first); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return errNotEnrolled
		}
		return err
	}

	flags := map[string]bool{}
	for _, category := range categories {
		flags[category] = true
	}
	day := now.UTC().Truncate(24 * time.Hour)
	if _, err := tx.Exec(ctx, `
		INSERT INTO product_activity_daily
			(logto_sub, day, sports, markets, news, fantasy, predictions, utilities)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		ON CONFLICT (logto_sub, day) DO UPDATE SET
			sports = product_activity_daily.sports OR EXCLUDED.sports,
			markets = product_activity_daily.markets OR EXCLUDED.markets,
			news = product_activity_daily.news OR EXCLUDED.news,
			fantasy = product_activity_daily.fantasy OR EXCLUDED.fantasy,
			predictions = product_activity_daily.predictions OR EXCLUDED.predictions,
			utilities = product_activity_daily.utilities OR EXCLUDED.utilities`,
		userID, day, flags["sports"], flags["markets"], flags["news"],
		flags["fantasy"], flags["predictions"], flags["utilities"]); err != nil {
		return err
	}

	if first == nil {
		_, err = tx.Exec(ctx, `
			UPDATE product_analytics_enrollments SET first_active_day = $2
			 WHERE logto_sub = $1`, userID, day)
	} else {
		delta := int(day.Sub(first.UTC().Truncate(24*time.Hour)).Hours() / 24)
		column := ""
		switch delta {
		case 1:
			column = "retained_d1"
		case 7:
			column = "retained_d7"
		case 30:
			column = "retained_d30"
		}
		if column != "" {
			_, err = tx.Exec(ctx, "UPDATE product_analytics_enrollments SET "+column+" = true WHERE logto_sub = $1", userID)
		}
	}
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}
