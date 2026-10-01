package widgets

import (
	"context"
	"encoding/json"
	"log"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/gofiber/fiber/v2"
)

// starterWidgets is a new account's first bar (SCROLLR-283): a news page and a
// markets page. Each is created with its catalog DefaultConfig (Stocks gets
// its starter watchlist, SCROLLR-259). The clock is the third piece of the
// first bar, but it is a local utility widget living in client preferences,
// so the client turns it on after this call succeeds.
var starterWidgets = []string{"news_npr", "finance_stocks"}

// ApplyStarterWidgets is POST /users/me/widgets/starter: the once-per-account
// first-run set, applied in ONE transaction.
//
// Why one server call instead of N client POSTs: the flag flip and every
// insert commit together or not at all, so a failure can never leave a half
// starter (NPR without Stocks) or a spent flag with nothing created. The
// transaction's row lock on the preferences flag also serialises concurrent
// callers (two ticker windows, two devices): exactly one claims the flag.
//
// Slot gate: deliberately skipped. The account has no widgets (checked inside
// the transaction) and the smallest plan holds 3, so a 2-widget set always
// fits.
//
// 200 {"applied":true,"widgets":[...]} when it created the set,
// 200 {"applied":false,"widgets":[]}   when there was nothing to do (flag
// already set, or the account already has widgets).
func ApplyStarterWidgets(c *fiber.Ctx) error {
	userID := platform.GetUserID(c)
	if userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(platform.ErrorResponse{
			Status: "unauthorized",
			Error:  "Authentication required",
		})
	}

	ctx := context.Background()
	created, err := applyStarter(ctx, userID, starterWidgets)
	if err != nil {
		log.Printf("[Widgets] starter set failed for %s: %v", userID, err)
		return c.Status(fiber.StatusInternalServerError).JSON(platform.ErrorResponse{
			Status: "error",
			Error:  "Failed to apply starter widgets",
		})
	}

	// Side effects only after the commit: a rolled-back set must not
	// resubscribe, fire lifecycles or record analytics for rows that do not exist.
	for _, w := range created {
		afterWidgetCreated(ctx, userID, w)
	}
	if created == nil {
		created = []platform.Widget{}
	}
	return c.JSON(fiber.Map{"applied": len(created) > 0, "widgets": created})
}

// applyStarter claims the account's default_widgets_applied flag and, if the
// account has no widgets, inserts types, all in one transaction. It returns
// nil (committing just the flag) when the account already has widgets, and nil
// without touching anything when the flag was already set.
func applyStarter(ctx context.Context, userID string, types []string) ([]platform.Widget, error) {
	tx, err := platform.DBPool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck // no-op after Commit

	// Claim: the upsert returns a row only when it flipped false->true (or
	// created the row). A concurrent claimer blocks on the row lock, then sees
	// true and gets no row.
	var claimed bool
	err = tx.QueryRow(ctx, `
		WITH c AS (
			INSERT INTO user_preferences (logto_sub, default_widgets_applied)
			VALUES ($1, true)
			ON CONFLICT (logto_sub) DO UPDATE SET default_widgets_applied = true, updated_at = now()
			WHERE user_preferences.default_widgets_applied = false
			RETURNING 1)
		SELECT EXISTS (SELECT 1 FROM c)`, userID).Scan(&claimed)
	if err != nil || !claimed {
		return nil, err
	}

	// Any row, enabled or not: an account that has ever had a widget is not fresh.
	var hasWidgets bool
	if err := tx.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM user_widgets WHERE logto_sub = $1)`, userID,
	).Scan(&hasWidgets); err != nil {
		return nil, err
	}

	var created []platform.Widget
	if !hasWidgets {
		for _, wt := range types {
			cfgJSON, _ := json.Marshal(configOrDefault(wt, nil))
			var w platform.Widget
			var cfgBytes []byte
			if err := tx.QueryRow(ctx, `
				INSERT INTO user_widgets (logto_sub, widget_type, config)
				VALUES ($1, $2, $3)
				RETURNING id, logto_sub, widget_type, enabled, ticker_enabled, config, created_at, updated_at`,
				userID, wt, cfgJSON,
			).Scan(&w.ID, &w.LogtoSub, &w.WidgetType, &w.Enabled, &w.TickerEnabled,
				&cfgBytes, &w.CreatedAt, &w.UpdatedAt); err != nil {
				return nil, err
			}
			if err := json.Unmarshal(cfgBytes, &w.Config); err != nil {
				w.Config = map[string]interface{}{}
			}
			created = append(created, w)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return created, nil
}
