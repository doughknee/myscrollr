package core

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"golang.org/x/sync/singleflight"
)

// =============================================================================
// Logto Management API (M2M) — token acquisition + role assignment
// =============================================================================

var (
	m2mToken       string
	m2mTokenExpiry time.Time
	m2mMu          sync.RWMutex

	// m2mGroup coalesces concurrent token refreshes so the HTTP call to
	// Logto's /oidc/token runs once under burst traffic. Previously, all
	// callers serialized on a single mutex held across the HTTP request,
	// producing head-of-line blocking during webhook spikes.
	m2mGroup singleflight.Group
)

// logtoM2MConfig holds the env-derived configuration for M2M calls.
type logtoM2MConfig struct {
	Endpoint       string // e.g. https://auth.myscrollr.com
	AppID          string
	AppSecret      string
	RoleID         string // "uplink" role
	ProRoleID      string // "uplink_pro" role
	UltimateRoleID string // "uplink_ultimate" role
	Resource       string // https://default.logto.app/api
}

// getM2MConfig reads Logto M2M config from environment once.
func getM2MConfig() logtoM2MConfig {
	endpoint := os.Getenv("LOGTO_ENDPOINT")
	if endpoint == "" {
		log.Println("[Logto M2M] Warning: LOGTO_ENDPOINT not set — M2M calls will fail")
	}
	endpoint = strings.TrimSuffix(endpoint, "/")

	resource := os.Getenv("LOGTO_M2M_RESOURCE")
	if resource == "" {
		resource = "https://default.logto.app/api"
	}

	return logtoM2MConfig{
		Endpoint:       endpoint,
		AppID:          os.Getenv("LOGTO_M2M_APP_ID"),
		AppSecret:      os.Getenv("LOGTO_M2M_APP_SECRET"),
		RoleID:         os.Getenv("LOGTO_UPLINK_ROLE_ID"),
		ProRoleID:      os.Getenv("LOGTO_PRO_ROLE_ID"),
		UltimateRoleID: os.Getenv("LOGTO_ULTIMATE_ROLE_ID"),
		Resource:       resource,
	}
}

// readCachedM2MToken returns the currently-cached token if it's still valid,
// or the empty string otherwise. Uses a read lock so repeated fast-path
// lookups don't serialize on the token mutex.
func readCachedM2MToken() string {
	m2mMu.RLock()
	defer m2mMu.RUnlock()
	if m2mToken != "" && time.Now().Before(m2mTokenExpiry) {
		return m2mToken
	}
	return ""
}

// refreshM2MToken performs the actual HTTP call to Logto's token endpoint
// and swaps the new token into the cache under a write lock. Returns the
// fresh token on success.
func refreshM2MToken() (string, error) {
	cfg := getM2MConfig()
	if cfg.AppID == "" || cfg.AppSecret == "" {
		return "", fmt.Errorf("LOGTO_M2M_APP_ID and LOGTO_M2M_APP_SECRET must be set")
	}

	data := url.Values{}
	data.Set("grant_type", "client_credentials")
	data.Set("resource", cfg.Resource)
	data.Set("scope", "all")

	req, err := http.NewRequest("POST", cfg.Endpoint+"/oidc/token", strings.NewReader(data.Encode()))
	if err != nil {
		return "", fmt.Errorf("create M2M token request: %w", err)
	}
	req.SetBasicAuth(cfg.AppID, cfg.AppSecret)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	client := &http.Client{Timeout: LogtoM2MTokenTimeout}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("M2M token request failed: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("M2M token request returned %d: %s", resp.StatusCode, string(body))
	}

	var tokenResp struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
	}
	if err := json.Unmarshal(body, &tokenResp); err != nil {
		return "", fmt.Errorf("parse M2M token response: %w", err)
	}

	m2mMu.Lock()
	m2mToken = tokenResp.AccessToken
	m2mTokenExpiry = time.Now().Add(time.Duration(tokenResp.ExpiresIn-LogtoM2MTokenBufferSecs) * time.Second)
	m2mMu.Unlock()

	log.Println("[Logto M2M] Acquired new management API token")
	return tokenResp.AccessToken, nil
}

// getM2MToken returns a cached M2M access token, refreshing if expired.
// Concurrent callers share a single in-flight refresh via singleflight,
// so a burst of webhooks during role assignment doesn't fan out into
// parallel /oidc/token calls.
// ResetM2MTokenCache clears the cached Logto management token. Exported
// for integration tests, which swap the Logto stub between cases and must
// not reuse a token minted against the previous stub.
func ResetM2MTokenCache() {
	m2mMu.Lock()
	m2mToken = ""
	m2mTokenExpiry = time.Time{}
	m2mMu.Unlock()
}

