package main

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/xml"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/redis/go-redis/v9"
	"golang.org/x/oauth2"
)

// =============================================================================
// Yahoo OAuth Flow
// =============================================================================

// YahooStart initiates the Yahoo OAuth flow.
//
// Authentication is REQUIRED. The caller must already be logged in to
// Scrollr; the core gateway sets X-User-Sub based on the verified Logto
// session before proxying here. The old `?logto_sub=` query fallback was
// removed because it allowed an attacker to bind their own Yahoo
// credentials to an arbitrary victim's Scrollr account.
//
// Response shape is content-negotiated:
//   - `Accept: application/json` (or `?response=json`) → 200 with
//     {"redirect_url": "<yahoo consent url>"}. The desktop app uses
//     this so it can call /yahoo/start with a Bearer header (which the
//     system browser cannot carry) and then `shell::open` the returned
//     URL externally.
//   - Otherwise (HTML / wildcard) → 307 redirect to Yahoo. Used when a
//     logged-in browser session hits the URL directly.
func (a *App) YahooStart(c *fiber.Ctx) error {
	logtoSub := GetUserSub(c)
	if logtoSub == "" {
		log.Println("[YahooStart] Rejected — no X-User-Sub header (unauthenticated)")
		return c.Status(fiber.StatusUnauthorized).JSON(ErrorResponse{
			Status: "unauthorized",
			Error:  "authentication required",
		})
	}
	log.Printf("[YahooStart] Hit — logto_sub=%s", logtoSub)

	b := make([]byte, OAuthStateBytes)
	if _, err := rand.Read(b); err != nil {
		log.Printf("[YahooStart] Failed to generate CSRF state: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Status: "error",
			Error:  "failed to generate state",
		})
	}
	state := fmt.Sprintf("%x", b)

	// Store state and logto_sub mapping
	pipe := a.rdb.Pipeline()
	pipe.Set(context.Background(), RedisCSRFPrefix+state, "1", OAuthStateExpiry)
	pipe.Set(context.Background(), RedisYahooStateLogtoPrefix+state, logtoSub, OAuthStateExpiry)
	_, err := pipe.Exec(context.Background())
	if err != nil {
		log.Printf("[YahooStart] Redis pipeline failed: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Status: "error", Error: "Failed to store state"})
	}

	// Force Yahoo to show the login screen every time so the user can pick
	// the correct Yahoo account.
	authURL := a.yahooConfig.AuthCodeURL(state, oauth2.SetAuthURLParam("prompt", "login"))

	// Content negotiation: JSON for programmatic callers (desktop app),
	// 307 redirect for browser navigations.
	wantsJSON := c.Query("response") == "json" ||
		strings.Contains(strings.ToLower(c.Get(fiber.HeaderAccept)), "application/json")
	if wantsJSON {
		log.Printf("[YahooStart] Returning JSON consent URL (state=%s…) redirect_uri=%s", state[:8], a.yahooConfig.RedirectURL)
		return c.Status(fiber.StatusOK).JSON(fiber.Map{"redirect_url": authURL})
	}

	log.Printf("[YahooStart] Redirecting to Yahoo OAuth (state=%s…) redirect_uri=%s", state[:8], a.yahooConfig.RedirectURL)
	return c.Redirect(authURL, fiber.StatusTemporaryRedirect)
}

