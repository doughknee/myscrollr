// API client for the Scrollr API

export const API_BASE = import.meta.env.VITE_API_URL || ''

// ── Shared Types ──────────────────────────────────────────────────

export interface UserPreferences {
  feed_mode: 'comfort' | 'compact'
  feed_position: 'top' | 'bottom'
  feed_behavior: 'overlay' | 'push'
  feed_enabled: boolean
  enabled_sites: Array<string>
  disabled_sites: Array<string>
  subscription_tier: 'free' | 'uplink' | 'uplink_pro' | 'uplink_ultimate'
  updated_at: string
}

type RequestOptions = RequestInit

async function request<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { ...fetchOptions } = options

  const headers: HeadersInit = {
    ...options.headers,
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...fetchOptions,
    headers,
    credentials: 'include',
  })

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ error: 'Request failed' }))
    throw new Error(error.error || 'Request failed')
  }

  return response.json()
}

// Authenticated API caller - use this inside components with useLogto
export async function authenticatedFetch<T>(
  path: string,
  options: RequestInit = {},
  getToken: () => Promise<string | null>,
): Promise<T> {
  const token = await getToken()
  const headers: HeadersInit = {
    ...options.headers,
  }

  if (token) {
    ;(headers as Record<string, string>)['Authorization'] = `Bearer ${token}`
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    credentials: 'include',
  })

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ error: 'Request failed' }))
    throw new Error(error.error || 'Request failed')
  }

  return response.json()
}

// ── Tier Limits ──────────────────────────────────────────────────
//
// Source of truth lives in api/core/tier_limits.go (DefaultTierLimits).
// Null means "unlimited" for that cap.

export type TierKey =
  | 'free'
  | 'uplink'
  | 'uplink_pro'
  | 'uplink_ultimate'
  | 'super_user'

export interface ChannelLimits {
  symbols: number | null
  feeds: number | null
  custom_feeds: number | null
  leagues: number | null
  fantasy: number | null
  max_ticker_rows: number
  max_ticker_customization: boolean
}

export interface TierLimitsResponse {
  tiers: Record<TierKey, ChannelLimits>
}

export const tierLimitsApi = {
  /** Fetch tier limits from the backend. Cached by the CDN for 5 min. */
  get: () => request<TierLimitsResponse>('/tier-limits'),
}

// ── Channel Types ────────────────────────────────────────────────

export type ChannelType = 'finance' | 'sports' | 'fantasy' | 'rss'

