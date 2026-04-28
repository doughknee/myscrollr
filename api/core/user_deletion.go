package core

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// ─── Constants ──────────────────────────────────────────────────────

// GDPRGraceWindow is the "undo period" between a user requesting account
// deletion and the purge actually running. 30 days matches industry
// convention and gives users time to change their mind without enabling
// indefinite soft-delete storage.
const GDPRGraceWindow = 30 * 24 * time.Hour

// GDPRMinGraceForPurge is a floor guard the purge worker uses so a
// misconfigured `purge_at` (e.g. a manual SQL update that set it in the
// past) cannot accidentally trigger an immediate mass-purge. Requests
// must be at least this old before they are eligible for purge, regardless
// of what `purge_at` says.
const GDPRMinGraceForPurge = 24 * time.Hour

// GDPRPurgeInterval is how often the background worker scans for
// expired deletion requests.
const GDPRPurgeInterval = time.Hour

// gdprConfirmPhrase is the exact string a user must type to confirm an
// account deletion request. Mirrored on the client side.
const gdprConfirmPhrase = "DELETE MY ACCOUNT"

// ─── Data export ────────────────────────────────────────────────────

// HandleExportUserData serves a JSON archive of everything we store about
// the authenticated user. Returned as an attachment so browsers download
// rather than display it inline. Security-sensitive fields (Yahoo OAuth
// refresh tokens, Stripe IDs that are server-internal) are intentionally
// omitted.
func HandleExportUserData(c *fiber.Ctx) error {
	userID := GetUserID(c)
	if userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(ErrorResponse{
			Status: "unauthorized",
			Error:  "Authentication required",
		})
	}

	ctx := context.Background()
	archive := map[string]any{
		"exported_at": time.Now().UTC().Format(time.RFC3339),
		"user": map[string]any{
			"logto_sub": userID,
			"email":     c.Locals("user_email"),
			"roles":     GetUserRoles(c),
		},
		"notes": "Yahoo OAuth tokens are omitted from this export for security.",
	}

	// preferences
	if prefs, err := GetOrCreatePreferences(userID); err == nil {
		archive["preferences"] = prefs
	} else {
		log.Printf("[Export] preferences for %s: %v", userID, err)
	}

	// channels
	if chans, err := GetUserChannels(userID); err == nil {
		archive["channels"] = chans
	} else {
		log.Printf("[Export] channels for %s: %v", userID, err)
		archive["channels"] = []any{}
	}

	// subscription (stripe_customers minus server-internal IDs)
	subscription := map[string]any{}
	var plan, status string
	var currentPeriodEnd *time.Time
	var lifetime bool
	err := DBPool.QueryRow(ctx,
		`SELECT plan, status, current_period_end, lifetime
		   FROM stripe_customers WHERE logto_sub = $1`,
		userID,
	).Scan(&plan, &status, &currentPeriodEnd, &lifetime)
	if err == nil {
		subscription["plan"] = plan
		subscription["status"] = status
		if currentPeriodEnd != nil {
			subscription["current_period_end"] = currentPeriodEnd
		}
		subscription["lifetime"] = lifetime
	} else if err != pgx.ErrNoRows {
		log.Printf("[Export] subscription for %s: %v", userID, err)
	}
	archive["subscription"] = subscription

	// fantasy leagues (key + name + season; no tokens)
	fantasyRows, err := DBPool.Query(ctx, `
		SELECT yul.league_key, COALESCE(yl.name, '') AS name, COALESCE(yl.season, '') AS season
		FROM yahoo_user_leagues yul
		LEFT JOIN yahoo_users yu ON yu.guid = yul.guid
		LEFT JOIN yahoo_leagues yl ON yl.league_key = yul.league_key
		WHERE yu.logto_sub = $1
	`, userID)
	leagues := make([]map[string]any, 0)
	if err == nil {
		defer fantasyRows.Close()
		for fantasyRows.Next() {
			var key, name, season string
			if err := fantasyRows.Scan(&key, &name, &season); err == nil {
				leagues = append(leagues, map[string]any{
					"league_key": key,
					"name":       name,
					"season":     season,
				})
			}
		}
	} else {
		log.Printf("[Export] fantasy leagues for %s: %v", userID, err)
	}
	archive["fantasy_leagues"] = leagues

	// deletion status, if any
	if status, _ := getUserDeletionStatus(ctx, userID); status != nil {
		archive["account_deletion"] = status
	}

	filename := fmt.Sprintf("myscrollr-export-%s.json", time.Now().UTC().Format("2006-01-02"))
	c.Set("Content-Type", "application/json")
	c.Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filename))

	return c.JSON(archive)
}