// YahooCallback handles the Yahoo OAuth callback.
// No cookies are set — the Python service owns all Yahoo token management.
// We only persist the refresh token to Postgres (encrypted) and populate
// Redis CDC subscriber sets.
func (a *App) YahooCallback(c *fiber.Ctx) error {
	state, code := c.Query("state"), c.Query("code")
	log.Printf("[YahooCallback] Hit — state=%q code_present=%v", state, code != "")

	if state == "" || code == "" {
		log.Printf("[YahooCallback] Missing state or code — state=%q code=%q", state, code)
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{Status: "error", Error: "Missing state or code"})
	}

	val, err := a.rdb.GetDel(context.Background(), RedisCSRFPrefix+state).Result()
	if err != nil || val == "" {
		log.Printf("[YahooCallback] CSRF validation failed — state=%s err=%v val=%q", state, err, val)
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{Status: "error", Error: "Invalid or expired state"})
	}
	log.Printf("[YahooCallback] CSRF validated for state=%s…", state[:8])

	// Retrieve (and atomically consume) the logto_sub associated with this
	// state. GetDel prevents replay of the same state value within the 10-
	// minute OAuth state window.
	logtoSub, err := a.rdb.GetDel(context.Background(), RedisYahooStateLogtoPrefix+state).Result()
	if err == redis.Nil {
		logtoSub = ""
		log.Printf("[YahooCallback] No logto_sub found for state=%s (expired or already consumed)", state[:8])
	} else if err != nil {
		log.Printf("[YahooCallback] Warning: Failed to retrieve logto_sub from Redis for state %s: %v", state, err)
	} else if logtoSub != "" {
		log.Printf("[YahooCallback] Retrieved logto_sub=%s for state=%s…", logtoSub, state[:8])
	}

	// Yahoo intermittently rejects the first token exchange with INVALID_REDIRECT_URI
	// even when the redirect URI is correct. Retry once after a brief delay.
	log.Printf("[YahooCallback] Exchanging code for token (redirect_uri=%s)…", a.yahooConfig.RedirectURL)
	var token *oauth2.Token
	var exchangeErr error
	for attempt := 1; attempt <= 2; attempt++ {
		token, exchangeErr = a.yahooConfig.Exchange(context.Background(), code)
		if exchangeErr == nil {
			break
		}
		if attempt == 1 && strings.Contains(exchangeErr.Error(), "INVALID_REDIRECT_URI") {
			log.Printf("[YahooCallback] Attempt %d failed with INVALID_REDIRECT_URI — retrying in 500ms", attempt)
			time.Sleep(500 * time.Millisecond)
			continue
		}
		break
	}
	if exchangeErr != nil {
		log.Printf("[YahooCallback] Token exchange failed after retries: %v", exchangeErr)
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Status: "error", Error: "Failed to exchange code"})
	}
	log.Printf("[YahooCallback] Token exchange succeeded — access_token_len=%d refresh_token_present=%v expires=%v",
		len(token.AccessToken), token.RefreshToken != "", token.Expiry)

	{
		// ALWAYS link, even without a refresh token in this response.
		//
		// This used to be gated on `token.RefreshToken != ""`, which meant
		// a response without one skipped linking entirely and STILL served
		// the success page below. Yahoo issues a refresh token on first
		// consent, and /yahoo/start sends prompt=login — a fresh login, not
		// fresh consent — so a reconnect legitimately arrives without one.
		// The result was: works the first time, silently fails forever
		// after, with the desktop app polling a row that was never written
		// until its five-minute timeout blamed Yahoo.
		//
		// fetchAndLinkYahooUser now falls back to the token already stored
		// for this Yahoo account, and returns an error when there is none —
		// so a genuine failure reaches the error page instead of being
		// reported as success.
		log.Printf("[YahooCallback] Linking Yahoo account (logto_sub=%s, refresh_token_in_response=%v)…",
			logtoSub, token.RefreshToken != "")
		linkErr := a.fetchAndLinkYahooUser(token.AccessToken, token.RefreshToken, logtoSub)
		if linkErr != nil {
			log.Printf("[YahooCallback] Failed to link Yahoo account: %v", linkErr)

			userMsg := "Yahoo authentication succeeded, but we failed to link your account. Please try again."

			html := fmt.Sprintf(`<!doctype html><html><head><meta charset="utf-8"><title>Auth Error</title></head>
				<body style="font-family: ui-sans-serif, system-ui; max-width: 420px; margin: 2rem auto; line-height: 1.5;">
				<p>%s</p>
				<script>setTimeout(function(){ window.close(); }, %d);</script>
				</body></html>`, userMsg, AuthPopupCloseDelayMs)
			c.Set("Content-Type", "text/html")
			return c.Status(fiber.StatusConflict).SendString(html)
		}
		log.Printf("[YahooCallback] Yahoo account linked successfully")
	}

	frontendURL := resolveFrontendURL()

	log.Printf("[YahooCallback] Auth complete — sending postMessage to %s and closing popup", frontendURL)
	html := fmt.Sprintf(`<!doctype html><html><head><meta charset="utf-8"><title>Auth Complete</title></head>
		<body style="font-family: ui-sans-serif, system-ui;"><script>(function() { try { if (window.opener) { window.opener.postMessage({ type: 'yahoo-auth-complete' }, '%s'); } } catch(e) { } setTimeout(function(){ window.close(); }, %d); })();</script>
		<p>Authentication successful. You can close this window.</p></body></html>`, frontendURL, AuthPopupCloseDelayMs)
	c.Set("Content-Type", "text/html")
	return c.Status(fiber.StatusOK).SendString(html)
}

