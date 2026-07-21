package platform

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
	// Cache-invalidation pipeline (events.go queueCacheInvalidation): the
	// queue holds UNIQUE users awaiting a DEL, so its depth bounds distinct
	// users per burst, not events — bursts repeat the same users and dedupe.
	SSEInvalidationWorkers   = 4
	SSEInvalidationQueueSize = 8192
)

// =============================================================================
// Topic Channel Prefixes
// =============================================================================

const (
	// Each CDC event is published to exactly one topic channel.
	// The Hub subscribes to all topic patterns and fans out in-memory.
	TopicPrefixFinance     = "cdc:finance:"     // cdc:finance:{SYMBOL}
	TopicPrefixSports      = "cdc:sports:"      // cdc:sports:{LEAGUE}
	TopicPrefixRSS         = "cdc:rss:"         // cdc:rss:{feed_url_fnv_hash}
	TopicPrefixFantasy     = "cdc:fantasy:"     // cdc:fantasy:{league_key}
	TopicPrefixPredictions = "cdc:predictions:" // cdc:predictions:all (v1 channel-wide broadcast)
	TopicPrefixCore        = "cdc:core:user:"   // cdc:core:user:{logto_sub}

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
	RedisEventsUserPrefix     = "events:user:"
	RedisDashboardCachePrefix = "cache:dashboard:"
)

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
	DefaultAllowedOrigins = "https://myscrollr.com,https://api.myscrollr.com"
	DefaultFrontendURL    = "https://myscrollr.com"
)
