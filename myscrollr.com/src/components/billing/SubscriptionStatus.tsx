import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import {
  AlertTriangle,
  ArrowRight,
  Calendar,
  CreditCard,
  Crown,
  Infinity as InfinityIcon,
  Loader2,
  ShieldAlert,
  Sparkles,
  Zap,
} from 'lucide-react'
import type { SubscriptionStatus as SubStatus } from '@/api/client'
import { billingApi, getPreferences } from '@/api/client'

interface SubscriptionStatusProps {
  getToken: () => Promise<string | null>
  /** Optional tier hint from the parent's overview fetch — short-circuits
   *  the internal `getPreferences` round-trip when supplied. */
  tier?: string
}

const PLAN_LABELS: Record<string, string> = {
  free: 'Free',
  monthly: 'Monthly',
  annual: 'Annual',
  lifetime: 'Lifetime',
  pro_monthly: 'Monthly',
  pro_annual: 'Annual',
  ultimate_monthly: 'Monthly',
  ultimate_annual: 'Annual',
}

const PLAN_PRICES: Record<string, string> = {
  monthly: '$9.99/mo',
  annual: '$79.99/yr',
  pro_monthly: '$24.99/mo',
  pro_annual: '$199.99/yr',
  ultimate_monthly: '$49.99/mo',
  ultimate_annual: '$399.99/yr',
  lifetime: '$999 one-time',
}

const DOWNGRADE_PLAN_NAMES: Record<string, string> = {
  monthly: 'Uplink',
  annual: 'Uplink',
  pro_monthly: 'Uplink Pro',
  pro_annual: 'Uplink Pro',
  ultimate_monthly: 'Uplink Ultimate',
  ultimate_annual: 'Uplink Ultimate',
}

const STATUS_LABELS: Partial<Record<string, { label: string; color: string }>> =
  {
    none: { label: 'No Subscription', color: 'text-base-subtle' },
    active: { label: 'Active', color: 'text-success-ink' },
    canceling: { label: 'Canceling', color: 'text-warning-ink' },
    canceled: { label: 'Canceled', color: 'text-error-ink' },
    past_due: { label: 'Past Due', color: 'text-error-ink' },
    trialing: { label: 'Free Trial', color: 'text-info' },
  }

