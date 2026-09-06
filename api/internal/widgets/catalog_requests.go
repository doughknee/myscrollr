package widgets

import (
	"context"
	"log"
	"strings"

	"github.com/gofiber/fiber/v2"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
)

// maxCatalogRequestQuery bounds what one "request it" click can store. The
// query is whatever was in the search box; nothing sensible is longer.
const maxCatalogRequestQuery = 200

// CatalogRequestResponse is the payload of POST /catalog/requests.
type CatalogRequestResponse struct {
	// Query is the normalised form that was stored (lower-cased, trimmed,
	// inner whitespace collapsed) — the key the count is grouped on.
	Query string `json:"query"`
	// Count is how many distinct users have asked for this query, including
	// the caller.
	Count int `json:"count"`
}

// HandleCatalogRequest records that the signed-in user searched the catalog
// for something it does not have. One row per (user, query): asking twice
// changes nothing, so the count is people, not clicks.
//
// Authenticated because the count is per user and the row is the hook for
// a later "tell me when it ships"; the miss card only shows to people who
// are signed in and browsing the catalog anyway.
func HandleCatalogRequest(c *fiber.Ctx) error {
	userID := platform.GetUserID(c)
	if userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(platform.ErrorResponse{
			Status: "unauthorized",
			Error:  "Authentication required",
		})
	}

	var req struct {
		Query string `json:"query"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(platform.ErrorResponse{
			Status: "error",
			Error:  "Invalid request body",
		})
	}
	query := strings.ToLower(strings.Join(strings.Fields(req.Query), " "))
	if query == "" || len(query) > maxCatalogRequestQuery {
		return c.Status(fiber.StatusBadRequest).JSON(platform.ErrorResponse{
			Status: "error",
			Error:  "query is required",
		})
	}

	// Background, like every other handler here: the pool is the timeout.
	ctx := context.Background()
	if _, err := platform.DBPool.Exec(ctx, `
		INSERT INTO catalog_requests (logto_sub, query) VALUES ($1, $2)
		ON CONFLICT (logto_sub, query) DO NOTHING
	`, userID, query); err != nil {
		log.Printf("[Catalog] record request %q: %v", query, err)
		return c.Status(fiber.StatusInternalServerError).JSON(platform.ErrorResponse{
			Status: "error",
			Error:  "Failed to record request",
		})
	}

	var count int
	if err := platform.DBPool.QueryRow(ctx,
		`SELECT count(*) FROM catalog_requests WHERE query = $1`, query,
	).Scan(&count); err != nil {
		log.Printf("[Catalog] count requests %q: %v", query, err)
		return c.Status(fiber.StatusInternalServerError).JSON(platform.ErrorResponse{
			Status: "error",
			Error:  "Failed to count requests",
		})
	}

	return c.JSON(CatalogRequestResponse{Query: query, Count: count})
}
