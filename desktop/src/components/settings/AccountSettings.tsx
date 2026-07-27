import { useState, useCallback, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { open } from "@tauri-apps/plugin-shell";
import { toast } from "sonner";
import clsx from "clsx";
import { TIER_LABELS, getUserIdentity } from "../../auth";
import {
  authFetch,
  exportUserData,
  requestPasswordReset,
  updateProfile,
} from "../../api/client";
import { queryKeys, userOverviewQueryOptions } from "../../api/queries";
import {
  SlotPills,
  slotHeadline,
  slotSubline,
  useSlotUsage,
} from "../SlotMeter";
import type { SubscriptionTier } from "../../auth";
import type { SubscriptionInfo } from "../../api/client";
import { Section, DisplayRow, ActionRow } from "./SettingsControls";
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
  // Export-data state lives inline so the Data card can use the
  // standard ActionRow chrome; `exportUserData()` (api/client) is the
  // source of truth for the download flow.
  const [exportState, setExportState] = useState<"idle" | "loading">("idle");
  // Phase 1 (Apr 26): sign-out used to be one-click. Reset, widget
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
  const navigate = useNavigate();
  const slots = useSlotUsage();

  // Aggregated overview: widgets count, fantasy summary, GDPR state.
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

  // Trigger a data-export download. Errors surface via toast so the
  // ActionRow stays visually identical to every other row on the page
  // (no inline error blocks, no hidden expansion).
  const handleExport = useCallback(async () => {
    if (exportState === "loading") return;
    try {
      setExportState("loading");
      const blob = await exportUserData();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `myscrollr-export-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to export your data",
      );
    } finally {
      setExportState("idle");
    }
  }, [exportState]);

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

  const passwordResetLabel =
    resetState === "sending"
      ? "Sending…"
      : resetState === "sent"
        ? "Email sent"
        : "Send reset email";

  const exportActionLabel = exportState === "loading" ? "Exporting…" : "Export";

  const billingActionLabel =
    status === "past_due"
      ? openingPortal
        ? "Opening…"
        : "Update payment"
      : status === "canceled"
        ? "See plans"
        : status === "trialing"
          ? openingPortal
            ? "Opening…"
            : "Manage trial"
          : openingPortal
            ? "Opening…"
            : "Manage subscription";

  const showBillingAction =
    status === "past_due" ||
    status === "canceled" ||
    ((status === "active" || status === "trialing" || status === "canceling") && !isLifetime);

  const handleBillingAction =
    status === "canceled"
      ? () => open("https://myscrollr.com/uplink")
      : handleOpenPortal;

  return (
    <div>
      <div className="grid gap-4 grid-cols-2 items-start">
        <div className="space-y-4 min-w-0">
      {/* ── Account ──────────────────────────────────────────── */}
      <Section title="Account" variant="card">
        {authenticated ? (
          <>
            {userLabel && (
              <DisplayRow
                label="Signed in as"
                value={userLabel}
                valueClass="text-ui-muted text-fg-2 truncate max-w-[200px]"
              />
            )}
            <DisplayRow
              label="Plan"
              value={TIER_LABELS[displayTier]}
              valueClass="text-ui-muted text-accent font-semibold"
            />
            <ActionRow
              label="Sign out"
              description="Sign out of this device. Local preferences stay intact."
              action="Sign out"
              actionClass="bg-error/10 text-error hover:bg-error/20"
              onClick={() => setConfirmSignOut(true)}
            />
          </>
        ) : (
          <ActionRow
            label="Not signed in"
            description="Sign in to sync subscription, profile, and saved data."
            action="Sign in"
            actionClass="bg-accent text-surface font-semibold hover:bg-accent/90"
            onClick={onLogin}
          />
        )}
      </Section>

      {/* ── Profile (inline edit) ────────────────────────────── */}
      {authenticated && (
        <Section title="Profile" variant="card">
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
            valueClass="text-ui-muted text-fg-3 font-mono truncate max-w-[200px]"
          />
        </Section>
      )}

      {/* ── Security ─────────────────────────────────────────── */}
      {authenticated && (
        <Section title="Security" variant="card">
          <ActionRow
            label="Password"
            description="We'll email you a reset link."
            action={passwordResetLabel}
            actionClass={clsx(
              "flex items-center gap-1 bg-base-250 text-fg-3 hover:text-fg-2 hover:bg-base-300",
              resetState !== "idle" && "opacity-60 cursor-not-allowed",
            )}
            onClick={() => {
              if (resetState === "idle") handleSendReset();
            }}
          />
        </Section>
      )}
        </div>

        <div className="space-y-4 min-w-0">
      {/* ── Welcome (unauthenticated only) ───────────────────── */}
      {/* Keeps the two-column grid balanced when logged out so the */}
      {/* Account card never sits alone next to an empty column.    */}
      {!authenticated && (
        <Section title="Welcome" variant="card">
          <ActionRow
            label="Sign in to Scrollr"
            description="Signing in syncs your subscription, profile, and source preferences across devices and unlocks billing management."
            action="Sign in"
            actionClass="bg-accent text-surface font-semibold hover:bg-accent/90"
            onClick={onLogin}
          />
        </Section>
      )}

      {/* ── Subscription ─────────────────────────────────────── */}
      {authenticated && hasSub && (
        <Section title="Subscription" variant="card">
          <DisplayRow
            label="Status"
            value={
              <span
                className={`text-ui-chip font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full ${statusCfg.color} ${statusCfg.bg}`}
              >
                {statusCfg.label}
              </span>
            }
          />

          {sub.amount && sub.currency && !isLifetime && (
            <DisplayRow
              label="Billing"
              value={`${formatAmount(sub.amount, sub.currency)}${
                sub.interval === "month" ? "/mo" : sub.interval === "year" ? "/yr" : ""
              }`}
              valueClass="text-ui-muted text-fg-2 tabular-nums"
            />
          )}

          {isLifetime && (
            <DisplayRow label="Billing" value="Lifetime access" />
          )}

          {status === "active" && sub.current_period_end && !isLifetime && (
            <DisplayRow label="Renews" value={formatDate(sub.current_period_end)} />
          )}

          {status === "trialing" && sub.trial_end && trialDays !== null && (
            <DisplayRow
              label="Trial"
              value={`${trialDays} day${trialDays !== 1 ? "s" : ""} remaining`}
              valueClass="text-ui-muted text-info"
            />
          )}

          {status === "canceling" && sub.current_period_end && (
            <DisplayRow
              label="Cancels on"
              value={formatDate(sub.current_period_end)}
              valueClass="text-ui-muted text-warn"
            />
          )}

          {sub.pending_downgrade_plan && sub.scheduled_change_at && (
            <DisplayRow
              label="Scheduled change"
              value={`${sub.pending_downgrade_plan} on ${formatDate(sub.scheduled_change_at)}`}
              valueClass="text-ui-muted text-warn"
            />
          )}

          {showBillingAction && (
            <ActionRow
              label={
                status === "past_due"
                  ? "Update payment method"
                  : status === "canceled"
                    ? "Plans"
                    : "Manage"
              }
              description={
                status === "past_due"
                  ? "Your last payment failed. Update your card to keep your plan."
                  : status === "canceled"
                    ? "Browse plans and resubscribe."
                    : "Open the Stripe billing portal."
              }
              action={billingActionLabel}
              actionClass={
                status === "past_due"
                  ? "bg-error/10 text-error hover:bg-error/20"
                  : "bg-accent/10 text-accent hover:bg-accent/20"
              }
              onClick={handleBillingAction}
            />
          )}

          {portalError && (
            <div className="px-3 pb-2 text-ui-meta text-error">{portalError}</div>
          )}
        </Section>
      )}

      {/* ── Your Plan ────────────────────────────────────────── */}
      {authenticated && (
        <Section title="Widget slots" variant="card">
          {/* The plan story is ONE number now (v1.1.2): how many widgets
              you run at once. The old per-feature limits table — five
              rows of "Unlimited" since the caps were retired — is gone.
              Meter + copy come from SlotMeter.tsx, shared with the
              Catalog header. */}
          <div className="px-3 py-2">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="text-ui-body font-semibold text-fg">
                {slotHeadline(slots)}
              </span>
              <SlotPills usage={slots} />
            </div>
            <p className="mt-1 text-ui-meta text-fg-4">{slotSubline(slots)}</p>
          </div>
          <ActionRow
            label="Manage widgets"
            description="Add, remove, and swap widgets in the Catalog."
            action="Open Catalog"
            onClick={() => navigate({ to: "/catalog" })}
          />
          {tier !== "uplink_ultimate" && tier !== "super_user" && !isLifetime && (
            <ActionRow
              label={tier === "free" ? "Upgrade to Uplink" : "Upgrade plan"}
              description="More slots — run more widgets at once."
              action="Upgrade"
              actionClass="bg-accent/10 text-accent hover:bg-accent/20"
              onClick={() => open("https://myscrollr.com/uplink")}
            />
          )}
        </Section>
      )}

      {/* ── Your Data ────────────────────────────────────────── */}
      {authenticated && (
        <Section title="Data" variant="card">
          <ActionRow
            label="Export your data"
            description="Download your sources, preferences, and account metadata as JSON."
            action={exportActionLabel}
            actionClass={clsx(
              "bg-accent/10 text-accent hover:bg-accent/20",
              exportState === "loading" && "opacity-60 cursor-not-allowed",
            )}
            onClick={handleExport}
          />
        </Section>
      )}

      {/* ── Danger zone ─────────────────────────────────────── */}
      <Section title="Danger zone" variant="card">
        <ActionRow
          label="Reset all settings"
          description="Clear every local preference. Your account, billing, and server data are untouched."
          action="Reset"
          actionClass="bg-error/10 text-error hover:bg-error/20"
          onClick={() => setConfirmResetAll(true)}
        />
      </Section>
        </div>
      </div>

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