// ─── Soft-delete request lifecycle ──────────────────────────────────

// HandleRequestAccountDeletion schedules an account for permanent purge
// after the 30-day grace window. Refuses if the user has a live
// (non-lifetime) subscription — the UI should tell them to cancel first.
func HandleRequestAccountDeletion(c *fiber.Ctx) error {
	userID := GetUserID(c)
	if userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(ErrorResponse{
			Status: "unauthorized",
			Error:  "Authentication required",
		})
	}

	var req struct {
		Confirm string `json:"confirm"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Status: "error",
			Error:  "Invalid request body",
		})
	}
	if req.Confirm != gdprConfirmPhrase {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Status: "error",
			Error:  fmt.Sprintf("Confirmation must be exactly %q", gdprConfirmPhrase),
		})
	}

	ctx := context.Background()

	// Subscription guard: live subs block deletion. Lifetime is fine —
	// we anonymize their Stripe row at purge time and keep it for tax.
	var stripeStatus string
	var lifetime bool
	_ = DBPool.QueryRow(ctx,
		`SELECT status, lifetime FROM stripe_customers WHERE logto_sub = $1`,
		userID,
	).Scan(&stripeStatus, &lifetime)
	if !lifetime {
		switch stripeStatus {
		case "active", "trialing", "canceling", "past_due":
			return c.Status(fiber.StatusConflict).JSON(ErrorResponse{
				Status: "error",
				Error:  "Cancel your subscription before deleting your account.",
			})
		}
	}

	now := time.Now().UTC()
	purgeAt := now.Add(GDPRGraceWindow)

	// Idempotent upsert: a second request while pending returns the
	// existing schedule. Resetting a canceled/purged row restarts the
	// countdown (the user changed their mind; acceptable).
	_, err := DBPool.Exec(ctx, `
		INSERT INTO user_deletion_requests (logto_sub, requested_at, purge_at, status)
		VALUES ($1, $2, $3, 'pending')
		ON CONFLICT (logto_sub) DO UPDATE SET
			requested_at = EXCLUDED.requested_at,
			purge_at     = EXCLUDED.purge_at,
			status       = 'pending',
			canceled_at  = NULL,
			purged_at    = NULL
	`, userID, now, purgeAt)
	if err != nil {
		log.Printf("[GDPR] upsert deletion request for %s: %v", userID, err)
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Status: "error",
			Error:  "Failed to schedule deletion",
		})
	}

	log.Printf("[GDPR] Account deletion scheduled: user=%s purge_at=%s", userID, purgeAt.Format(time.RFC3339))

	// Overview's gdpr block flipped from "none" to "pending".
	InvalidateOverviewCache(ctx, userID)

	return c.JSON(fiber.Map{
		"status":       "pending",
		"requested_at": now,
		"purge_at":     purgeAt,
	})
}

// HandleCancelAccountDeletion cancels a pending purge. Returns 404 if no
// pending row exists (idempotent: calling cancel when already canceled
// returns 404 so the UI stays in sync with reality).
func HandleCancelAccountDeletion(c *fiber.Ctx) error {
	userID := GetUserID(c)
	if userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(ErrorResponse{
			Status: "unauthorized",
			Error:  "Authentication required",
		})
	}

	now := time.Now().UTC()
	tag, err := DBPool.Exec(context.Background(), `
		UPDATE user_deletion_requests
		   SET status = 'canceled', canceled_at = $2
		 WHERE logto_sub = $1 AND status = 'pending'
	`, userID, now)
	if err != nil {
		log.Printf("[GDPR] cancel deletion for %s: %v", userID, err)
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Status: "error",
			Error:  "Failed to cancel deletion",
		})
	}
	if tag.RowsAffected() == 0 {
		return c.Status(fiber.StatusNotFound).JSON(ErrorResponse{
			Status: "error",
			Error:  "No pending deletion request to cancel",
		})
	}

	log.Printf("[GDPR] Account deletion canceled: user=%s", userID)

	// Overview's gdpr block flipped back from "pending" to "canceled".
	InvalidateOverviewCache(context.Background(), userID)

	return c.JSON(fiber.Map{
		"status":      "canceled",
		"canceled_at": now,
	})
}

// HandleAccountDeletionStatus returns the current deletion request
// state for the authenticated user, used by the UI to render a
// pending-deletion banner + countdown.
func HandleAccountDeletionStatus(c *fiber.Ctx) error {
	userID := GetUserID(c)
	if userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(ErrorResponse{
			Status: "unauthorized",
			Error:  "Authentication required",
		})
	}
	status, err := getUserDeletionStatus(context.Background(), userID)
	if err != nil {
		log.Printf("[GDPR] status lookup for %s: %v", userID, err)
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Status: "error",
			Error:  "Failed to read deletion status",
		})
	}
	if status == nil {
		return c.JSON(fiber.Map{"status": "none"})
	}
	return c.JSON(status)
}

// getUserDeletionStatus reads the latest deletion-request row for a
// user and returns a shape suitable for both the status endpoint and
// the export archive. Returns nil if no row exists.
func getUserDeletionStatus(ctx context.Context, logtoSub string) (map[string]any, error) {
	var status string
	var requestedAt, purgeAt time.Time
	var canceledAt, purgedAt *time.Time
	err := DBPool.QueryRow(ctx, `
		SELECT status, requested_at, purge_at, canceled_at, purged_at
		  FROM user_deletion_requests WHERE logto_sub = $1
	`, logtoSub).Scan(&status, &requestedAt, &purgeAt, &canceledAt, &purgedAt)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	out := map[string]any{
		"status":       status,
		"requested_at": requestedAt,
		"purge_at":     purgeAt,
	}
	if canceledAt != nil {
		out["canceled_at"] = canceledAt
	}
	if purgedAt != nil {
		out["purged_at"] = purgedAt
	}
	return out, nil
}

// ─── Background purge worker ────────────────────────────────────────

// StartGDPRPurgeWorker kicks off a background goroutine that scans
// `user_deletion_requests` for pending rows whose `purge_at` has
// elapsed and cascades the permanent delete. Called once from the
// server init.
func StartGDPRPurgeWorker(ctx context.Context) {
	// Run once on startup so pods that stayed offline past a
	// purge_at don't leave the request pending until the next tick.
	go func() {
		// Brief delay so the rest of the server finishes initializing
		// (JWKS, channel registry) before we start hitting Logto M2M.
		time.Sleep(10 * time.Second)
		runGDPRPurgePass(ctx)

		ticker := time.NewTicker(GDPRPurgeInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				runGDPRPurgePass(ctx)
			}
		}
	}()
}

// runGDPRPurgePass scans for and purges every eligible request.
// Eligibility: `status='pending' AND purge_at <= now() AND
// requested_at <= now() - 24h`. The requested_at floor is a defensive
// guard against a misconfigured purge_at (manual SQL edit, code bug)
// triggering an immediate mass-purge.
func runGDPRPurgePass(ctx context.Context) {
	now := time.Now().UTC()
	floor := now.Add(-GDPRMinGraceForPurge)

	rows, err := DBPool.Query(ctx, `
		SELECT logto_sub FROM user_deletion_requests
		 WHERE status = 'pending'
		   AND purge_at <= $1
		   AND requested_at <= $2
	`, now, floor)
	if err != nil {
		log.Printf("[GDPR Purge] scan failed: %v", err)
		return
	}
	subs := []string{}
	for rows.Next() {
		var sub string
		if err := rows.Scan(&sub); err == nil {
			subs = append(subs, sub)
		}
	}
	rows.Close()

	for _, sub := range subs {
		if err := purgeUserAccount(ctx, sub); err != nil {
			log.Printf("[GDPR Purge] %s failed: %v (will retry on next pass)", sub, err)
			continue
		}
	}
}

// purgeUserAccount executes the full cascade for one user, in order:
// Logto first (revokes sign-in access immediately), then local DB
// rows, then marks the request as purged. Stripe records for lifetime
// customers are anonymized, not deleted, so tax records stay intact.
func purgeUserAccount(ctx context.Context, logtoSub string) error {
	log.Printf("[GDPR Purge] Starting purge for %s", logtoSub)

	// Step 1: Logto delete. Doing this first guarantees the user can't
	// sign in even if the local cascade partially fails.
	if err := DeleteLogtoUser(logtoSub); err != nil {
		return fmt.Errorf("delete logto user: %w", err)
	}

	// Step 2: Local DB cascade in a transaction.
	tx, err := DBPool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	// Channel configs
	if _, err := tx.Exec(ctx,
		`DELETE FROM user_channels WHERE logto_sub = $1`, logtoSub,
	); err != nil {
		return fmt.Errorf("delete user_channels: %w", err)
	}

	// Fantasy junction + OAuth tokens. Junction row is keyed on guid,
	// which maps via yahoo_users.logto_sub. Delete junction rows first
	// then the yahoo_users row.
	if _, err := tx.Exec(ctx, `
		DELETE FROM yahoo_user_leagues
		 WHERE guid IN (SELECT guid FROM yahoo_users WHERE logto_sub = $1)
	`, logtoSub); err != nil {
		return fmt.Errorf("delete yahoo_user_leagues: %w", err)
	}
	if _, err := tx.Exec(ctx,
		`DELETE FROM yahoo_users WHERE logto_sub = $1`, logtoSub,
	); err != nil {
		return fmt.Errorf("delete yahoo_users: %w", err)
	}

	// Stripe customers: anonymize if lifetime, delete otherwise.
	var lifetime bool
	err = tx.QueryRow(ctx,
		`SELECT lifetime FROM stripe_customers WHERE logto_sub = $1`, logtoSub,
	).Scan(&lifetime)
	if err == nil {
		if lifetime {
			// Anonymize: replace logto_sub with a placeholder so the
			// row no longer references the user, but the payment
			// record survives for accounting / tax audits.
			placeholder := fmt.Sprintf("deleted-%s", uuid.New().String())
			if _, err := tx.Exec(ctx, `
				UPDATE stripe_customers
				   SET logto_sub = $2, updated_at = now()
				 WHERE logto_sub = $1
			`, logtoSub, placeholder); err != nil {
				return fmt.Errorf("anonymize stripe_customers: %w", err)
			}
		} else {
			if _, err := tx.Exec(ctx,
				`DELETE FROM stripe_customers WHERE logto_sub = $1`, logtoSub,
			); err != nil {
				return fmt.Errorf("delete stripe_customers: %w", err)
			}
		}
	} else if err != pgx.ErrNoRows {
		return fmt.Errorf("read stripe_customers: %w", err)
	}

	// Preferences (must come after anything that might reference them).
	if _, err := tx.Exec(ctx,
		`DELETE FROM user_preferences WHERE logto_sub = $1`, logtoSub,
	); err != nil {
		return fmt.Errorf("delete user_preferences: %w", err)
	}

	// Mark the request as purged.
	if _, err := tx.Exec(ctx, `
		UPDATE user_deletion_requests
		   SET status = 'purged', purged_at = now()
		 WHERE logto_sub = $1
	`, logtoSub); err != nil {
		return fmt.Errorf("mark purged: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit tx: %w", err)
	}

	// User row is gone; drop any cached overview so a stale background
	// poll doesn't briefly return data for a purged account.
	InvalidateOverviewCache(ctx, logtoSub)

	log.Printf("[GDPR Purge] Completed purge for %s", logtoSub)
	return nil
}