// =============================================================================
// Yahoo Account Linking
// =============================================================================

// fetchAndLinkYahooUser fetches the Yahoo GUID for the given access token,
// upserts the yahoo_users row, and populates the Redis guid→user CDC set.
func (a *App) fetchAndLinkYahooUser(accessToken, refreshToken, logtoSub string) error {
	log.Printf("[fetchAndLinkYahooUser] Starting — logto_sub=%s access_token_len=%d", logtoSub, len(accessToken))

	client := &http.Client{Timeout: YahooAPITimeout}
	req, err := http.NewRequest("GET", getYahooBaseURL()+"/users;use_login=1", nil)
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)

	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("fetch Yahoo user: %w", err)
	}
	defer resp.Body.Close()

	log.Printf("[fetchAndLinkYahooUser] Yahoo API responded with status=%d", resp.StatusCode)

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("read response body: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		// Do NOT log the body — Yahoo error responses sometimes contain
		// account context (emails, GUIDs) that would leak PII to ops logs.
		log.Printf("[fetchAndLinkYahooUser] Yahoo exchange failed: status=%d", resp.StatusCode)
		return fmt.Errorf("Yahoo API returned status %d", resp.StatusCode)
	}

	var content FantasyContent
	if err := xml.Unmarshal(body, &content); err != nil {
		log.Printf("[fetchAndLinkYahooUser] XML unmarshal failed — body_len=%d body_preview=%.200s", len(body), string(body))
		return fmt.Errorf("unmarshal Yahoo response: %w", err)
	}

	if content.Users == nil || len(content.Users.User) == 0 {
		log.Printf("[fetchAndLinkYahooUser] No users in response — body_preview=%.300s", string(body))
		return fmt.Errorf("no Yahoo user found in response")
	}

	guid := content.Users.User[0].Guid
	if guid == "" {
		return fmt.Errorf("empty GUID in Yahoo response")
	}

	// Yahoo only issues a refresh token on first consent, so a reconnect
	// can arrive without one. The token already stored for this Yahoo
	// account is still valid, so reuse it rather than refusing to link.
	//
	// This has to happen HERE: after the GUID is known, and before the
	// takeover and replace-old-link branches below, either of which can
	// delete the very row the token would be read from.
	//
	// Refusing outright when there is nothing stored is deliberate — that
	// is a first-time connect that genuinely cannot be completed, and the
	// caller turns this error into the failure page rather than claiming
	// success.
	if refreshToken == "" {
		stored, storedErr := a.storedRefreshToken(guid)
		if storedErr != nil {
			return fmt.Errorf("no refresh token in the Yahoo response and none stored for guid %s: %w", guid, storedErr)
		}
		log.Printf("[fetchAndLinkYahooUser] No refresh token in response — reusing the stored one for guid=%s", guid)
		refreshToken = stored
	}

	// Use the logto_sub if available, otherwise fall back to Yahoo GUID
	logtoIdentifier := logtoSub
	if logtoIdentifier == "" {
		log.Printf("[fetchAndLinkYahooUser] No logto_sub, falling back to GUID=%s as identifier", guid)
		logtoIdentifier = guid
	}

	// If this Yahoo account is linked to a *different* Scrollr user, take over.
	// The person authenticating with Yahoo IS the account owner — they just
	// proved it via OAuth — so they should control where it's linked.
	var existingSub string
	checkErr := a.db.QueryRow(context.Background(),
		"SELECT logto_sub FROM yahoo_users WHERE guid = $1", guid,
	).Scan(&existingSub)
	if checkErr == nil && existingSub != logtoIdentifier {
		log.Printf("[fetchAndLinkYahooUser] Takeover — Yahoo GUID %s was linked to logto_sub=%s, reassigning to logto_sub=%s",
			guid, existingSub, logtoIdentifier)
		a.CleanupLeagueSubscribers(context.Background(), guid, existingSub)
		_, delErr := a.db.Exec(context.Background(),
			"DELETE FROM yahoo_users WHERE guid = $1", guid)
		if delErr != nil {
			log.Printf("[fetchAndLinkYahooUser] Warning: failed to delete old link for takeover guid=%s: %v", guid, delErr)
		}
	}

	// Clean up any *previous* Yahoo account this Scrollr user had linked.
	// Without this, connecting a new Yahoo account leaves the old yahoo_users
	// row (and its yahoo_user_leagues rows) behind, causing the dashboard to
	// show stale leagues from the old account.
	var oldGUID string
	oldErr := a.db.QueryRow(context.Background(),
		"SELECT guid FROM yahoo_users WHERE logto_sub = $1", logtoIdentifier,
	).Scan(&oldGUID)
	if oldErr == nil && oldGUID != guid {
		log.Printf("[fetchAndLinkYahooUser] Replacing old Yahoo link — old_guid=%s new_guid=%s logto_sub=%s", oldGUID, guid, logtoIdentifier)
		// Remove from Redis CDC subscriber sets before deleting DB rows
		a.CleanupLeagueSubscribers(context.Background(), oldGUID, logtoIdentifier)
		// Delete the old yahoo_users row; CASCADE removes yahoo_user_leagues rows
		_, delErr := a.db.Exec(context.Background(),
			"DELETE FROM yahoo_users WHERE guid = $1", oldGUID)
		if delErr != nil {
			log.Printf("[fetchAndLinkYahooUser] Warning: failed to delete old Yahoo link guid=%s: %v", oldGUID, delErr)
		}
	}

	log.Printf("[fetchAndLinkYahooUser] Upserting user — guid=%s logto_sub=%s", guid, logtoIdentifier)
	if err := a.UpsertYahooUser(guid, logtoIdentifier, refreshToken); err != nil {
		return fmt.Errorf("upsert Yahoo user: %w", err)
	}

	log.Printf("[Yahoo Sync] Registered user %s (Logto: %s) for active sync", guid, logtoIdentifier)

	// Restore Redis league subscriber sets for any previously-imported leagues
	if err := a.PopulateLeagueSubscribers(context.Background(), guid, logtoIdentifier); err != nil {
		log.Printf("[fetchAndLinkYahooUser] Warning: failed to populate league subscribers: %v", err)
	}

	return nil
}