export interface Channel {
  id: number
  channel_type: ChannelType
  enabled: boolean
  visible: boolean
  config: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface RssChannelConfig {
  feeds?: Array<{ name: string; url: string }>
}

// ── Channels API ─────────────────────────────────────────────────

export const channelsApi = {
  getAll: (getToken: () => Promise<string | null>) =>
    authenticatedFetch<{ channels: Array<Channel> }>(
      '/users/me/channels',
      {},
      getToken,
    ),

  create: (
    channelType: ChannelType,
    config: Record<string, unknown>,
    getToken: () => Promise<string | null>,
  ) =>
    authenticatedFetch<Channel>(
      '/users/me/channels',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel_type: channelType, config }),
      },
      getToken,
    ),

  update: (
    channelType: ChannelType,
    data: {
      enabled?: boolean
      visible?: boolean
      config?: Record<string, unknown>
    },
    getToken: () => Promise<string | null>,
  ) =>
    authenticatedFetch<Channel>(
      `/users/me/channels/${channelType}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      },
      getToken,
    ),

  delete: (channelType: ChannelType, getToken: () => Promise<string | null>) =>
    authenticatedFetch<{
      status: string
      message: string
    }>(`/users/me/channels/${channelType}`, { method: 'DELETE' }, getToken),
}

// ── RSS Types & API ──────────────────────────────────────────────

export interface TrackedFeed {
  url: string
  name: string
  category: string
  is_default: boolean
}

export const rssApi = {
  /** Fetch the public feed catalog (no auth required) */
  getCatalog: () => request<Array<TrackedFeed>>('/rss/feeds'),

  /** Delete a custom (non-default) feed from the catalog */
  deleteFeed: (url: string, getToken: () => Promise<string | null>) =>
    authenticatedFetch<{ status: string; message: string }>(
      '/rss/feeds',
      {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      },
      getToken,
    ),
}

// ── Preferences API ───────────────────────────────────────────────

export async function getPreferences(
  getToken: () => Promise<string | null>,
): Promise<UserPreferences> {
  return authenticatedFetch<UserPreferences>(
    '/users/me/preferences',
    {},
    getToken,
  )
}

export function updatePreferences(
  prefs: Partial<UserPreferences>,
  getToken: () => Promise<string | null>,
): Promise<UserPreferences> {
  return authenticatedFetch<UserPreferences>(
    '/users/me/preferences',
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(prefs),
    },
    getToken,
  )
}

// ── Billing Types & API ────────────────────────────────────────────

export interface CheckoutResponse {
  client_secret: string
  session_id: string
  publishable_key: string
}

export interface SubscriptionStatus {
  plan:
    | 'free'
    | 'monthly'
    | 'annual'
    | 'lifetime'
    | 'pro_monthly'
    | 'pro_annual'
    | 'ultimate_monthly'
    | 'ultimate_annual'
  status: 'none' | 'active' | 'trialing' | 'canceling' | 'canceled' | 'past_due'
  current_period_end?: string
  lifetime: boolean
  pending_downgrade_plan?: string
  scheduled_change_at?: string
  amount?: number
  currency?: string
  interval?: string
  trial_end?: number
  had_prior_sub: boolean
}

export interface CheckoutReturnStatus {
  status: string
  session_id?: string
}

export interface SetupIntentResponse {
  client_secret: string
  plan: string
  has_trial: boolean
  trial_days: number
  amount: number
  currency: string
  interval: string
  publishable_key: string
}

export interface SubscribeResponse {
  subscription_id: string
  status: string
  trial_end?: number
  plan: string
}

export interface PaymentIntentResponse {
  client_secret: string
  amount: number
  currency: string
  publishable_key: string
}

export const billingApi = {
  /** Create a subscription checkout session (monthly/annual) */
  createCheckoutSession: (
    priceId: string,
    getToken: () => Promise<string | null>,
  ) =>
    authenticatedFetch<CheckoutResponse>(
      '/checkout/session',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ price_id: priceId }),
      },
      getToken,
    ),

  /** Create a lifetime checkout session */
  createLifetimeCheckout: (getToken: () => Promise<string | null>) =>
    authenticatedFetch<CheckoutResponse>(
      '/checkout/lifetime',
      { method: 'POST' },
      getToken,
    ),

  /** Create a SetupIntent for subscription checkout (PaymentElement flow) */
  createSetupIntent: (
    priceId: string,
    getToken: () => Promise<string | null>,
  ) =>
    authenticatedFetch<SetupIntentResponse>(
      '/checkout/setup-intent',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ price_id: priceId }),
      },
      getToken,
    ),

  /** Confirm subscription after SetupIntent is confirmed */
  confirmSubscription: (
    setupIntentId: string,
    priceId: string,
    getToken: () => Promise<string | null>,
  ) =>
    authenticatedFetch<SubscribeResponse>(
      '/checkout/subscribe',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          setup_intent_id: setupIntentId,
          price_id: priceId,
        }),
      },
      getToken,
    ),

  /** Create a PaymentIntent for lifetime purchase (PaymentElement flow) */
  createPaymentIntent: (getToken: () => Promise<string | null>) =>
    authenticatedFetch<PaymentIntentResponse>(
      '/checkout/payment-intent',
      { method: 'POST' },
      getToken,
    ),

  /** Get checkout session return status */
  getCheckoutReturn: (
    sessionId: string,
    getToken: () => Promise<string | null>,
  ) =>
    authenticatedFetch<CheckoutReturnStatus>(
      `/checkout/return?session_id=${sessionId}`,
      {},
      getToken,
    ),

  /** Get current subscription status */
  getSubscription: (getToken: () => Promise<string | null>) =>
    authenticatedFetch<SubscriptionStatus>(
      '/users/me/subscription',
      {},
      getToken,
    ),

  /** Preview the proration cost of a plan change */
  previewPlanChange: (
    priceId: string,
    getToken: () => Promise<string | null>,
  ) =>
    authenticatedFetch<{
      amount_due: number
      currency: string
      proration_date: number
      is_downgrade: boolean
      scheduled_date: number
      is_trial_change?: boolean
      trial_end?: number
    }>(
      `/users/me/subscription/preview?price_id=${encodeURIComponent(priceId)}`,
      {},
      getToken,
    ),

  /** Change subscription plan (upgrade/downgrade with proration) */
  changePlan: (
    priceId: string,
    prorationDate: number,
    getToken: () => Promise<string | null>,
  ) =>
    authenticatedFetch<SubscriptionStatus>(
      '/users/me/subscription/plan',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          price_id: priceId,
          proration_date: prorationDate,
        }),
      },
      getToken,
    ),

  /** Cancel subscription at period end */
  cancelSubscription: (getToken: () => Promise<string | null>) =>
    authenticatedFetch<{
      status: string
      current_period_end: string
      message: string
    }>('/users/me/subscription/cancel', { method: 'POST' }, getToken),

  /** Create a Stripe Customer Portal session */
  createPortalSession: (getToken: () => Promise<string | null>) =>
    authenticatedFetch<{ url: string }>(
      '/users/me/subscription/portal',
      { method: 'POST' },
      getToken,
    ),
}

// ── User Overview API ─────────────────────────────────────────────
//
// Single round-trip read shape for the /account hub. Replaces the
// fan-out across claims + channels + deletion-status. Live billing
// detail (Amount/Interval/TrialEnd) is returned in `subscription` when
// the DB has it cached, but components that render those exact fields
// should keep using billingApi.getSubscription (which is Stripe-backed
// and authoritative). Backed server-side by a 30s Redis cache and
// invalidation hooks on every mutating endpoint that touches this shape.

export interface UserOverviewIdentity {
  sub: string
  email: string
  name: string
  username: string
}

export interface UserOverviewTier {
  current: string
  is_super_user: boolean
  label: string
  limits: ChannelLimits
}

export interface UserOverviewChannelRow {
  type: ChannelType
  enabled: boolean
  visible: boolean
}

export interface UserOverviewChannels {
  total: number
  enabled: number
  by_type: Array<UserOverviewChannelRow>
}

export interface UserOverviewFantasy {
  yahoo_connected: boolean
  yahoo_synced: boolean
  league_count: number
}

export interface UserOverviewGDPR {
  deletion_status: 'none' | 'pending' | 'canceled' | 'purged'
  requested_at: string | null
  purge_at: string | null
}

export interface UserOverviewLinks {
  logto_account: string
}

export interface UserOverview {
  identity: UserOverviewIdentity
  tier: UserOverviewTier
  subscription: SubscriptionStatus | null
  channels: UserOverviewChannels
  fantasy: UserOverviewFantasy | null
  gdpr: UserOverviewGDPR
  links: UserOverviewLinks
}

export const userApi = {
  /** Unified read for the /account hub — identity, tier, channels, GDPR, fantasy. */
  overview: (getToken: () => Promise<string | null>) =>
    authenticatedFetch<UserOverview>('/users/me/overview', {}, getToken),
}

// ── Invite API ───────────────────────────────────────────────────

export interface CompleteInviteRequest {
  email: string
  token: string
  password: string
  birthday: string
  gender: string
  username: string
  first_name: string
  last_name: string
}

export interface CompleteInviteResponse {
  success: boolean
  username: string
}

export interface CheckUsernameResponse {
  available: boolean
  reason?: 'invalid' | 'taken'
}

export const inviteApi = {
  completeInvite: (data: CompleteInviteRequest) =>
    request<CompleteInviteResponse>('/invite/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),

  checkUsernameAvailable: (email: string, username: string) =>
    request<CheckUsernameResponse>(
      `/invite/username-available?email=${encodeURIComponent(email)}&username=${encodeURIComponent(username)}`,
    ),
}

// ── Support API ───────────────────────────────────────────────────
//
// Two endpoints, identical wire shape:
//   - /support/ticket          (LogtoAuth required)
//   - /support/ticket/public   (anonymous, per-IP rate-limited 5/hour)
//
// The marketing site contact form picks the right one based on whether
// the visitor is signed in. Anonymous tickets MUST include `email` so
// support can reply; authenticated tickets carry it implicitly via the
// JWT but we send it anyway for forwards-compatibility with OS Ticket.

export type SupportCategory = 'bug' | 'feature' | 'billing' | 'feedback'

export interface SupportTicketPayload {
  email: string
  category: SupportCategory
  subject: string
  message: string
  name?: string
}

export interface SupportTicketResponse {
  status: string
  message: string
}

export const supportApi = {
  /** Submit a ticket as an authenticated user. Token required. */
  submitTicket: (
    payload: SupportTicketPayload,
    getToken: () => Promise<string | null>,
  ) =>
    authenticatedFetch<SupportTicketResponse>(
      '/support/ticket',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
      getToken,
    ),

  /**
   * Submit a ticket anonymously. Per-IP rate-limited (5/hour) on the
   * server. Throws on validation/transport failure.
   */
  submitTicketPublic: (payload: SupportTicketPayload) =>
    request<SupportTicketResponse>('/support/ticket/public', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
}

// ── GDPR Account Export + Delete ──────────────────────────────────
//
// 30-day soft-delete grace window. Users can cancel from the Account
// page at any point before the purge runs. Export returns a JSON
// download with everything we store about the user, minus security-
// sensitive tokens and server-internal IDs.

export type AccountDeletionStatus =
  | { status: 'none' }
  | {
      status: 'pending'
      requested_at: string
      purge_at: string
      canceled_at?: string
      purged_at?: string
    }
  | {
      status: 'canceled'
      requested_at: string
      purge_at: string
      canceled_at: string
      purged_at?: string
    }
  | {
      status: 'purged'
      requested_at: string
      purge_at: string
      canceled_at?: string
      purged_at: string
    }

export interface RequestDeletionResponse {
  status: 'pending'
  requested_at: string
  purge_at: string
}

export const gdprApi = {
  /**
   * Fetch and trigger browser download of a user-data archive.
   * Resolves once the blob is saved; rejects on network / auth error.
   */
  exportData: async (getToken: () => Promise<string | null>) => {
    const token = await getToken()
    const response = await fetch(`${API_BASE}/users/me/export`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      credentials: 'include',
    })
    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ error: 'Export failed' }))
      throw new Error(error.error || 'Export failed')
    }
    const blob = await response.blob()
    // Infer filename from Content-Disposition; fall back to a sensible default.
    const disposition = response.headers.get('Content-Disposition') || ''
    const match = disposition.match(/filename="?([^";]+)"?/)
    const filename = match?.[1] ?? `myscrollr-export-${Date.now()}.json`
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  },

  /** Schedule account deletion (30-day grace period). */
  requestDeletion: (getToken: () => Promise<string | null>) =>
    authenticatedFetch<RequestDeletionResponse>(
      '/users/me/delete',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: 'DELETE MY ACCOUNT' }),
      },
      getToken,
    ),

  /** Cancel a pending deletion request. */
  cancelDeletion: (getToken: () => Promise<string | null>) =>
    authenticatedFetch<{ status: 'canceled'; canceled_at: string }>(
      '/users/me/delete/cancel',
      { method: 'POST' },
      getToken,
    ),

  /** Current deletion request state — drives the pending banner. */
  getDeletionStatus: (getToken: () => Promise<string | null>) =>
    authenticatedFetch<AccountDeletionStatus>(
      '/users/me/delete/status',
      {},
      getToken,
    ),
}
