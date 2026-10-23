package platform

import (
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/MicahParks/keyfunc/v2"
	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"
)

func TestProtectedRoutesRejectSuspendedAndExpiredTokens(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	doc, _ := json.Marshal(map[string]interface{}{"keys": []interface{}{map[string]string{
		"kty": "RSA", "alg": "RS256", "kid": "test", "use": "sig",
		"n": base64.RawURLEncoding.EncodeToString(key.N.Bytes()), "e": base64.RawURLEncoding.EncodeToString(big.NewInt(int64(key.E)).Bytes()),
	}}})
	previousJWKS, previousCheck := jwks, CheckAccountAccess
	jwks, err = keyfunc.NewJSON(doc)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { jwks, CheckAccountAccess = previousJWKS, previousCheck })
	t.Setenv("LOGTO_URL", "https://auth.example/oidc")
	t.Setenv("API_URL", "https://api.example")
	var checkErr error
	CheckAccountAccess = func(sub string) error {
		if sub != "test-user" {
			t.Fatal("wrong subject")
		}
		return checkErr
	}
	sign := func(exp interface{}) string {
		claims := jwt.MapClaims{"sub": "test-user", "iss": "https://auth.example/oidc", "aud": "https://api.example"}
		if exp != nil {
			claims["exp"] = exp
		}
		token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
		token.Header["kid"] = "test"
		signed, err := token.SignedString(key)
		if err != nil {
			t.Fatal(err)
		}
		return signed
	}
	valid := sign(time.Now().Add(time.Hour).Unix())
	app := fiber.New()
	hits := 0
	app.All("/protected", LogtoAuth, func(c *fiber.Ctx) error { hits++; return c.SendStatus(200) })
	for _, tc := range []struct {
		name, token string
		err         error
		status      int
	}{
		{"active", valid, nil, 200}, {"suspended", valid, ErrAccountBlocked, 403},
		{"authority unavailable", valid, ErrAccountCheckUnavailable, 503},
		{"expired", sign(time.Now().Add(-time.Minute).Unix()), nil, 401}, {"missing expiry", sign(nil), nil, 401},
	} {
		t.Run(tc.name, func(t *testing.T) {
			checkErr = tc.err
			for _, method := range []string{"GET", "POST"} {
				before := hits
				req := httptest.NewRequest(method, "/protected", nil)
				req.Header.Set("Authorization", "Bearer "+tc.token)
				resp, err := app.Test(req)
				if err != nil {
					t.Fatal(err)
				}
				resp.Body.Close()
				if resp.StatusCode != tc.status {
					t.Fatalf("%s status=%d", method, resp.StatusCode)
				}
				if tc.status != 200 && hits != before {
					t.Fatal("protected handler executed")
				}
			}
		})
	}
}
