package widgets

import (
	"net/http"
	"testing"
)

func TestRSSWritesRejectPrivateFeedsBeforeDatabaseAccess(t *testing.T) {
	for _, widget := range []string{"rss_custom", "news_npr"} {
		create := `{"widget_type":"` + widget + `","config":{"feeds":[{"url":"http://169.254.169.254/metadata/v1/"}]}}`
		if status := doRequest(t, logApp(), http.MethodPost, "/users/me/widgets", "rss-security-test", create); status != http.StatusBadRequest {
			t.Fatalf("create %s returned %d", widget, status)
		}
		update := `{"config":{"feeds":[{"url":"http://127.0.0.1:8080/health"}]}}`
		if status := doRequest(t, logApp(), http.MethodPut, "/users/me/widgets/"+widget, "rss-security-test", update); status != http.StatusBadRequest {
			t.Fatalf("update %s returned %d", widget, status)
		}
	}
}
