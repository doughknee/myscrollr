package widgets

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"sync"

	"github.com/gofiber/fiber/v2"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
)

// CatalogResponse is the payload of GET /catalog.
//
// Version is a content hash of the catalog. Clients bundle a snapshot so the
// ticker works offline (VISION §4.2 constraint 1) and compare versions to
// decide whether their cached copy is stale — cheaper and more honest than a
// timestamp, since it only changes when the catalog actually does.
type CatalogResponse struct {
	Version string               `json:"version"`
	Widgets []platform.WidgetDef `json:"widgets"`
}

// catalogOnce caches the serialized response and its version. The catalog is
// compile-time constant, so this is computed once per process.
var (
	catalogOnce   sync.Once
	catalogBody   CatalogResponse
	catalogETag   string
	electionsBody CatalogResponse
	electionsETag string
)

func buildCatalog() {
	catalogBody, catalogETag = versionCatalog(platform.Catalog())
	electionsBody, electionsETag = versionCatalog(platform.ElectionsCatalog())
}

func versionCatalog(widgets []platform.WidgetDef) (CatalogResponse, string) {
	// Hash the marshalled catalog: any field change moves the version.
	raw, err := json.Marshal(widgets)
	if err != nil {
		// Unreachable — the catalog is plain data. Fall back to an empty
		// version rather than panicking a request path.
		return CatalogResponse{Widgets: widgets}, ""
	}
	sum := sha256.Sum256(raw)
	version := hex.EncodeToString(sum[:8])
	return CatalogResponse{Version: version, Widgets: widgets}, `"` + version + `"`
}

// HandleGetCatalog serves the widget catalog — the single authority for what
// widgets exist (VISION §4.2). Clients fetch it and render generically.
//
// Unauthenticated on purpose: the catalog is the same for everyone (a widget's
// RequiredTier is advertised, not hidden), and the marketing site and a
// first-run desktop with no session both need to read it.
func HandleGetCatalog(c *fiber.Ctx) error {
	catalogOnce.Do(buildCatalog)

	body, etag := catalogBody, catalogETag
	if platform.ElectionsPreview(c.Query("preview")) {
		body, etag = electionsBody, electionsETag
	}

	// Let a client with a warm cache revalidate for free.
	if match := c.Get("If-None-Match"); match != "" && match == etag {
		c.Set("ETag", etag)
		return c.SendStatus(fiber.StatusNotModified)
	}

	c.Set("ETag", etag)
	c.Set("Cache-Control", "public, max-age=300")
	return c.JSON(body)
}
