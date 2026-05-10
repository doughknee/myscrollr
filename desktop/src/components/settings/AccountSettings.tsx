import { useState, useCallback, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-shell";
import { toast } from "sonner";
import { Check, KeyRound, Loader2, Trash2, AlertTriangle } from "lucide-react";
import { TIER_LABELS, getUserIdentity } from "../../auth";
import {
  authFetch,
  requestPasswordReset,
  updateProfile,
} from "../../api/client";
import { queryKeys, userOverviewQueryOptions } from "../../api/queries";
import { TIER_LIMITS, isUnlimited, type NumericLimitKey } from "../../tierLimits";
import type { SubscriptionTier } from "../../auth";
import type { SubscriptionInfo } from "../../api/client";
import { Section, DisplayRow, ActionRow } from "./SettingsControls";
import AccountExportButton from "./AccountExportButton";
import ProfileField from "./ProfileField";
import ConfirmDialog from "../ConfirmDialog";

// ── Types ───────────────────────────────────────────────────────

interface AccountSettingsProps {
  authenticated: boolean;
  tier: SubscriptionTier;
  subscriptionInfo: SubscriptionInfo | null;
  onLogin: () => void;
  onLogout: () => void;
  /**
   * Reset all local preferences. Lives at the end of the Account tab
   * (post-IA-refactor) since it's a destructive admin action that
   * belongs alongside sign-out and data export.
   */
  onResetAll: () => void;
}

// ── Status helpers ──────────────────────────────────────────────

const STATUS_CONFIG: Record<
  string,
  { label: string; color: string; bg: string }
> = {
  none: { label: "No subscription", color: "text-fg-4", bg: "bg-fg-4/10" },
  active: { label: "Active", color: "text-success", bg: "bg-success/10" },
  trialing: { label: "Free Trial", color: "text-info", bg: "bg-info/10" },
  canceling: { label: "Canceling", color: "text-warn", bg: "bg-warn/10" },
  canceled: { label: "Canceled", color: "text-error", bg: "bg-error/10" },
  past_due: { label: "Past Due", color: "text-error", bg: "bg-error/10" },
};

function formatAmount(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: 2,
  }).format(amount / 100);
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function trialDaysRemaining(trialEnd: number): number {
  return Math.max(0, Math.ceil((trialEnd * 1000 - Date.now()) / 86_400_000));
}

// ── Component ───────────────────────────────────────────────────

