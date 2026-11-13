package events

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/brandon-relentnet/myscrollr/api/internal/testsupport"
	"github.com/gofiber/fiber/v2"
)

func postSequin(t *testing.T, body string) int {
	t.Helper()
	t.Setenv("SEQUIN_WEBHOOK_SECRET", "s3cret")
	app := fiber.New()
	app.Post("/webhooks/sequin", HandleSequinWebhook)
	req := httptest.NewRequest(http.MethodPost, "/webhooks/sequin", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer s3cret")
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req, 15000)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	defer resp.Body.Close()
	return resp.StatusCode
}

const tradeBody = `{"data":[{"action":"update","record":{"symbol":"AAPL","price":1},"metadata":{"table_name":"trades"}}]}`

// A failed Redis publish must answer 5xx so Sequin redelivers (RB-7).
func TestSequinWebhook_PublishFailureAsksForRedelivery(t *testing.T) {
	mr, cleanup := testsupport.MiniRedis(t)
	defer cleanup()

	if got := postSequin(t, tradeBody); got != http.StatusOK {
		t.Fatalf("healthy publish: want 200, got %d", got)
	}
	mr.Close()
	if got := postSequin(t, tradeBody); got != http.StatusServiceUnavailable {
		t.Fatalf("failed publish: want 503, got %d", got)
	}
}

// A record that can never be routed is acknowledged, never retried forever,
// even while Redis is down.
func TestSequinWebhook_UnroutableRecordIsAcknowledged(t *testing.T) {
	mr, cleanup := testsupport.MiniRedis(t)
	defer cleanup()
	mr.Close()

	unknownTable := `{"data":[{"action":"insert","record":{"x":1},"metadata":{"table_name":"not_routed"}}]}`
	if got := postSequin(t, unknownTable); got != http.StatusOK {
		t.Fatalf("unrouted table: want 200, got %d", got)
	}
	noSymbol := `{"data":[{"action":"insert","record":{"price":1},"metadata":{"table_name":"trades"}}]}`
	if got := postSequin(t, noSymbol); got != http.StatusOK {
		t.Fatalf("record without symbol: want 200, got %d", got)
	}
}

// A failed widget load is retried instead of leaving the user subscribed to
// nothing for the life of the stream (RB-7).
func TestSubscribeUserToTopics_RetriesFailedLoad(t *testing.T) {
	hub := swapHub(t)
	hub.clients.Store("u-retry", &clientList{})

	prevLoad, prevBase := loadUserWidgets, subscribeRetryBase
	t.Cleanup(func() { loadUserWidgets, subscribeRetryBase = prevLoad, prevBase })
	subscribeRetryBase = time.Millisecond
	calls := 0
	loadUserWidgets = func(string) ([]platform.Widget, error) {
		calls++
		if calls < 3 {
			return nil, errors.New("db blip")
		}
		return []platform.Widget{{
			WidgetType: "finance_stocks",
			Enabled:    true,
			Config:     map[string]interface{}{"symbols": []interface{}{"AAPL"}},
		}}, nil
	}

	subscribeUserToTopics("u-retry")

	if calls != 3 {
		t.Fatalf("want 3 load attempts, got %d", calls)
	}
	if _, ok := hub.registry.getUsersForTopic(platform.TopicPrefixFinance + "AAPL")["u-retry"]; !ok {
		t.Fatal("user was not subscribed after the retry succeeded")
	}
}

// The shared secret is compared in constant time; a wrong or partial bearer
// is still refused before anything is parsed.
func TestSequinWebhook_RejectsWrongSecret(t *testing.T) {
	t.Setenv("SEQUIN_WEBHOOK_SECRET", "s3cret")
	app := fiber.New()
	app.Post("/webhooks/sequin", HandleSequinWebhook)
	for _, auth := range []string{"", "Bearer s3cre", "Bearer s3cretX", "s3cret"} {
		req := httptest.NewRequest(http.MethodPost, "/webhooks/sequin", strings.NewReader(tradeBody))
		req.Header.Set("Authorization", auth)
		resp, err := app.Test(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("Authorization %q: want 401, got %d", auth, resp.StatusCode)
		}
	}
}