// storedRefreshToken returns the decrypted refresh token already on file
// for a Yahoo account, or an error when there is none to reuse.
//
// Used when Yahoo re-authenticates a user without issuing a new refresh
// token. Reads by GUID rather than logto_sub because the GUID is the
// stable Yahoo identity — it survives the account being re-linked to a
// different Scrollr user.
func (a *App) storedRefreshToken(guid string) (string, error) {
	var encrypted string
	if err := a.db.QueryRow(context.Background(),
		"SELECT refresh_token FROM yahoo_users WHERE guid = $1", guid,
	).Scan(&encrypted); err != nil {
		return "", fmt.Errorf("look up stored refresh token: %w", err)
	}
	if encrypted == "" {
		return "", fmt.Errorf("stored refresh token is empty")
	}
	plaintext, err := Decrypt(encrypted)
	if err != nil {
		return "", fmt.Errorf("decrypt stored refresh token: %w", err)
	}
	if plaintext == "" {
		return "", fmt.Errorf("decrypted refresh token is empty")
	}
	return plaintext, nil
}

// =============================================================================
// User Management Routes
// =============================================================================

// GetYahooStatus returns whether the current user has Yahoo connected.
func (a *App) GetYahooStatus(c *fiber.Ctx) error {
	userID := GetUserSub(c)
	log.Printf("[GetYahooStatus] Hit — X-User-Sub=%q", userID)
	if userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(ErrorResponse{
			Status: "unauthorized",
			Error:  "Authentication required",
		})
	}

	var lastSync sql.NullTime
	err := a.db.QueryRow(context.Background(), `
		SELECT last_sync FROM yahoo_users WHERE logto_sub = $1
	`, userID).Scan(&lastSync)

	if err != nil {
		errStr := err.Error()
		if err == sql.ErrNoRows || strings.Contains(errStr, "no rows") {
			return c.JSON(YahooStatusResponse{Connected: false, Synced: false})
		}
		log.Printf("[GetYahooStatus] DB error for logto_sub=%s: %v", userID, err)
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Status: "error",
			Error:  "Failed to check Yahoo status",
		})
	}

	return c.JSON(YahooStatusResponse{
		Connected: true,
		Synced:    lastSync.Valid,
	})
}

