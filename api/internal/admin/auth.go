// Package admin is the staff console's server half: who counts as staff,
// and the read-only views of Scrollr that the /admin dashboard renders.
//
// Admin is its own list (`admin_users`), never a subscription tier. See
// migration 000016 for why `super_user` is not, and must not become, the gate.
package admin

import (
	"context"
	"log"
	"strings"

	"github.com/brandon-relentnet/myscrollr/api/internal/accounts"
	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
)

// lookupVerifiedEmail resolves a user's verified email from their Logto sub.
// A package var so tests can substitute a stub instead of reaching Logto;
// production always runs accounts.LogtoPrimaryEmail.
var lookupVerifiedEmail = accounts.LogtoPrimaryEmail

// adminEmailLocal is the Fiber local holding the acting admin's email, set by
// RequireAdmin so handlers can attribute writes without a second lookup.
const adminEmailLocal = "admin_email"

// ActingAdmin returns the email of the admin behind the current request.
func ActingAdmin(c *fiber.Ctx) string {
	if email, ok := c.Locals(adminEmailLocal).(string); ok {
		return email
	}
	return ""
}

func forbidden(c *fiber.Ctx) error {
	return c.Status(fiber.StatusForbidden).JSON(platform.ErrorResponse{
		Status: "forbidden",
		Error:  "Staff access only",
	})
}

// Handlers pass context.Background() to the pool rather than c.Context().
// That is the convention everywhere else in this API, and it is not cosmetic:
// Fiber's request context is already cancelled by the time a handler under
// app.Test() reaches the database, so c.Context() turns every query in a test
// into "context canceled" - which, on an auth check, silently reads as a
// clean 403 and makes a deny-path test pass for entirely the wrong reason.
//
// RequireAdmin gates every /admin route. It runs AFTER platform.LogtoAuth,
// which has already validated the JWT and put the sub in Locals.
//
// Two paths, in this order:
//
//  1. The sub is already pinned to an admin row — allow, no external call.
//     This is every request after the first.
//  2. No pinned row: ask Logto for this sub's VERIFIED primary email and
//     claim the matching unpinned row, pinning the sub onto it. This is the
//     bootstrap, and it happens once per admin.
//
// Nothing here reads roles or tier. A `super_user` token that is not on the
// list gets the same 403 as anyone else — that is the point of the table.
func RequireAdmin(c *fiber.Ctx) error {
	sub := platform.GetUserID(c)
	if sub == "" {
		// LogtoAuth should have written a 401 already; if the chain is ever
		// wired without it, fail closed rather than open.
		return c.Status(fiber.StatusUnauthorized).JSON(platform.ErrorResponse{
			Status: "unauthorized",
			Error:  "Authentication required",
		})
	}
	if platform.DBPool == nil {
		return forbidden(c)
	}

	ctx := context.Background()

	// 1. Pinned sub.
	var email string
	err := platform.DBPool.QueryRow(ctx,
		`UPDATE admin_users SET last_seen_at = now() WHERE logto_sub = $1 RETURNING email`,
		sub).Scan(&email)
	if err == nil {
		c.Locals(adminEmailLocal, email)
		return c.Next()
	}
	if err != pgx.ErrNoRows {
		log.Printf("[Admin] lookup by sub failed: %v", err)
		return forbidden(c)
	}

	// 2. Bootstrap by verified email.
	verified, lookupErr := lookupVerifiedEmail(sub)
	if lookupErr != nil {
		log.Printf("[Admin] verified-email lookup failed for %s: %v", platform.HashUserSub(sub), lookupErr)
		return forbidden(c)
	}
	if strings.TrimSpace(verified) == "" {
		return forbidden(c)
	}

	// `logto_sub IS NULL` matters: once a row is pinned, a second account that
	// later acquires the same address cannot take it over.
	err = platform.DBPool.QueryRow(ctx,
		`UPDATE admin_users
		    SET logto_sub = $1, last_seen_at = now()
		  WHERE lower(email) = lower($2) AND logto_sub IS NULL
		RETURNING email`,
		sub, verified).Scan(&email)
	if err != nil {
		if err != pgx.ErrNoRows {
			log.Printf("[Admin] claim by email failed: %v", err)
		}
		return forbidden(c)
	}

	log.Printf("[Admin] %s claimed by sub %s", email, platform.HashUserSub(sub))
	c.Locals(adminEmailLocal, email)
	return c.Next()
}

// countAdmins returns how many admin rows exist. Used by the delete guard.
func countAdmins(ctx context.Context) (int, error) {
	var n int
	err := platform.DBPool.QueryRow(ctx, `SELECT count(*) FROM admin_users`).Scan(&n)
	return n, err
}

// HandleWhoAmI - GET /admin/me
//
// The dashboard's gate. RequireAdmin has already decided; reaching this
// handler at all is the answer, and the email lets the shell show who it
// thinks you are. Cheapest possible call, so the shell can ask on every load
// without paying for the Overview queries first.
func HandleWhoAmI(c *fiber.Ctx) error {
	return c.JSON(fiber.Map{"email": ActingAdmin(c)})
}