func getM2MToken() (string, error) {
	// Fast path: cache hit under read lock.
	if token := readCachedM2MToken(); token != "" {
		return token, nil
	}

	// Slow path: coalesce concurrent refreshes. All callers that miss the
	// cache at the same time share one HTTP request and the same result.
	v, err, _ := m2mGroup.Do("m2m", func() (interface{}, error) {
		// Re-check under the read lock: another goroutine's refresh may
		// have completed between our fast-path check and our singleflight
		// entry.
		if token := readCachedM2MToken(); token != "" {
			return token, nil
		}
		return refreshM2MToken()
	})
	if err != nil {
		return "", err
	}
	return v.(string), nil
}

// AssignUplinkRole assigns the "uplink" role to a Logto user via Management API.
func AssignUplinkRole(logtoSub string) error {
	cfg := getM2MConfig()
	if cfg.RoleID == "" {
		return fmt.Errorf("LOGTO_UPLINK_ROLE_ID must be set")
	}

	token, err := getM2MToken()
	if err != nil {
		return err
	}

	payload, _ := json.Marshal(map[string][]string{
		"roleIds": {cfg.RoleID},
	})

	reqURL := fmt.Sprintf("%s/api/users/%s/roles", cfg.Endpoint, logtoSub)
	req, err := http.NewRequest("POST", reqURL, bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("create assign role request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: LogtoM2MTokenTimeout}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("assign role request failed: %w", err)
	}
	defer resp.Body.Close()

	// 201 = assigned, 422 = already assigned (both are fine)
	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusUnprocessableEntity {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("assign role returned %d: %s", resp.StatusCode, string(body))
	}

	log.Printf("[Logto M2M] Assigned uplink role to user %s", logtoSub)
	return nil
}

// AssignProRole assigns the "uplink_pro" role to a Logto user via Management API.
func AssignProRole(logtoSub string) error {
	cfg := getM2MConfig()
	if cfg.ProRoleID == "" {
		return fmt.Errorf("LOGTO_PRO_ROLE_ID must be set")
	}

	token, err := getM2MToken()
	if err != nil {
		return err
	}

	payload, _ := json.Marshal(map[string][]string{
		"roleIds": {cfg.ProRoleID},
	})

	reqURL := fmt.Sprintf("%s/api/users/%s/roles", cfg.Endpoint, logtoSub)
	req, err := http.NewRequest("POST", reqURL, bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("create assign pro role request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: LogtoM2MTokenTimeout}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("assign pro role request failed: %w", err)
	}
	defer resp.Body.Close()

	// 201 = assigned, 422 = already assigned (both are fine)
	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusUnprocessableEntity {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("assign pro role returned %d: %s", resp.StatusCode, string(body))
	}

	log.Printf("[Logto M2M] Assigned uplink_pro role to user %s", logtoSub)
	return nil
}

// AssignUltimateRole assigns the "uplink_ultimate" role to a Logto user via Management API.
func AssignUltimateRole(logtoSub string) error {
	cfg := getM2MConfig()
	if cfg.UltimateRoleID == "" {
		return fmt.Errorf("LOGTO_ULTIMATE_ROLE_ID must be set")
	}

	token, err := getM2MToken()
	if err != nil {
		return err
	}

	payload, _ := json.Marshal(map[string][]string{
		"roleIds": {cfg.UltimateRoleID},
	})

	reqURL := fmt.Sprintf("%s/api/users/%s/roles", cfg.Endpoint, logtoSub)
	req, err := http.NewRequest("POST", reqURL, bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("create assign ultimate role request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: LogtoM2MTokenTimeout}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("assign ultimate role request failed: %w", err)
	}
	defer resp.Body.Close()

	// 201 = assigned, 422 = already assigned (both are fine)
	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusUnprocessableEntity {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("assign ultimate role returned %d: %s", resp.StatusCode, string(body))
	}

	log.Printf("[Logto M2M] Assigned uplink_ultimate role to user %s", logtoSub)
	return nil
}

// RemoveProRole removes the "uplink_pro" role from a Logto user via Management API.
func RemoveProRole(logtoSub string) error {
	cfg := getM2MConfig()
	if cfg.ProRoleID == "" {
		return fmt.Errorf("LOGTO_PRO_ROLE_ID must be set")
	}

	token, err := getM2MToken()
	if err != nil {
		return err
	}

	reqURL := fmt.Sprintf("%s/api/users/%s/roles/%s", cfg.Endpoint, logtoSub, cfg.ProRoleID)
	req, err := http.NewRequest("DELETE", reqURL, nil)
	if err != nil {
		return fmt.Errorf("create remove pro role request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)

	client := &http.Client{Timeout: LogtoM2MTokenTimeout}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("remove pro role request failed: %w", err)
	}
	defer resp.Body.Close()

	// 204 = removed, 404 = not assigned (both are fine)
	if resp.StatusCode != http.StatusNoContent && resp.StatusCode != http.StatusNotFound {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("remove pro role returned %d: %s", resp.StatusCode, string(body))
	}

	log.Printf("[Logto M2M] Removed uplink_pro role from user %s", logtoSub)
	return nil
}

// RemoveUltimateRole removes the "uplink_ultimate" role from a Logto user via Management API.
func RemoveUltimateRole(logtoSub string) error {
	cfg := getM2MConfig()
	if cfg.UltimateRoleID == "" {
		return fmt.Errorf("LOGTO_ULTIMATE_ROLE_ID must be set")
	}

	token, err := getM2MToken()
	if err != nil {
		return err
	}

	reqURL := fmt.Sprintf("%s/api/users/%s/roles/%s", cfg.Endpoint, logtoSub, cfg.UltimateRoleID)
	req, err := http.NewRequest("DELETE", reqURL, nil)
	if err != nil {
		return fmt.Errorf("create remove ultimate role request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)

	client := &http.Client{Timeout: LogtoM2MTokenTimeout}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("remove ultimate role request failed: %w", err)
	}
	defer resp.Body.Close()

	// 204 = removed, 404 = not assigned (both are fine)
	if resp.StatusCode != http.StatusNoContent && resp.StatusCode != http.StatusNotFound {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("remove ultimate role returned %d: %s", resp.StatusCode, string(body))
	}

	log.Printf("[Logto M2M] Removed uplink_ultimate role from user %s", logtoSub)
	return nil
}

// RemoveUplinkRole removes the "uplink" role from a Logto user via Management API.
func RemoveUplinkRole(logtoSub string) error {
	cfg := getM2MConfig()
	if cfg.RoleID == "" {
		return fmt.Errorf("LOGTO_UPLINK_ROLE_ID must be set")
	}

	token, err := getM2MToken()
	if err != nil {
		return err
	}

	reqURL := fmt.Sprintf("%s/api/users/%s/roles/%s", cfg.Endpoint, logtoSub, cfg.RoleID)
	req, err := http.NewRequest("DELETE", reqURL, nil)
	if err != nil {
		return fmt.Errorf("create remove role request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)

	client := &http.Client{Timeout: LogtoM2MTokenTimeout}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("remove role request failed: %w", err)
	}
	defer resp.Body.Close()

	// 204 = removed, 404 = not assigned (both are fine)
	if resp.StatusCode != http.StatusNoContent && resp.StatusCode != http.StatusNotFound {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("remove role returned %d: %s", resp.StatusCode, string(body))
	}

	log.Printf("[Logto M2M] Removed uplink role from user %s", logtoSub)
	return nil
}

// DeleteLogtoUser permanently deletes a Logto user via the Management API.
// Used by the Sprint 4 GDPR purge worker after the local DB cascade has
// committed. Idempotent: treats a 404 as success since the user may have
// already been deleted on a prior attempt (Logto failed, DB purge succeeded,
// then Logto recovered before the retry hit).
func DeleteLogtoUser(logtoSub string) error {
	cfg := getM2MConfig()

	token, err := getM2MToken()
	if err != nil {
		return err
	}

	reqURL := fmt.Sprintf("%s/api/users/%s", cfg.Endpoint, logtoSub)
	req, err := http.NewRequest("DELETE", reqURL, nil)
	if err != nil {
		return fmt.Errorf("create delete user request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)

	client := &http.Client{Timeout: LogtoM2MTokenTimeout}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("delete user request failed: %w", err)
	}
	defer resp.Body.Close()

	// 204 = deleted, 404 = already gone (idempotent replay is fine).
	if resp.StatusCode != http.StatusNoContent && resp.StatusCode != http.StatusNotFound {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("delete user returned %d: %s", resp.StatusCode, string(body))
	}

	log.Printf("[Logto M2M] Deleted user %s", logtoSub)
	return nil
}