export default function AccountSettings({
  authenticated,
  tier,
  subscriptionInfo: sub,
  onLogin,
  onLogout,
  onResetAll,
}: AccountSettingsProps) {
  const [openingPortal, setOpeningPortal] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);
  const [resetState, setResetState] = useState<
    "idle" | "sending" | "sent"
  >("idle");
  // Phase 1 (Apr 26): sign-out used to be one-click. Reset, channel
  // delete, and other destructive actions all confirm — sign-out
  // shouldn't be the odd one out, especially given how disruptive
  // the post-logout state is (loses ticker SSE, drops cached data,
  // free tier reset). We gate on a ConfirmDialog with copy that
  // names the consequences.
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [confirmResetAll, setConfirmResetAll] = useState(false);
  const identity = authenticated ? getUserIdentity() : null;
  const userLabel = identity?.email ?? identity?.name ?? null;
  const queryClient = useQueryClient();

  // Aggregated overview: channels count, fantasy summary, GDPR state.
  // Only fires when authenticated; query is cheap (cached server-side, 30s stale).
  const { data: overview } = useQuery({
    ...userOverviewQueryOptions(),
    enabled: authenticated,
  });

  const handleProfileSave = useCallback(
    async (payload: { name?: string; email?: string }, label: string) => {
      await updateProfile(payload);
      // Force a refetch so the new value lands in the UI immediately
      // — the server-side overview cache was already invalidated by
      // the handler, so this hits a fresh read.
      await queryClient.invalidateQueries({ queryKey: queryKeys.userOverview });
      toast.success(`${label} updated`);
    },
    [queryClient],
  );

  const handleSendReset = useCallback(async () => {
    try {
      setResetState("sending");
      await requestPasswordReset();
      setResetState("sent");
      toast.success("Password reset email sent");
    } catch (err) {
      setResetState("idle");
      toast.error(
        err instanceof Error
          ? err.message
          : "Failed to send password reset email",
      );
    }
  }, []);

  // Clear the "Email sent" sticky state after 30s so the user can re-trigger
  // a reset if they didn't receive it. The button stays disabled while
  // we're showing the confirmation, then snaps back to "Send reset email".
  useEffect(() => {
    if (resetState !== "sent") return;
    const timer = setTimeout(() => setResetState("idle"), 30_000);
    return () => clearTimeout(timer);
  }, [resetState]);

  const handleOpenPortal = useCallback(async () => {
    try {
      setOpeningPortal(true);
      setPortalError(null);
      const { url } = await authFetch<{ url: string }>(
        "/users/me/subscription/portal",
        { method: "POST" },
      );
      await open(url);
    } catch (err) {
      setPortalError(
        err instanceof Error ? err.message : "Failed to open billing portal",
      );
    } finally {
      setOpeningPortal(false);
    }
  }, []);

  const status = sub?.status ?? "none";
  const statusCfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.none;
  const hasSub = sub && sub.plan !== "free" && status !== "none";
  const isLifetime = sub?.lifetime === true;

  // Super users always show their own tier label; trial users show Ultimate
  const displayTier: SubscriptionTier =
    tier === "super_user" ? "super_user"
    : status === "trialing" ? "uplink_ultimate"
    : tier;

  // Compute trial days once
  const trialDays =
    status === "trialing" && sub?.trial_end
      ? trialDaysRemaining(sub.trial_end)
      : null;

  return (
    <div>
      {/* ── Account ──────────────────────────────────────────── */}
      <Section title="Account">
        {authenticated ? (
          <>
            {userLabel && (
              <DisplayRow
                label="Signed in as"
                value={userLabel}
                valueClass="text-xs text-fg-2 truncate max-w-[180px]"
              />
            )}
            <DisplayRow
              label="Plan"
              value={TIER_LABELS[displayTier]}
              valueClass="text-xs text-accent font-semibold"
            />
            <ActionRow
              label=""
              action="Sign out"
              actionClass="text-fg-4 hover:text-error hover:bg-error/10"
              onClick={() => setConfirmSignOut(true)}
            />
          </>
        ) : (
          <ActionRow
            label="Not signed in"
            action="Sign in"
            actionClass="bg-accent text-surface font-semibold hover:bg-accent/90"
            onClick={onLogin}
          />
        )}
      </Section>

      {/* ── Profile (inline edit) ────────────────────────────── */}
      {authenticated && (
        <Section title="Profile">
          <ProfileField
            label="Display name"
            value={overview?.identity.name ?? ""}
            placeholder="Add a display name"
            onSave={(next) =>
              handleProfileSave({ name: next }, "Display name")
            }
          />
          <ProfileField
            label="Email"
            type="email"
            value={overview?.identity.email ?? ""}
            placeholder="you@example.com"
            onSave={(next) => handleProfileSave({ email: next }, "Email")}
          />
          <DisplayRow
            label="Username"
            value={overview?.identity.username || "—"}
            valueClass="text-xs text-fg-3 font-mono truncate max-w-[180px]"
          />
        </Section>
      )}

      {/* ── Security ─────────────────────────────────────────── */}
      {authenticated && (
        <Section title="Security">
          <div className="px-3 py-2.5 flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-[12px] text-fg-2 leading-tight">
                Password
              </div>
              <div className="text-[11px] text-fg-4 leading-snug mt-0.5">
                We&apos;ll email you a reset link.
              </div>
            </div>
            <button
              onClick={handleSendReset}
              disabled={resetState !== "idle"}
              className="shrink-0 flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-md bg-base-250 text-fg-3 hover:text-fg-2 hover:bg-base-300 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            >
              {resetState === "sending" ? (
                <>
                  <Loader2 size={11} className="animate-spin" /> Sending…
                </>
              ) : resetState === "sent" ? (
                <>
                  <Check size={11} /> Email sent
                </>
              ) : (
                <>
                  <KeyRound size={11} /> Send reset email
                </>
              )}
            </button>
          </div>
        </Section>
      )}

      {/* ── Subscription ─────────────────────────────────────── */}
      {authenticated && hasSub && (
        <Section title={status === "trialing" ? "Free Trial" : "Subscription"}>
          <div className="px-3 py-2 space-y-3">
            {/* Status badge + billing amount */}
            <div className="flex items-center justify-between">
              <span
                className={`text-xs font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full ${statusCfg.color} ${statusCfg.bg}`}
              >
                {statusCfg.label}
              </span>
              {sub.amount && sub.currency && !isLifetime ? (
                <span className="text-sm text-fg-3 tabular-nums">
                  {formatAmount(sub.amount, sub.currency)}
                  {sub.interval === "month" ? "/mo" : sub.interval === "year" ? "/yr" : ""}
                  {status === "trialing" && sub.trial_end
                    ? ` starting ${new Date(sub.trial_end * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                    : ""}
                </span>
              ) : isLifetime ? (
                <span className="text-sm text-fg-3">Lifetime access</span>
              ) : null}
            </div>

            {/* Trial: consolidated days remaining + Ultimate access note */}
            {status === "trialing" && sub.trial_end && (
              <p className="text-xs text-fg-4">
                Your trial includes full{" "}
                <span className="font-semibold text-fg-3">Uplink Ultimate</span>{" "}
                access
                {trialDays !== null && (
                  <>
                    {" · "}
                    <span className="font-medium text-info">
                      {trialDays} day{trialDays !== 1 ? "s" : ""} remaining
                    </span>
                  </>
                )}
              </p>
            )}

            {/* Next billing date */}
            {status === "active" && sub.current_period_end && !isLifetime && (
              <p className="text-xs text-fg-4">
                Renews {formatDate(sub.current_period_end)}
              </p>
            )}

            {/* Canceling notice */}
            {status === "canceling" && sub.current_period_end && (
              <p className="text-xs text-warn">
                Access until {formatDate(sub.current_period_end)}. After that,
                you&apos;ll be on the Free plan.
              </p>
            )}

            {/* Past due warning */}
            {status === "past_due" && (
              <p className="text-xs text-error">
                Your payment failed. Update your payment method to keep your
                plan active.
              </p>
            )}

            {/* Canceled notice */}
            {status === "canceled" && (
              <p className="text-xs text-fg-4">
                Your subscription has ended. Resubscribe to regain access to
                paid features.
              </p>
            )}

            {/* Pending downgrade */}
            {sub.pending_downgrade_plan && sub.scheduled_change_at && (
              <p className="text-xs text-warn">
                Switching to{" "}
                <span className="font-semibold">
                  {sub.pending_downgrade_plan}
                </span>{" "}
                on {formatDate(sub.scheduled_change_at)}.
              </p>
            )}

            {/* Action buttons */}
            <div className="flex gap-2 pt-0.5">
              {status === "past_due" && (
                <button
                  onClick={handleOpenPortal}
                  disabled={openingPortal}
                  className="flex-1 py-2 text-xs font-semibold rounded-lg bg-error/10 text-error hover:bg-error/20 transition-all duration-150 active:scale-[0.97] disabled:opacity-50"
                >
                  {openingPortal ? "Opening..." : "Update Payment"}
                </button>
              )}
              {(status === "active" || status === "trialing" || status === "canceling") &&
                !isLifetime && (
                  <button
                    onClick={handleOpenPortal}
                    disabled={openingPortal}
                    className="flex-1 py-2 text-xs font-semibold rounded-lg bg-accent/10 text-accent hover:bg-accent/20 transition-all duration-150 active:scale-[0.97] disabled:opacity-50"
                  >
                    {openingPortal
                      ? "Opening..."
                      : status === "trialing"
                        ? "Manage Trial"
                        : "Manage Subscription"}
                  </button>
                )}
              {status === "canceled" && (
                <button
                  onClick={() => open("https://myscrollr.com/uplink")}
                  className="flex-1 py-2 text-xs font-semibold rounded-lg bg-accent/10 text-accent hover:bg-accent/20 transition-all duration-150 active:scale-[0.97]"
                >
                  See Plans
                </button>
              )}
            </div>

            {portalError && (
              <span className="text-xs text-error px-1">
                {portalError}
              </span>
            )}
          </div>
        </Section>
      )}

      {/* ── Your Plan ────────────────────────────────────────── */}
      {authenticated && (
        <Section title="Your Plan">
          <TierLimitsTable tier={tier} />
          {tier !== "uplink_ultimate" && tier !== "super_user" && !isLifetime && (
            <div className="px-3 pb-2">
              <button
                onClick={() => open("https://myscrollr.com/uplink")}
                className="w-full py-2 text-xs font-semibold rounded-lg bg-accent/10 text-accent hover:bg-accent/20 transition-all duration-150 active:scale-[0.98]"
              >
                {tier === "free"
                  ? "Upgrade to Uplink"
                  : "Upgrade Plan"}
              </button>
            </div>
          )}
        </Section>
      )}

      {/* ── Your Data ────────────────────────────────────────── */}
      {authenticated && (
        <Section title="Your Data">
          <div className="px-3 py-2">
            <AccountExportButton />
          </div>
        </Section>
      )}

      {/* ── Reset (destructive, footer) ─────────────────────── */}
      {/* Lives at the end of Account because it's a local-only admin
          action that sits naturally beside sign-out + data export.
          Pre-refactor this was its own top-level Settings tab. */}
      <Section title="Reset all settings">
        <div className="px-3 py-2 flex flex-col gap-3">
          <p className="text-[12px] text-fg-3 leading-relaxed">
            Clear every local preference: theme, ticker layout, channel
            display, followed players, and more. Your account, billing, and
            channel data on the server is untouched.
          </p>
          <div className="flex flex-col gap-3 p-3 rounded-lg bg-error/5 border border-error/20">
            <div className="flex items-start gap-2 text-[12px] text-error leading-relaxed">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden />
              <p>
                This action is local-only and cannot be undone. You will be
                asked to confirm before anything is reset.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setConfirmResetAll(true)}
              className="self-start flex items-center gap-2 px-3 py-2 rounded-lg bg-error/10 text-error hover:bg-error/20 transition-all duration-150 active:scale-[0.97] cursor-pointer text-[12px] font-semibold"
            >
              <Trash2 className="w-4 h-4" aria-hidden />
              <span>Reset all settings</span>
            </button>
          </div>
        </div>
      </Section>

      {/* Sign-out confirmation. Mounted unconditionally so the close
          animation runs even after `authenticated` flips false during
          the logout flow. */}
      <ConfirmDialog
        open={confirmSignOut}
        title="Sign out of Scrollr?"
        description="You'll need to sign in again to access your subscription, profile, and saved data on this machine. Local preferences (ticker layout, widgets) stay intact."
        confirmLabel="Sign out"
        destructive
        onConfirm={() => {
          setConfirmSignOut(false);
          onLogout();
        }}
        onCancel={() => setConfirmSignOut(false)}
      />

      {/* Reset-all confirmation. */}
      <ConfirmDialog
        open={confirmResetAll}
        title="Reset all settings?"
        description="This will set everything back to the original settings. Your account and saved content won't change."
        confirmLabel="Reset everything"
        destructive
        onConfirm={() => {
          setConfirmResetAll(false);
          onResetAll();
        }}
        onCancel={() => setConfirmResetAll(false)}
      />
    </div>
  );
}

// ── Tier limits table ───────────────────────────────────────────

const LIMIT_ROWS: { label: string; key: NumericLimitKey }[] = [
  { label: "Finance symbols", key: "symbols" },
  { label: "News feeds", key: "feeds" },
  { label: "Custom feeds", key: "customFeeds" },
  { label: "Sports leagues", key: "leagues" },
  { label: "Fantasy leagues", key: "fantasy" },
];

function TierLimitsTable({ tier }: { tier: SubscriptionTier }) {
  const limits = TIER_LIMITS[tier];
  return (
    <div className="px-3 py-1.5 space-y-1">
      {LIMIT_ROWS.map(({ label, key }) => (
        <div key={key} className="flex items-center justify-between py-1">
          <span className="text-xs text-fg-3">{label}</span>
          <span className="text-xs font-medium text-fg-2 tabular-nums">
            {isUnlimited(tier, key) ? "Unlimited" : limits[key]}
          </span>
        </div>
      ))}
    </div>
  );
}
