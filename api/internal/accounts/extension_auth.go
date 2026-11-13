package accounts

import (
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/limiter"
)

// ExtensionTokenMaxPerMinute is the per-address budget for the two token
// proxy routes (SCROLLR-459 / SB-5). A desktop app spends one refresh per
// launch plus one per access-token lifetime, shared by all its windows, and
// retries back off; even a whole office behind one address launching together
// stays far under 60 a minute. A flood does not, and without a cap it is
// relayed to Logto from core's own address.
const ExtensionTokenMaxPerMinute = 60

// ExtensionTokenLimiter rate-limits POST /extension/token[/refresh] per client
// address, in its own bucket (the global limiter exempts these paths so that
// ordinary API traffic can never starve a sign-in).
//
// The limit answers 503 + Retry-After, NOT 429: the installed desktop treats
// any 4xx from the refresh route as "the refresh token was rejected" and signs
// the user out (auth.ts), while a 5xx is a transient failure it retries.
func ExtensionTokenLimiter(storage fiber.Storage) fiber.Handler {
	return limiter.New(limiter.Config{
		Max:        ExtensionTokenMaxPerMinute,
		Expiration: time.Minute,
		Storage:    storage,
		KeyGenerator: func(c *fiber.Ctx) string {
			return "ext-token:" + c.IP()
		},
		LimitReached: func(c *fiber.Ctx) error {
			c.Set("Retry-After", "60")
			return c.Status(fiber.StatusServiceUnavailable).JSON(platform.ErrorResponse{
				Status: "unavailable",
				Error:  "Too many sign-in requests from this address; retry shortly",
			})
		},
	})
}

// getLogtoTokenURL returns the Logto OIDC token endpoint URL.
func getLogtoTokenURL() string {
	logtoURL := os.Getenv("LOGTO_URL")
	return strings.TrimSuffix(logtoURL, "/") + "/token"
}

// getExtensionAppID returns the Logto app ID for the browser extension.
func getExtensionAppID() string {
	return os.Getenv("LOGTO_EXTENSION_APP_ID")
}

// getAPIResource returns the API resource identifier (audience) for token requests.
func getAPIResource() string {
	return os.Getenv("API_URL")
}

// HandleExtensionTokenExchange proxies an authorization_code token exchange
// to Logto on behalf of the browser extension.
func HandleExtensionTokenExchange(c *fiber.Ctx) error {
	platform.SetCORSHeaders(c)

	extensionAppID := getExtensionAppID()
	if extensionAppID == "" {
		log.Println("[ExtAuth] LOGTO_EXTENSION_APP_ID not configured")
		return c.Status(fiber.StatusInternalServerError).JSON(platform.ErrorResponse{
			Status: "error",
			Error:  "Extension auth not configured",
		})
	}

	var req struct {
		Code         string `json:"code"`
		RedirectURI  string `json:"redirect_uri"`
		CodeVerifier string `json:"code_verifier"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(platform.ErrorResponse{
			Status: "error",
			Error:  "Invalid request body",
		})
	}

	if req.Code == "" || req.RedirectURI == "" || req.CodeVerifier == "" {
		return c.Status(fiber.StatusBadRequest).JSON(platform.ErrorResponse{
			Status: "error",
			Error:  "Missing required fields: code, redirect_uri, code_verifier",
		})
	}

	formData := url.Values{
		"grant_type":    {"authorization_code"},
		"client_id":     {extensionAppID},
		"code":          {req.Code},
		"redirect_uri":  {req.RedirectURI},
		"code_verifier": {req.CodeVerifier},
		"resource":      {getAPIResource()},
	}

	return proxyLogtoToken(c, formData)
}

// HandleExtensionTokenRefresh proxies a refresh_token grant to Logto
// on behalf of the browser extension.
func HandleExtensionTokenRefresh(c *fiber.Ctx) error {
	platform.SetCORSHeaders(c)

	extensionAppID := getExtensionAppID()
	if extensionAppID == "" {
		log.Println("[ExtAuth] LOGTO_EXTENSION_APP_ID not configured")
		return c.Status(fiber.StatusInternalServerError).JSON(platform.ErrorResponse{
			Status: "error",
			Error:  "Extension auth not configured",
		})
	}

	var req struct {
		RefreshToken string `json:"refresh_token"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(platform.ErrorResponse{
			Status: "error",
			Error:  "Invalid request body",
		})
	}

	if req.RefreshToken == "" {
		return c.Status(fiber.StatusBadRequest).JSON(platform.ErrorResponse{
			Status: "error",
			Error:  "Missing required field: refresh_token",
		})
	}

	formData := url.Values{
		"grant_type":    {"refresh_token"},
		"client_id":     {extensionAppID},
		"refresh_token": {req.RefreshToken},
		"resource":      {getAPIResource()},
	}

	return proxyLogtoToken(c, formData)
}

// HandleExtensionAuthPreflight handles OPTIONS requests for extension auth endpoints.
func HandleExtensionAuthPreflight(c *fiber.Ctx) error {
	platform.SetCORSHeaders(c)
	return c.SendStatus(fiber.StatusNoContent)
}

// proxyLogtoToken forwards a form-encoded token request to the Logto OIDC
// token endpoint and streams the response back to the caller.
func proxyLogtoToken(c *fiber.Ctx, formData url.Values) error {
	tokenURL := getLogtoTokenURL()
	if tokenURL == "" || tokenURL == "/token" {
		log.Println("[ExtAuth] Cannot derive Logto token URL")
		return c.Status(fiber.StatusInternalServerError).JSON(platform.ErrorResponse{
			Status: "error",
			Error:  "Auth provider not configured",
		})
	}

	httpClient := &http.Client{Timeout: platform.LogtoProxyTimeout}
	resp, err := httpClient.PostForm(tokenURL, formData)
	if err != nil {
		log.Printf("[ExtAuth] Logto request failed: %v", err)
		return c.Status(fiber.StatusBadGateway).JSON(platform.ErrorResponse{
			Status: "error",
			Error:  "Failed to reach auth provider",
		})
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Printf("[ExtAuth] Failed to read Logto response: %v", err)
		return c.Status(fiber.StatusBadGateway).JSON(platform.ErrorResponse{
			Status: "error",
			Error:  "Invalid response from auth provider",
		})
	}

	c.Set("Content-Type", "application/json")
	return c.Status(resp.StatusCode).Send(body)
}
