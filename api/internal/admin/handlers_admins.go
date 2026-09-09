package admin

import (
	"context"
	"log"
	"strconv"
	"strings"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
)

// AdminRow is one row of the Admins page. The Logto sub is exposed only as
// `claimed` — the dashboard needs to know whether the invite has been used,
// not the identifier itself.
type AdminRow struct {
	ID         int64   `json:"id"`
	Email      string  `json:"email"`
	Claimed    bool    `json:"claimed"`
	AddedBy    *string `json:"added_by"`
	AddedAt    string  `json:"added_at"`
	LastSeenAt *string `json:"last_seen_at"`
	Note       *string `json:"note"`
	Self       bool    `json:"self"`
}

func rfc3339(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := t.Format(time.RFC3339)
	return &s
}

// HandleListAdmins — GET /admin/admins
func HandleListAdmins(c *fiber.Ctx) error {
	rows, err := platform.DBPool.Query(context.Background(),
		`SELECT id, email, logto_sub IS NOT NULL, added_by, added_at, last_seen_at, note
		   FROM admin_users
		  ORDER BY added_at`)
	if err != nil {
		log.Printf("[Admin] list admins: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(platform.ErrorResponse{
			Status: "error", Error: "Could not read the admin list",
		})
	}
	defer rows.Close()

	me := ActingAdmin(c)
	out := make([]AdminRow, 0, 8)
	for rows.Next() {
		var r AdminRow
		var addedAt time.Time
		var lastSeen *time.Time
		if err := rows.Scan(&r.ID, &r.Email, &r.Claimed, &r.AddedBy, &addedAt, &lastSeen, &r.Note); err != nil {
			log.Printf("[Admin] scan admin row: %v", err)
			continue
		}
		r.AddedAt = addedAt.Format(time.RFC3339)
		r.LastSeenAt = rfc3339(lastSeen)
		r.Self = strings.EqualFold(r.Email, me)
		out = append(out, r)
	}
	return c.JSON(fiber.Map{"admins": out})
}

type addAdminBody struct {
	Email string `json:"email"`
	Note  string `json:"note"`
}

// HandleAddAdmin — POST /admin/admins
//
// The new admin is stored by email with no sub. RequireAdmin pins their sub
// the first time they sign in and their Logto-verified address matches, so
// access is granted without a deploy and without trusting a claim.
func HandleAddAdmin(c *fiber.Ctx) error {
	var body addAdminBody
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(platform.ErrorResponse{
			Status: "error", Error: "Invalid request body",
		})
	}

	email := strings.TrimSpace(body.Email)
	// Deliberately shallow: Logto owns real address validation, and the row is
	// inert until a verified Logto email matches it. This only rejects obvious
	// nonsense so the list stays readable.
	if email == "" || !strings.Contains(email, "@") || strings.ContainsAny(email, " \t\r\n") {
		return c.Status(fiber.StatusBadRequest).JSON(platform.ErrorResponse{
			Status: "error", Error: "A valid email address is required",
		})
	}

	var note *string
	if n := strings.TrimSpace(body.Note); n != "" {
		note = &n
	}

	me := ActingAdmin(c)
	var id int64
	err := platform.DBPool.QueryRow(context.Background(),
		`INSERT INTO admin_users (email, added_by, note) VALUES ($1, $2, $3)
		 ON CONFLICT (lower(email)) DO NOTHING
		 RETURNING id`,
		email, me, note).Scan(&id)
	if err == pgx.ErrNoRows {
		return c.Status(fiber.StatusConflict).JSON(platform.ErrorResponse{
			Status: "error", Error: "That address is already an admin",
		})
	}
	if err != nil {
		log.Printf("[Admin] add admin: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(platform.ErrorResponse{
			Status: "error", Error: "Could not add that admin",
		})
	}

	log.Printf("[Admin] GRANT %s added by %s", email, me)
	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"status": "ok", "id": id})
}

// HandleRemoveAdmin — DELETE /admin/admins/:id
//
// Two refusals, and they are the whole reason this endpoint is safe to ship:
// the last admin cannot be removed, and nobody can remove themselves. Between
// them there is no sequence of clicks that ends with an empty list or with the
// only signed-in admin locked out.
func HandleRemoveAdmin(c *fiber.Ctx) error {
	id, err := strconv.ParseInt(c.Params("id"), 10, 64)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(platform.ErrorResponse{
			Status: "error", Error: "Invalid admin id",
		})
	}

	ctx := context.Background()
	total, err := countAdmins(ctx)
	if err != nil {
		log.Printf("[Admin] count admins: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(platform.ErrorResponse{
			Status: "error", Error: "Could not read the admin list",
		})
	}
	if total <= 1 {
		return c.Status(fiber.StatusConflict).JSON(platform.ErrorResponse{
			Status: "error", Error: "The last admin cannot be removed",
		})
	}

	var email string
	if err := platform.DBPool.QueryRow(ctx,
		`SELECT email FROM admin_users WHERE id = $1`, id).Scan(&email); err != nil {
		if err == pgx.ErrNoRows {
			return c.Status(fiber.StatusNotFound).JSON(platform.ErrorResponse{
				Status: "error", Error: "No such admin",
			})
		}
		log.Printf("[Admin] read admin %d: %v", id, err)
		return c.Status(fiber.StatusInternalServerError).JSON(platform.ErrorResponse{
			Status: "error", Error: "Could not read that admin",
		})
	}

	me := ActingAdmin(c)
	if strings.EqualFold(email, me) {
		return c.Status(fiber.StatusConflict).JSON(platform.ErrorResponse{
			Status: "error", Error: "You cannot remove your own admin access",
		})
	}

	if _, err := platform.DBPool.Exec(ctx, `DELETE FROM admin_users WHERE id = $1`, id); err != nil {
		log.Printf("[Admin] remove admin %d: %v", id, err)
		return c.Status(fiber.StatusInternalServerError).JSON(platform.ErrorResponse{
			Status: "error", Error: "Could not remove that admin",
		})
	}

	log.Printf("[Admin] REVOKE %s removed by %s", email, me)
	return c.JSON(fiber.Map{"status": "ok"})
}
