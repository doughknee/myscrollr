package widgets

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gofiber/fiber/v2"
)

func catalogApp() *fiber.App {
	app := fiber.New()
	app.Get("/catalog", HandleGetCatalog)
	return app
}

func getCatalog(t *testing.T, app *fiber.App, etag string) (*http.Response, CatalogResponse) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/catalog", nil)
	if etag != "" {
		req.Header.Set("If-None-Match", etag)
	}
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("app.Test: %v", err)
	}
	var body CatalogResponse
	if resp.StatusCode == http.StatusOK {
		raw, _ := io.ReadAll(resp.Body)
		if err := json.Unmarshal(raw, &body); err != nil {
			t.Fatalf("decode catalog: %v", err)
		}
	}
	resp.Body.Close()
	return resp, body
}

// The catalog is the contract every client renders from, so serve it whole,
// versioned, and without auth.
func TestHandleGetCatalogServesFullCatalog(t *testing.T) {
	resp, body := getCatalog(t, catalogApp(), "")

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	if body.Version == "" {
		t.Error("version is empty; clients use it to detect a stale cached snapshot")
	}
	if len(body.Widgets) == 0 {
		t.Fatal("catalog is empty")
	}

	// Spot-check that identity actually crosses the wire — the whole point
	// is that the client no longer owns this data.
	var kalshi bool
	for _, w := range body.Widgets {
		if w.ID != "predictions" {
			continue
		}
		kalshi = true
		if w.Name != "Kalshi" || w.Source != "predictions" || w.Color == "" || w.About == "" {
			t.Errorf("predictions entry lost identity over the wire: %+v", w)
		}
	}
	if !kalshi {
		t.Error("predictions/Kalshi missing from the served catalog")
	}

	// Order must survive JSON encoding — the client renders in array order.
	for i, w := range body.Widgets {
		if w.Order != i {
			t.Errorf("widget %q: Order = %d at index %d", w.ID, w.Order, i)
		}
	}
}

// A matching ETag must revalidate for free; a stale one must resend. This is
// what keeps a desktop that polls the catalog from re-downloading it.
func TestHandleGetCatalogETagRevalidation(t *testing.T) {
	app := catalogApp()

	resp, _ := getCatalog(t, app, "")
	etag := resp.Header.Get("ETag")
	if etag == "" {
		t.Fatal("no ETag on first response")
	}

	fresh, _ := getCatalog(t, app, etag)
	if fresh.StatusCode != http.StatusNotModified {
		t.Errorf("matching ETag: status = %d, want 304", fresh.StatusCode)
	}

	stale, body := getCatalog(t, app, `"deadbeef"`)
	if stale.StatusCode != http.StatusOK {
		t.Errorf("stale ETag: status = %d, want 200", stale.StatusCode)
	}
	if len(body.Widgets) == 0 {
		t.Error("stale ETag should resend the full catalog")
	}
}
