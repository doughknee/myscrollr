package support

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// stubDiscord points discordRequest at a local server with the five env vars
// loadDiscordConfig insists on.
func stubDiscord(t *testing.T, h http.Handler) {
	t.Helper()
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	old := discordAPIBase
	discordAPIBase = srv.URL
	t.Cleanup(func() { discordAPIBase = old })
	for k, v := range map[string]string{
		"DISCORD_BOT_TOKEN": "t", "DISCORD_PUBLIC_KEY": "p",
		"DISCORD_APPLICATION_ID": "a", "DISCORD_GUILD_ID": "g",
		"DISCORD_SUPPORT_CHANNEL_ID": "c",
	} {
		t.Setenv(k, v)
	}
}

// TestDiscordRequestWaitsOutRateLimit — a long reply is split into as many as
// twenty messages and Discord rate-limits per channel, so the bucket runs dry
// mid-thread. That used to drop the tail of a draft with nothing but a log
// line, which is how a user could be shown two thirds of an answer.
func TestDiscordRequestWaitsOutRateLimit(t *testing.T) {
	var calls int32
	var bodies []string
	stubDiscord(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		bodies = append(bodies, string(b))
		w.Header().Set("Content-Type", "application/json")
		if atomic.AddInt32(&calls, 1) == 1 {
			w.WriteHeader(http.StatusTooManyRequests)
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"message": "You are being rate limited.", "retry_after": 0.01, "global": false,
			})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]string{"id": "42"})
	}))

	body, status, err := discordRequest(context.Background(), http.MethodPost, "/channels/c/messages",
		map[string]string{"content": "the tail of a long reply"})
	if err != nil {
		t.Fatal(err)
	}
	if status != 200 || !strings.Contains(string(body), `"42"`) {
		t.Fatalf("status=%d body=%s, want the retried 200", status, body)
	}
	if calls != 2 {
		t.Fatalf("calls = %d, want 2 (one 429, one retry)", calls)
	}
	// The retry must carry the same payload — a consumed reader would send
	// an empty body the second time and Discord would reject it.
	if len(bodies) != 2 || bodies[0] != bodies[1] || !strings.Contains(bodies[1], "the tail of a long reply") {
		t.Fatalf("retried body = %q, want the original %q", bodies[len(bodies)-1], bodies[0])
	}
}

// TestDiscordRequestGivesUp stops the retry loop turning a persistent 429 into
// an unbounded wait: the caller still gets the status and logs it, as before.
func TestDiscordRequestGivesUp(t *testing.T) {
	var calls int32
	stubDiscord(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = w.Write([]byte(`{"retry_after":0.01}`))
	}))

	_, status, err := discordRequest(context.Background(), http.MethodGet, "/channels/c", nil)
	if err != nil {
		t.Fatal(err)
	}
	if status != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want 429 handed back", status)
	}
	if want := int32(discordRateLimitRetries + 1); calls != want {
		t.Fatalf("calls = %d, want %d", calls, want)
	}
}

func TestDiscordRetryAfter(t *testing.T) {
	for _, tc := range []struct {
		name, header, body string
		want               time.Duration
	}{
		{"header wins", "2", `{"retry_after":9}`, 2 * time.Second},
		{"body is the fallback", "", `{"retry_after":0.705}`, 705 * time.Millisecond},
		{"floor, never a busy loop", "", `{"retry_after":0}`, 250 * time.Millisecond},
		{"nothing parseable", "", `not json`, 250 * time.Millisecond},
		{"ceiling, never a stalled request", "600", ``, 10 * time.Second},
	} {
		t.Run(tc.name, func(t *testing.T) {
			resp := &http.Response{Header: http.Header{}}
			if tc.header != "" {
				resp.Header.Set("Retry-After", tc.header)
			}
			if got := discordRetryAfter(resp, []byte(tc.body)); got != tc.want {
				t.Fatalf("got %s, want %s", got, tc.want)
			}
		})
	}
}