export default function SubscriptionStatus({
  getToken,
  tier: tierProp,
}: SubscriptionStatusProps) {
  const [subscription, setSubscription] = useState<SubStatus | null>(null)
  const [tier, setTier] = useState<string>(tierProp ?? 'free')
  const [loading, setLoading] = useState(true)
  const [canceling, setCanceling] = useState(false)
  const [openingPortal, setOpeningPortal] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showCancelModal, setShowCancelModal] = useState(false)

  const isUltimate =
    tier === 'uplink_ultimate' ||
    subscription?.plan === 'ultimate_monthly' ||
    subscription?.plan === 'ultimate_annual'
  const isPro =
    tier === 'uplink_pro' ||
    subscription?.plan === 'pro_monthly' ||
    subscription?.plan === 'pro_annual'

  // Re-runs when the parent passes a new tier hint (e.g. once the
  // overview fetch settles). loadSubscription is intentionally not in
  // the deps array — it's stable per render and capturing it would
  // cause an infinite refetch loop.
  useEffect(() => {
    loadSubscription()
    if (tierProp) setTier(tierProp)
  }, [tierProp])

  async function loadSubscription() {
    try {
      setLoading(true)
      // Skip the prefs round-trip when the parent already supplied a tier.
      const [sub, prefs] = await Promise.all([
        billingApi.getSubscription(getToken),
        tierProp
          ? Promise.resolve(null)
          : getPreferences(getToken).catch(() => null),
      ])
      setSubscription(sub)
      if (prefs?.subscription_tier) setTier(prefs.subscription_tier)
    } catch {
      setError('Failed to load subscription')
    } finally {
      setLoading(false)
    }
  }

  async function handleOpenPortal() {
    try {
      setOpeningPortal(true)
      const { url } = await billingApi.createPortalSession(getToken)
      window.location.href = url
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to open billing portal',
      )
      setOpeningPortal(false)
    }
  }

  async function handleConfirmCancel() {
    try {
      setCanceling(true)
      setShowCancelModal(false)
      await billingApi.cancelSubscription(getToken)
      await loadSubscription()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel')
    } finally {
      setCanceling(false)
    }
  }

  const isTrialing = subscription?.status === 'trialing'

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-6">
        <Loader2 size={16} className="animate-spin text-base-subtle" />
        <span className="text-sm text-base-subtle">
          Loading subscription...
        </span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 py-6">
        <AlertTriangle size={16} className="text-error-ink" />
        <span className="text-sm text-error-ink">{error}</span>
      </div>
    )
  }

  // Super users get a dedicated card — no upgrade/cancel CTAs, no tie
  // to a Stripe subscription. The tier is granted via Logto role and
  // unlocks every cap the system enforces.
  if (tier === 'super_user') {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Sparkles size={16} className="text-success-ink" />
          <span className="text-sm font-semibold text-success-ink">Super User</span>
        </div>
        <p className="text-sm text-base-subtle leading-relaxed">
          You have full access to every feature as a thank-you for early-access
          testing. No subscription required.
        </p>
      </div>
    )
  }

  if (!subscription || subscription.plan === 'free') {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Crown size={16} className="text-base-subtle" />
          <span className="text-sm font-semibold text-base-subtle">
            Free Tier
          </span>
        </div>
        <p className="text-sm text-base-subtle">
          Upgrade to Uplink for more widget slots, or Uplink Ultimate for
          unlimited widgets.
        </p>
      </div>
    )
  }

  const statusInfo = STATUS_LABELS[subscription.status] ??
    STATUS_LABELS.none ?? { label: 'Unknown', color: 'text-base-subtle' }
  const periodEnd = subscription.current_period_end
    ? new Date(subscription.current_period_end)
    : null

  // Compute trial days once
  const trialDays =
    subscription.status === 'trialing' && subscription.trial_end
      ? Math.max(
          0,
          Math.ceil((subscription.trial_end * 1000 - Date.now()) / 86_400_000),
        )
      : null

  return (
    <div
      className={`space-y-4 ${isUltimate ? 'unlimited-glow rounded-xl p-4 -m-4' : ''}`}
      style={
        isUltimate
          ? {
              background: 'rgba(52, 211, 153, 0.03)',
              borderColor: 'rgba(52, 211, 153, 0.15)',
            }
          : undefined
      }
    >
      {/* Plan + Status */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Crown
            size={16}
            className={
              isUltimate
                ? 'text-primary unlimited-dot-glow rounded-full'
                : 'text-primary'
            }
          />
          <span
            className={`text-sm font-semibold text-primary ${isUltimate ? 'unlimited-text-glow' : ''}`}
          >
            {isUltimate ? 'Uplink Ultimate' : isPro ? 'Uplink Pro' : 'Uplink'}{' '}
            {PLAN_LABELS[subscription.plan] || subscription.plan}
          </span>
        </div>
        <span
          className={`text-xs font-semibold uppercase tracking-wide ${statusInfo.color}`}
        >
          {statusInfo.label}
        </span>
      </div>

      {/* Billing Price */}
      {PLAN_PRICES[subscription.plan] && (
        <div className="flex items-center gap-2">
          <CreditCard size={14} className="text-base-subtle" />
          <span className="text-sm text-base-muted">
            {PLAN_PRICES[subscription.plan]}
            {subscription.plan.includes('monthly')
              ? ' · Monthly billing'
              : subscription.plan.includes('annual')
                ? ' · Annual billing'
                : ''}
            {subscription.status === 'trialing' && subscription.trial_end
              ? ` starting ${new Date(subscription.trial_end * 1000).toLocaleDateString()}`
              : ''}
          </span>
        </div>
      )}

      {/* Trial: full Ultimate access + days remaining (consolidated) */}
      {subscription.status === 'trialing' && (
        <div className="flex items-center gap-2 py-2.5 px-3 bg-info/5 border border-info/15 rounded-lg">
          <Zap size={14} className="text-info shrink-0" />
          <span className="text-xs text-base-muted">
            Your trial includes full{' '}
            <span className="font-semibold text-base-muted">
              Uplink Ultimate
            </span>{' '}
            access
            {trialDays !== null && (
              <>
                {' '}
                ·{' '}
                <span className="font-medium text-info">
                  {trialDays} day{trialDays !== 1 ? 's' : ''} remaining
                </span>
              </>
            )}
          </span>
        </div>
      )}

      {/* Period End / Lifetime */}
      {subscription.lifetime ? (
        <div className="flex items-center gap-2">
          <InfinityIcon size={14} className="text-base-subtle" />
          <span className="text-sm text-base-subtle">
            Lifetime access — no expiration
          </span>
        </div>
      ) : subscription.status === 'canceled' ? (
        <div className="flex items-center gap-2">
          <Calendar size={14} className="text-base-subtle" />
          <span className="text-sm text-base-subtle">
            Your subscription has ended. Resubscribe to restore your plan.
          </span>
        </div>
      ) : periodEnd ? (
        <div className="flex items-center gap-2">
          <Calendar size={14} className="text-base-subtle" />
          <span className="text-sm text-base-subtle">
            {subscription.status === 'canceling'
              ? `Access until ${periodEnd.toLocaleDateString()}`
              : subscription.status === 'trialing'
                ? `Trial ends ${periodEnd.toLocaleDateString()}`
                : `Renews ${periodEnd.toLocaleDateString()}`}
          </span>
        </div>
      ) : null}

      {/* Pending Downgrade Notice */}
      {subscription.pending_downgrade_plan &&
        subscription.scheduled_change_at && (
          <div className="flex items-center gap-2 py-2.5 px-3 bg-warning/5 border border-warning/15 rounded-lg">
            <AlertTriangle size={14} className="text-warning-ink shrink-0" />
            <span className="text-xs text-base-muted">
              Switching to{' '}
              <span className="font-semibold text-base-muted">
                {DOWNGRADE_PLAN_NAMES[subscription.pending_downgrade_plan] ||
                  subscription.pending_downgrade_plan}
              </span>{' '}
              on{' '}
              {new Date(subscription.scheduled_change_at).toLocaleDateString(
                'en-US',
                {
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                },
              )}{' '}
              · your current plan remains active until then.
            </span>
          </div>
        )}

      {/* Past Due Warning */}
      {subscription.status === 'past_due' && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-error/10 border border-error/20">
          <AlertTriangle size={14} className="text-error-ink shrink-0" />
          <span className="text-xs text-error-ink">
            Your payment failed. Update your payment method to avoid service
            interruption.
          </span>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        {/* Past due: update payment */}
        {subscription.status === 'past_due' && !subscription.lifetime && (
          <button
            onClick={handleOpenPortal}
            disabled={openingPortal}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold border border-error/30 rounded-lg
                       text-error-ink hover:bg-error/10 transition-colors disabled:opacity-50"
          >
            <CreditCard size={12} />
            {openingPortal ? 'Opening...' : 'Update Payment Method'}
          </button>
        )}

        {/* Active / Trialing: manage, change plan, cancel */}
        {(subscription.status === 'active' ||
          subscription.status === 'trialing') &&
          !subscription.lifetime && (
            <>
              <button
                onClick={handleOpenPortal}
                disabled={openingPortal}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold border border-base-content/10 rounded-lg
                         text-base-subtle hover:text-primary hover:border-primary/30 transition-colors disabled:opacity-50"
              >
                <CreditCard size={12} />
                {openingPortal ? 'Opening...' : 'Manage Subscription'}
              </button>
              <Link
                to="/uplink"
                search={{ session_id: undefined }}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold border border-base-content/10 rounded-lg
                         text-base-subtle hover:text-primary hover:border-primary/30 transition-colors"
              >
                Change Plan <ArrowRight size={12} />
              </Link>
              <button
                onClick={() => setShowCancelModal(true)}
                disabled={canceling}
                className="flex-1 py-2.5 text-xs font-semibold border border-base-content/10 rounded-lg
                         text-base-subtle hover:text-error-ink hover:border-error/30 transition-colors disabled:opacity-50"
              >
                {canceling
                  ? 'Canceling...'
                  : isTrialing
                    ? 'Cancel Trial'
                    : 'Cancel Subscription'}
              </button>
            </>
          )}

        {/* Canceling: manage (to resume) + change plan */}
        {subscription.status === 'canceling' && !subscription.lifetime && (
          <>
            <button
              onClick={handleOpenPortal}
              disabled={openingPortal}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold border border-base-content/10 rounded-lg
                         text-base-subtle hover:text-primary hover:border-primary/30 transition-colors disabled:opacity-50"
            >
              <CreditCard size={12} />
              {openingPortal ? 'Opening...' : 'Resume Subscription'}
            </button>
            <Link
              to="/uplink"
              search={{ session_id: undefined }}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold border border-base-content/10 rounded-lg
                         text-base-subtle hover:text-primary hover:border-primary/30 transition-colors"
            >
              Change Plan <ArrowRight size={12} />
            </Link>
          </>
        )}

        {/* Canceled: resubscribe */}
        {subscription.status === 'canceled' && !subscription.lifetime && (
          <Link
            to="/uplink"
            search={{ session_id: undefined }}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold border border-primary/30 rounded-lg
                       text-primary hover:bg-primary/10 transition-colors"
          >
            <Crown size={12} />
            Resubscribe <ArrowRight size={12} />
          </Link>
        )}
      </div>

      {/* ── Cancel Retention Modal ──────────────────────────── */}
      {showCancelModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="relative w-full max-w-sm mx-4 bg-base-200 border border-base-content/10 rounded-xl p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-error/10 flex items-center justify-center">
                <ShieldAlert size={20} className="text-error-ink" />
              </div>
              <h3 className="text-sm font-semibold text-base-muted">
                {isTrialing
                  ? 'Cancel your free trial?'
                  : 'Cancel your subscription?'}
              </h3>
            </div>

            <div className="space-y-3 text-xs text-base-muted leading-relaxed">
              {isTrialing ? (
                <>
                  <p>
                    If you cancel now, you&apos;ll lose access to all premium
                    features immediately &mdash; including your extra widget
                    slots and Uplink Ultimate access.
                  </p>
                  <p className="font-semibold text-base-muted">
                    This is the only free trial offered per account. Once
                    canceled, you&apos;ll need to purchase a paid plan to access
                    premium features again.
                  </p>
                  <p>
                    Your card has not been charged and won&apos;t be if you
                    cancel.
                  </p>
                </>
              ) : (
                <>
                  <p>
                    You&apos;ll keep access until the end of your current
                    billing period, then your account will revert to the Free
                    plan.
                  </p>
                  <p>
                    On the Free plan, you&apos;ll be limited to 3 widgets at
                    once &mdash; your newest widgets over the cap are switched
                    off, never deleted.
                  </p>
                </>
              )}
            </div>

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setShowCancelModal(false)}
                className="flex-1 py-2.5 text-xs font-semibold border border-primary/30 rounded-lg
                           text-primary hover:bg-primary/10 transition-colors"
              >
                {isTrialing ? 'Keep My Trial' : 'Keep My Plan'}
              </button>
              <button
                onClick={handleConfirmCancel}
                className="flex-1 py-2.5 text-xs font-semibold border border-error/30 rounded-lg
                           text-error-ink hover:text-error-ink hover:bg-error/10 transition-colors"
              >
                {isTrialing ? 'Cancel Trial' : 'Cancel Subscription'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