// GetMyYahooLeagues returns all leagues + standings + matchups + rosters for
// the authenticated user in a single response. Uses the shared
// fetchLeagueBundleCached for efficient, cached data fetching.
func (a *App) GetMyYahooLeagues(c *fiber.Ctx) error {
	userID := GetUserSub(c)
	if userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(ErrorResponse{
			Status: "unauthorized",
			Error:  "Authentication required",
		})
	}

	// Resolve logto_sub → guid
	var guid string
	err := a.db.QueryRow(context.Background(),
		"SELECT guid FROM yahoo_users WHERE logto_sub = $1", userID).Scan(&guid)
	if err != nil {
		return c.JSON(MyLeaguesResponse{Leagues: []LeagueResponse{}})
	}

	leagues, err := a.fetchLeagueBundleCached(context.Background(), guid)
	if err != nil {
		log.Printf("[GetMyYahooLeagues] fetchLeagueBundle error: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Status: "error", Error: "Failed to fetch leagues"})
	}

	return c.JSON(MyLeaguesResponse{Leagues: leagues})
}

// DiscoverYahooLeagues discovers all Yahoo Fantasy leagues for the current
// user across all game codes and recent seasons.  Returns league metadata
// WITHOUT persisting to the database (used for the "Add Leagues" UI).
func (a *App) DiscoverYahooLeagues(c *fiber.Ctx) error {
	userID := GetUserSub(c)
	if userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(ErrorResponse{
			Status: "unauthorized",
			Error:  "Authentication required",
		})
	}

	var guid string
	err := a.db.QueryRow(context.Background(),
		"SELECT guid FROM yahoo_users WHERE logto_sub = $1", userID,
	).Scan(&guid)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(ErrorResponse{
			Status: "error",
			Error:  "Yahoo account not connected",
		})
	}

	// Fetch + decrypt refresh token
	var encryptedToken string
	err = a.db.QueryRow(context.Background(),
		"SELECT refresh_token FROM yahoo_users WHERE guid = $1", guid,
	).Scan(&encryptedToken)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Status: "error", Error: "Failed to read user token",
		})
	}

	refreshToken, err := Decrypt(encryptedToken)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Status: "error", Error: "Failed to decrypt token",
		})
	}

	clientID := os.Getenv("YAHOO_CLIENT_ID")
	clientSecret := os.Getenv("YAHOO_CLIENT_SECRET")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	client := NewYahooClient(clientID, clientSecret, refreshToken)

	// Include currentYear+1 so Yahoo-side early rollover leagues (created
	// before the calendar year ticks over) appear during discovery.
	currentYear := time.Now().Year()
	seasons := []int{currentYear + 1, currentYear, currentYear - 1}

	// Fetch leagues across all game codes concurrently
	type result struct {
		leagues []map[string]any
		err     error
	}
	ch := make(chan result, len(SupportedGameCodes)*len(seasons))

	for _, gc := range SupportedGameCodes {
		for _, s := range seasons {
			go func(gameCode string, season int) {
				leagues, err := client.GetLeagues(ctx, gameCode, season)
				ch <- result{leagues: leagues, err: err}
			}(gc, s)
		}
	}

	var allLeagues []map[string]any
	for i := 0; i < len(SupportedGameCodes)*len(seasons); i++ {
		r := <-ch
		if r.err != nil {
			log.Printf("[Discover] Game/season fetch error: %v", r.err)
			continue
		}
		allLeagues = append(allLeagues, r.leagues...)
	}

	log.Printf("[Discover] Found %d leagues for user %s", len(allLeagues), guid)

	// Persist rotated refresh token if changed
	if newToken := client.RefreshedToken(); newToken != "" && newToken != refreshToken {
		if encrypted, err := Encrypt(newToken); err == nil {
			a.updateRefreshToken(context.Background(), guid, encrypted)
		}
	}

	return c.JSON(fiber.Map{"leagues": allLeagues})
}

