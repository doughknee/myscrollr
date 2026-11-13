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

	// DBStatementTimeout is Postgres's statement_timeout on every DBPool
	// connection (RB-8): a stuck query gives its pool connection back instead
	// of holding one of the 20 for ever. The longest legitimate statements
	// (an account purge or export, the daily prune DELETEs, admin report
	// aggregates, the support backfill's per-ticket upserts) run in well under
	// a second at today's table sizes, so 60 s is generous headroom and still
	// frees a stuck connection within a minute. Migrations are not bound by
	// it: golang-migrate opens its own connection from the raw URL.
	DBStatementTimeout = 60 * time.Second
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
	TopicPrefixFinance = "cdc:finance:"   // cdc:finance:{SYMBOL}
	TopicPrefixSports  = "cdc:sports:"    // cdc:sports:{LEAGUE}
	TopicPrefixRSS     = "cdc:rss:"       // cdc:rss:{feed_url_fnv_hash}
	TopicPrefixCore    = "cdc:core:user:" // cdc:core:user:{logto_sub}

	// TopicSSEControlResubscribe carries cross-replica SSE control
	// messages (ADR-0001): payload is the logto sub whose channel config
	// changed. Every replica receives it and rebuilds that user's topic
	// subscriptions if it holds an SSE connection for them — without
	// this, only the replica that served the config-change HTTP request
	// would refresh, leaving the connection-holding replica stale.
	TopicSSEControlResubscribe = "sse:ctl:resubscribe"

	// TopicSupportAdmin carries support-pipeline events to the staff console
	// (REL-261): a draft written, a disposition decided, a hold armed, a reply
	// sent, an escalation. One channel, not one per ticket — the console is a
	// queue, every admin watching it wants every event, and there are a few an
	// hour. The payload names the ticket and the event; the page re-reads what
	// it needs rather than trusting a copy of a case to arrive intact.
	TopicSupportAdmin = "support:admin"
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
