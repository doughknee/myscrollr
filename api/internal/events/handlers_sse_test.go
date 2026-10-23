package events

import (
	"bufio"
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"io"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"
)

func TestSuspendedStreamUsesBackoffInsteadOfTokenRefresh(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	doc, _ := json.Marshal(map[string]interface{}{"keys": []interface{}{map[string]string{
		"kty": "RSA", "alg": "RS256", "kid": "sse-test", "use": "sig",
		"n": base64.RawURLEncoding.EncodeToString(key.N.Bytes()), "e": base64.RawURLEncoding.EncodeToString(big.NewInt(int64(key.E)).Bytes()),
	}}})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write(doc) }))
	defer srv.Close()
	t.Setenv("LOGTO_JWKS_URL", srv.URL)
	t.Setenv("LOGTO_URL", "https://auth.example/oidc")
	t.Setenv("API_URL", "https://api.example")
	platform.InitAuth()
	previous := platform.CheckAccountAccess
	defer func() { platform.CheckAccountAccess = previous }()
	platform.CheckAccountAccess = func(string) error { return platform.ErrAccountBlocked }
	app := fiber.New()
	app.Get("/stream", StreamEvents)
	for _, tc := range []struct {
		expiry time.Time
		status int
	}{
		{time.Now().Add(time.Hour), 403}, {time.Now().Add(-time.Minute), 401},
	} {
		token := jwt.NewWithClaims(jwt.SigningMethodRS256, jwt.MapClaims{"sub": "stream-test", "iss": "https://auth.example/oidc", "aud": "https://api.example", "exp": tc.expiry.Unix()})
		token.Header["kid"] = "sse-test"
		signed, err := token.SignedString(key)
		if err != nil {
			t.Fatal(err)
		}
		req := httptest.NewRequest("GET", "/stream", nil)
		req.Header.Set("Authorization", "Bearer "+signed)
		resp, err := app.Test(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != tc.status {
			t.Fatalf("status %d; want %d", resp.StatusCode, tc.status)
		}
	}
}

func TestOpenStreamsCloseOnExpirySuspensionAndAuthorityFailure(t *testing.T) {
	for _, mode := range []string{"expiry", "suspension", "unavailable"} {
		t.Run(mode, func(t *testing.T) {
			h := swapHub(t)
			previousCheck, previousInterval := platform.CheckAccountAccess, streamAccessInterval
			var revoked atomic.Bool
			platform.CheckAccountAccess = func(string) error {
				if revoked.Load() {
					if mode == "unavailable" {
						return platform.ErrAccountCheckUnavailable
					}
					return platform.ErrAccountBlocked
				}
				return nil
			}
			streamAccessInterval = 10 * time.Millisecond
			t.Cleanup(func() { platform.CheckAccountAccess, streamAccessInterval = previousCheck, previousInterval })
			client := &Client{UserID: "stream-test", Ch: make(chan []byte, 1)}
			h.register(client)
			app := fiber.New(fiber.Config{DisableStartupMessage: true})
			expires := time.Now().Add(time.Minute)
			if mode == "expiry" {
				expires = time.Now().Add(150 * time.Millisecond)
			}
			app.Get("/stream", func(c *fiber.Ctx) error { return streamToClient(c, client, "test", "stream-test", expires) })
			listener, err := net.Listen("tcp", "127.0.0.1:0")
			if err != nil {
				t.Fatal(err)
			}
			go app.Listener(listener)
			defer app.Shutdown()
			httpClient := &http.Client{Timeout: 2 * time.Second}
			resp, err := httpClient.Get("http://" + listener.Addr().String() + "/stream")
			if err != nil {
				t.Fatal(err)
			}
			defer resp.Body.Close()
			reader := bufio.NewReader(resp.Body)
			if _, err := reader.ReadString('\n'); err != nil {
				t.Fatal(err)
			}
			client.Ch <- []byte(`{"normal":"feed update"}`)
			for {
				line, err := reader.ReadString('\n')
				if err != nil {
					t.Fatal(err)
				}
				if len(line) > 5 && line[:5] == "data:" {
					break
				}
			}
			revoked.Store(mode != "expiry")
			if _, err := io.ReadAll(reader); err != nil {
				t.Fatalf("stream failed to close: %v", err)
			}
			if h.clientCount.Load() != 0 {
				t.Fatal("stream remains registered")
			}
		})
	}
}