// ImportYahooLeague imports a single league directly via the Yahoo Fantasy API.
// Fetches league metadata, standings, matchups, and rosters, then persists
// everything to the database and populates the Redis CDC subscriber set.
func (a *App) ImportYahooLeague(c *fiber.Ctx) error {
	userID := GetUserSub(c)
	if userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(ErrorResponse{
			Status: "unauthorized",
			Error:  "Authentication required",
		})
	}

	var guid string
	err := a.db.QueryRow(context.Background(),
		"SELECT guid FROM yahoo_users WHERE logto_sub = $1", userID,
	).Scan(&guid)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(ErrorResponse{
			Status: "error",
			Error:  "Yahoo account not connected",
		})
	}

	// Parse the incoming request body
	var incoming struct {
		LeagueKey string `json:"league_key"`
		GameCode  string `json:"game_code"`
		Season    int    `json:"season"`
	}
	if err := c.BodyParser(&incoming); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Status: "error",
			Error:  "Invalid request body",
		})
	}
	if incoming.LeagueKey == "" || incoming.GameCode == "" || incoming.Season == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Status: "error",
			Error:  "league_key, game_code, and season are required",
		})
	}

	// -------------------------------------------------------------------------
	// Tier enforcement — cap on number of imported leagues per user.
	//
	// Re-importing an already-linked league does NOT count against the cap
	// (it's effectively a refresh), so we only block when the user is
	// adding a *new* league that would push them over their tier's limit.
	// -------------------------------------------------------------------------
	tier := GetUserTier(c)
	cap := FantasyLeagueCap(tier)
	if cap != -1 {
		var alreadyLinked bool
		if err := a.db.QueryRow(context.Background(),
			"SELECT EXISTS(SELECT 1 FROM yahoo_user_leagues WHERE guid = $1 AND league_key = $2)",
			guid, incoming.LeagueKey,
		).Scan(&alreadyLinked); err != nil {
			log.Printf("[Import] Failed to check existing league link for guid=%s league=%s: %v", guid, incoming.LeagueKey, err)
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
				Status: "error",
				Error:  "Failed to verify league subscription",
			})
		}
		if !alreadyLinked {
			var currentCount int
			if err := a.db.QueryRow(context.Background(),
				"SELECT count(*) FROM yahoo_user_leagues WHERE guid = $1", guid,
			).Scan(&currentCount); err != nil {
				log.Printf("[Import] Failed to count leagues for guid=%s: %v", guid, err)
				return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
					Status: "error",
					Error:  "Failed to verify league count",
				})
			}
			if currentCount >= cap {
				log.Printf("[Import] Tier cap reached — guid=%s tier=%s current=%d cap=%d", guid, tier, currentCount, cap)
				return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
					"error":   "league limit reached for your tier",
					"current": currentCount,
					"max":     cap,
					"tier":    tier,
				})
			}
		}
	}

	// Fetch + decrypt refresh token
	var encryptedToken string
	err = a.db.QueryRow(context.Background(),
		"SELECT refresh_token FROM yahoo_users WHERE guid = $1", guid,
	).Scan(&encryptedToken)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Status: "error", Error: "Failed to read user token",
		})
	}

	refreshToken, err := Decrypt(encryptedToken)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Status: "error", Error: "Failed to decrypt token",
		})
	}

	clientID := os.Getenv("YAHOO_CLIENT_ID")
	clientSecret := os.Getenv("YAHOO_CLIENT_SECRET")

	// 60s timeout for the entire import operation (multiple Yahoo API calls)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	client := NewYahooClient(clientID, clientSecret, refreshToken)

	// 1. Fetch leagues for the game/season to find the target league
	leagues, err := client.GetLeagues(ctx, incoming.GameCode, incoming.Season)
	if err != nil {
		log.Printf("[Import] GetLeagues failed for %s/%d: %v", incoming.GameCode, incoming.Season, err)
		return c.Status(fiber.StatusBadGateway).JSON(ErrorResponse{
			Status: "error", Error: "Failed to fetch leagues from Yahoo",
		})
	}

	// Find the target league by key
	var targetLeague map[string]any
	for _, l := range leagues {
		if lk, _ := l["league_key"].(string); lk == incoming.LeagueKey {
			targetLeague = l
			break
		}
	}
	if targetLeague == nil {
		return c.Status(fiber.StatusNotFound).JSON(ErrorResponse{
			Status: "error",
			Error:  fmt.Sprintf("League %s not found in %s/%d", incoming.LeagueKey, incoming.GameCode, incoming.Season),
		})
	}

	// 2. Upsert league metadata
	name, _ := targetLeague["name"].(string)
	season := fmt.Sprintf("%v", targetLeague["season"])

	if err := a.upsertLeague(ctx, incoming.LeagueKey, name, incoming.GameCode, season, targetLeague); err != nil {
		log.Printf("[Import] Failed upsert league %s: %v", incoming.LeagueKey, err)
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Status: "error", Error: "Failed to save league",
		})
	}

	// 3. Find user's team and upsert user_league
	teams, err := client.GetTeams(ctx, incoming.LeagueKey)
	if err != nil {
		log.Printf("[Import] Failed to get teams for %s: %v", incoming.LeagueKey, err)
	}
	var teamKey, teamName *string
	if teams != nil {
		teamKey, teamName = findUserTeam(teams, guid)
	}

	if err := a.upsertUserLeague(ctx, guid, incoming.LeagueKey, teamKey, teamName); err != nil {
		log.Printf("[Import] Failed upsert user_league %s/%s: %v", guid, incoming.LeagueKey, err)
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Status: "error", Error: "Failed to save user league",
		})
	}

	result := map[string]any{
		"league":    targetLeague,
		"standings": nil,
	}

	// 4. For active leagues, fetch standings, matchups, and rosters
	isFinished, _ := targetLeague["is_finished"].(bool)
	if !isFinished {
		// Standings
		standings, err := client.GetStandings(ctx, incoming.LeagueKey)
		if err != nil {
			log.Printf("[Import] Failed standings for %s: %v", incoming.LeagueKey, err)
		} else if standings != nil {
			if err := a.upsertStandings(ctx, incoming.LeagueKey, standings); err != nil {
				log.Printf("[Import] Failed upsert standings for %s: %v", incoming.LeagueKey, err)
			} else {
				result["standings"] = standings
				log.Printf("[Import] Synced standings for %s", incoming.LeagueKey)
			}
		}

		// Matchups — current week + previous week
		currentWeek := 0
		if cw, ok := targetLeague["current_week"]; ok && cw != nil {
			switch v := cw.(type) {
			case int:
				currentWeek = v
			case *int:
				if v != nil {
					currentWeek = *v
				}
			}
		}

		if currentWeek > 0 {
			weeksToSync := []int{currentWeek}
			if currentWeek > 1 {
				weeksToSync = append(weeksToSync, currentWeek-1)
			}

			for _, weekNum := range weeksToSync {
				wk, matchups, err := client.GetScoreboard(ctx, incoming.LeagueKey, weekNum)
				if err != nil {
					log.Printf("[Import] Failed matchups for %s week %d: %v", incoming.LeagueKey, weekNum, err)
					continue
				}
				if wk <= 0 {
					wk = weekNum
				}
				if matchups != nil {
					if err := a.upsertMatchups(ctx, incoming.LeagueKey, wk, matchups); err != nil {
						log.Printf("[Import] Failed upsert matchups for %s week %d: %v", incoming.LeagueKey, wk, err)
					} else {
						log.Printf("[Import] Synced %d matchups for %s week %d", len(matchups), incoming.LeagueKey, wk)
					}
				}
			}
		}

		// Rosters — all teams in the league
		if teams != nil {
			// Fetch league stat catalog (labels + modifiers) once. Labels
			// populate the frontend's authoritative display; modifiers
			// power synthetic points for H2H points leagues.
			catalog, mErr := client.GetLeagueStatCatalog(ctx, incoming.LeagueKey)
			if mErr != nil {
				log.Printf("[Import] Failed league stat catalog for %s: %v (continuing without it)", incoming.LeagueKey, mErr)
				catalog = nil
			}
			var statModifiers map[string]float64
			if catalog != nil {
				statModifiers = catalog.Modifiers
				if err := a.upsertLeagueStatCatalog(ctx, incoming.LeagueKey, catalog); err != nil {
					log.Printf("[Import] Failed to persist stat catalog for %s: %v", incoming.LeagueKey, err)
				}
			}

			// Pre-compute enabled stat IDs so the daily stats call returns
			// only league-relevant columns.
			var enabledStatIDs map[string]bool
			if catalog != nil && len(catalog.Stats) > 0 {
				enabledStatIDs = make(map[string]bool, len(catalog.Stats))
				for _, s := range catalog.Stats {
					enabledStatIDs[s.StatID] = true
				}
			}

			todayDate := todayInEastern()

			for _, team := range teams {
				// Pass currentWeek so Yahoo populates per-player points for
				// that week. Falls back to a plain roster fetch when the
				// league has no current_week available.
				roster, err := client.GetRoster(ctx, team.TeamKey, incoming.LeagueKey, team.Name, currentWeek, statModifiers)
				if err != nil {
					log.Printf("[Import] Failed roster for %s: %v", team.TeamKey, err)
					continue
				}
				// Enrich with today's stats so the Feed can render them
				// immediately after import without waiting on the next sync.
				if dailyStats, dErr := client.GetTeamDailyStats(ctx, team.TeamKey, todayDate, enabledStatIDs); dErr != nil {
					log.Printf("[Import] Failed daily stats for %s: %v", team.TeamKey, dErr)
				} else if len(dailyStats) > 0 {
					mergeDailyStatsIntoRoster(roster, dailyStats)
				}
				if err := a.upsertRoster(ctx, team.TeamKey, incoming.LeagueKey, roster); err != nil {
					log.Printf("[Import] Failed upsert roster for %s: %v", team.TeamKey, err)
				} else {
					log.Printf("[Import] Synced roster for %s (%s)", team.TeamKey, team.Name)
				}
			}
		}
	} else {
		log.Printf("[Import] League %s is finished, skipping standings/matchups/rosters", incoming.LeagueKey)
	}

	// 5. Persist rotated refresh token if changed
	if newToken := client.RefreshedToken(); newToken != "" && newToken != refreshToken {
		log.Printf("[Import] Refresh token updated for user %s, persisting...", guid)
		if encrypted, err := Encrypt(newToken); err == nil {
			a.updateRefreshToken(ctx, guid, encrypted)
		}
	}

	// 6. Update sync time
	a.updateUserSyncTime(ctx, guid)

	// 7. Add CDC subscriber and invalidate cache
	a.AddLeagueSubscriber(context.Background(), incoming.LeagueKey, userID)
	a.invalidateLeagueCache(context.Background(), guid)
	log.Printf("[Import] Complete for league %s (user %s), added CDC subscriber %s", incoming.LeagueKey, guid, userID)

	return c.JSON(result)
}

