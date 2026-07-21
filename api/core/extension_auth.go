package core

import (
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"

	"github.com/gofiber/fiber/v2"
)

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
//
func HandleExtensionTokenExchange(c *fiber.Ctx) error {
	setCORSHeaders(c)

	extensionAppID := getExtensionAppID()
	if extensionAppID == "" {
		log.Println("[ExtAuth] LOGTO_EXTENSION_APP_ID not configured")
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
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
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Status: "error",
			Error:  "Invalid request body",
		})
	}

	if req.Code == "" || req.RedirectURI == "" || req.CodeVerifier == "" {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
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
//
func HandleExtensionTokenRefresh(c *fiber.Ctx) error {
	setCORSHeaders(c)

	extensionAppID := getExtensionAppID()
	if extensionAppID == "" {
		log.Println("[ExtAuth] LOGTO_EXTENSION_APP_ID not configured")
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Status: "error",
			Error:  "Extension auth not configured",
		})
	}

	var req struct {
		RefreshToken string `json:"refresh_token"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Status: "error",
			Error:  "Invalid request body",
		})
	}

	if req.RefreshToken == "" {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
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
	setCORSHeaders(c)
	return c.SendStatus(fiber.StatusNoContent)
}

// proxyLogtoToken forwards a form-encoded token request to the Logto OIDC
// token endpoint and streams the response back to the caller.
func proxyLogtoToken(c *fiber.Ctx, formData url.Values) error {
	tokenURL := getLogtoTokenURL()
	if tokenURL == "" || tokenURL == "/token" {
		log.Println("[ExtAuth] Cannot derive Logto token URL")
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Status: "error",
			Error:  "Auth provider not configured",
		})
	}

	httpClient := &http.Client{Timeout: LogtoProxyTimeout}
	resp, err := httpClient.PostForm(tokenURL, formData)
	if err != nil {
		log.Printf("[ExtAuth] Logto request failed: %v", err)
		return c.Status(fiber.StatusBadGateway).JSON(ErrorResponse{
			Status: "error",
			Error:  "Failed to reach auth provider",
		})
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Printf("[ExtAuth] Failed to read Logto response: %v", err)
		return c.Status(fiber.StatusBadGateway).JSON(ErrorResponse{
			Status: "error",
			Error:  "Invalid response from auth provider",
		})
	}

	c.Set("Content-Type", "application/json")
	return c.Status(resp.StatusCode).Send(body)
}
