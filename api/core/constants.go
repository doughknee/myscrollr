package core

import "time"

// =============================================================================
// Auth (JWKS)
// =============================================================================

const (
	JWKSRefreshInterval  = time.Hour
	JWKSRefreshRateLimit = 5 * time.Minute
	JWKSRefreshTimeout   = 10 * time.Second
)

// =============================================================================
// HTTP Timeouts
// =============================================================================

const (
	HealthCheckTimeout = 2 * time.Second
	LogtoProxyTimeout  = 10 * time.Second
)

// =============================================================================
// Database Pool
// =============================================================================

const (
	DBMaxConns        = 20
	DBMinConns        = 2
	DBMaxConnIdleTime = 30 * time.Minute
	DBMaxRetries      = 5
	DBRetryDelay      = 2 * time.Second
)

// =============================================================================
// SSE
// =============================================================================

const (
	SSEHeartbeatInterval = 15 * time.Second
	SSERetryIntervalMs   = 3000
	SSEClientBufferSize  = 100
	SSEDispatchWorkers   = 8
	SSEDispatchQueueSize = 4096
)

// =============================================================================
// Topic Channel Prefixes
// =============================================================================

const (
	// Each CDC event is published to exactly one topic channel.
	// The Hub subscribes to all topic patterns and fans out in-memory.
	TopicPrefixFinance = "cdc:finance:"   // cdc:finance:{SYMBOL}
	TopicPrefixSports  = "cdc:sports:"    // cdc:sports:{LEAGUE}
	TopicPrefixRSS     = "cdc:rss:"       // cdc:rss:{feed_url_fnv_hash}
	TopicPrefixFantasy = "cdc:fantasy:"   // cdc:fantasy:{league_key}
	TopicPrefixCore    = "cdc:core:user:" // cdc:core:user:{logto_sub}

	// TopicSSEControlResubscribe carries cross-replica SSE control
	// messages (ADR-0001): payload is the logto sub whose channel config
	// changed. Every replica receives it and rebuilds that user's topic
	// subscriptions if it holds an SSE connection for them — without
	// this, only the replica that served the config-change HTTP request
	// would refresh, leaving the connection-holding replica stale.
	TopicSSEControlResubscribe = "sse:ctl:resubscribe"
)

// =============================================================================
// Rate Limiting
// =============================================================================

const (
	RateLimitMax        = 120
	RateLimitExpiration = 1 * time.Minute

	// Stricter rate limit for OAuth initiation endpoints to prevent abuse.
	// 10 attempts per 5 minutes per IP is generous for legitimate users
	// but blocks automated abuse.
	OAuthRateLimitMax        = 10
	OAuthRateLimitExpiration = 5 * time.Minute
)

// =============================================================================
// Redis Key Prefixes
// =============================================================================

const (
	RedisChannelSubscribersPrefix = "channel:subscribers:"
	RedisEventsUserPrefix         = "events:user:"
	RedisDashboardCachePrefix     = "cache:dashboard:"

	// SportsLeagueSubscribersPrefix is the per-league subscriber set prefix.
	// Keys: sports:subscribers:league:{NFL}, sports:subscribers:league:{NBA}, etc.
	// Used by the core API for subscriber management and the sports channel for
	// per-league CDC fan-out routing.
	SportsLeagueSubscribersPrefix = "sports:subscribers:league:"
)

// SportsLeagues was a hardcoded list of league identifiers used before per-user
// league subscriptions were added. League lists are now read from the user's
// channel config JSONB (config.leagues). This variable is kept only as a
// reference for the league name values the Rust ingestion service writes to the
// games table's `league` column.
//
// Current leagues: NFL, NCAA Football, NBA, NCAA Basketball, NHL, MLB,
// Premier League, La Liga, MLS, Champions League, Formula 1

// =============================================================================
// Dashboard Cache
// =============================================================================

const (
	DashboardCacheTTL = 30 * time.Second
	HealthCacheTTL    = 10 * time.Second
	HealthCacheKey    = "cache:health"
)

// =============================================================================
// Billing / Stripe
// =============================================================================

const (
	// Logto M2M token is cached and refreshed before expiry.
	LogtoM2MTokenBufferSecs = 60
	LogtoM2MTokenTimeout    = 10 * time.Second

	// Stripe webhook signature tolerance.
	StripeWebhookTolerance = 300 // seconds
)

// =============================================================================
// Miscellaneous
// =============================================================================

const (
	HSTSMaxAge            = 5184000
	DefaultPort           = "8080"
	DefaultAllowedOrigins = "https://myscrollr.com,https://api.myscrollr.relentnet.dev"
	DefaultFrontendURL    = "https://myscrollr.com"
)