// DisconnectYahoo removes the user's Yahoo connection and all associated data,
// including Redis CDC subscriber sets.
func (a *App) DisconnectYahoo(c *fiber.Ctx) error {
	userID := GetUserSub(c)
	if userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(ErrorResponse{
			Status: "unauthorized",
			Error:  "Authentication required",
		})
	}

	// Look up the user's Yahoo GUID before deleting
	var guid string
	err := a.db.QueryRow(context.Background(),
		"SELECT guid FROM yahoo_users WHERE logto_sub = $1", userID).Scan(&guid)
	if err != nil {
		return c.JSON(fiber.Map{"status": "ok", "message": "No Yahoo account connected"})
	}

	// Clean up Redis CDC subscriber sets and cache BEFORE deleting DB rows
	// (we need the user_leagues data to know which sets to clean)
	a.CleanupLeagueSubscribers(context.Background(), guid, userID)
	a.invalidateLeagueCache(context.Background(), guid)

	// Delete from yahoo_users — cascading deletes handle leagues, standings, etc.
	_, err = a.db.Exec(context.Background(),
		"DELETE FROM yahoo_users WHERE logto_sub = $1", userID)
	if err != nil {
		log.Printf("[DisconnectYahoo] Error deleting yahoo_users: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Status: "error",
			Error:  "Failed to disconnect Yahoo account",
		})
	}

	log.Printf("[DisconnectYahoo] User %s disconnected Yahoo (GUID: %s)", userID, guid)
	return c.JSON(fiber.Map{"status": "ok", "message": "Yahoo account disconnected"})
}
