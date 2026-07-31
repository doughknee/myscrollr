/**
 * Profile & plan.
 *
 * Carries over every behavior from the old Account tab: the
 * unauthenticated sign-in card, ProfileField inline editing, the
 * password-reset cooldown, the slot meter, the full subscription-status
 * matrix, the billing portal, and the sign-out confirm.
 *
 * Two identity sources are preserved deliberately. The JWT
 * (`getUserIdentity`) is what this device is authenticated as and is
 * available immediately; the server overview is the editable record and
 * arrives async. The card prefers the server copy and falls back to the
 * JWT so it is never blank on first paint.
 */
import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { open } from "@tauri-apps/plugin-shell";
import { toast } from "sonner";
import { TIER_LABELS, getUserIdentity } from "../../../auth";
import {
  authFetch,
  requestPasswordReset,
  updateProfile,
} from "../../../api/client";
import { queryKeys, userOverviewQueryOptions } from "../../../api/queries";
import { slotHeadline, slotSubline, useSlotUsage } from "../../SlotMeter";
import type { SubscriptionTier } from "../../../auth";
import type { SubscriptionInfo } from "../../../api/client";
import {
  ActionRow,
  CARD_SURFACE,
  DisplayRow,
  RowList,
  SettingsGroup,
} from "../SettingsControls";
import ProfileField from "../ProfileField";
import ConfirmDialog from "../../ConfirmDialog";
import { Row } from "./Row";

// ── Status helpers (unchanged semantics) ────────────────────────

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

interface ProfilePlanPageProps {
  authenticated: boolean;
  tier: SubscriptionTier;
  subscriptionInfo: SubscriptionInfo | null;
  onLogin: () => void;
  onLogout: () => void;
}

export default function ProfilePlanPage({
  authenticated,
  tier,
  subscriptionInfo: sub,
  onLogin,
  onLogout,
}: ProfilePlanPageProps) {
  const [openingPortal, setOpeningPortal] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);
  const [resetState, setResetState] = useState<"idle" | "sending" | "sent">(
    "idle",
  );
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const slots = useSlotUsage();

  const jwtIdentity = authenticated ? getUserIdentity() : null;

  const { data: overview } = useQuery({
    ...userOverviewQueryOptions(),
    enabled: authenticated,
  });

  const displayName = overview?.identity.name ?? jwtIdentity?.name ?? "";
  const email = overview?.identity.email ?? jwtIdentity?.email ?? "";
  const username = overview?.identity.username ?? "";

  const handleProfileSave = useCallback(
    async (payload: { name?: string; email?: string }, label: string) => {
      await updateProfile(payload);
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

  // Clear the sticky "Email sent" state after 30s so a user who never
  // got the mail can retry. Component-local on purpose: leaving the page
  // resets it, which is the existing behavior.
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

  const displayTier: SubscriptionTier =
    tier === "super_user"
      ? "super_user"
      : status === "trialing"
        ? "uplink_ultimate"
        : tier;

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
    ((status === "active" || status === "trialing" || status === "canceling") &&
      !isLifetime);

  const handleBillingAction =
    status === "canceled"
      ? () => open("https://myscrollr.com/uplink")
      : handleOpenPortal;

  // ── Signed out ────────────────────────────────────────────────
  if (!authenticated) {
    return (
      <SettingsGroup>
        <RowList>
          <Row id="signedIn">
            <ActionRow
              label="Sign in to Scrollr"
              description="Signing in syncs your subscription, profile, and source preferences across devices and unlocks billing management."
              action="Sign in"
              tone="accent"
              onClick={onLogin}
            />
          </Row>
        </RowList>
      </SettingsGroup>
    );
  }

  const initial = (username || displayName || email || "?")
    .trim()
    .charAt(0)
    .toUpperCase();

  return (
    <>
      {/* ── Identity card ──────────────────────────────────── */}
      <div
        data-row="signedIn"
        className={`${CARD_SURFACE} flex items-center gap-3.5 p-4`}
      >
        <span
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[17px] font-bold text-accent"
          aria-hidden
        >
          {initial}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-ui-title text-fg">
            {displayName || "Signed in"}
            {username && (
              <span className="ml-1.5 font-mono text-ui-chip font-medium text-fg-4">
                · {username}
              </span>
            )}
          </span>
          {email && (
            <span className="truncate text-ui-meta text-fg-3">{email}</span>
          )}
        </div>
        <span
          data-row="plan"
          className="shrink-0 rounded-full bg-accent/12 px-3 py-1 text-ui-chip font-bold tracking-wide text-accent uppercase"
        >
          {TIER_LABELS[displayTier]} · {slots.used} widget
          {slots.used === 1 ? "" : "s"}
        </span>
      </div>

      {/* ── Profile ────────────────────────────────────────── */}
      <SettingsGroup label="Profile">
        <RowList>
          <Row id="displayName">
            <ProfileField
              label="Display name"
              value={overview?.identity.name ?? ""}
              placeholder="Add a display name"
              onSave={(next) => handleProfileSave({ name: next }, "Display name")}
            />
          </Row>
          <Row id="email">
            <ProfileField
              label="Email"
              type="email"
              value={overview?.identity.email ?? ""}
              placeholder="you@example.com"
              onSave={(next) => handleProfileSave({ email: next }, "Email")}
            />
          </Row>
          <Row id="password">
            <ActionRow
              label="Password"
              description="We'll email you a reset link."
              action={passwordResetLabel}
              muted={resetState !== "idle"}
              onClick={() => {
                if (resetState === "idle") handleSendReset();
              }}
            />
          </Row>
        </RowList>
      </SettingsGroup>

      {/* ── Subscription ───────────────────────────────────── */}
      {hasSub && (
        <SettingsGroup label="Subscription">
          <RowList>
            <DisplayRow
              label="Status"
              value={
                <span
                  className={`rounded-full px-2 py-0.5 text-ui-chip font-semibold tracking-wide uppercase ${statusCfg.color} ${statusCfg.bg}`}
                >
                  {statusCfg.label}
                </span>
              }
            />
            {sub.amount && sub.currency && !isLifetime && (
              <DisplayRow
                label="Billing"
                value={`${formatAmount(sub.amount, sub.currency)}${
                  sub.interval === "month"
                    ? "/mo"
                    : sub.interval === "year"
                      ? "/yr"
                      : ""
                }`}
                valueClass="text-ui-meta text-fg-2 tabular-nums"
              />
            )}
            {isLifetime && <DisplayRow label="Billing" value="Lifetime access" />}
            {status === "active" && sub.current_period_end && !isLifetime && (
              <DisplayRow
                label="Renews"
                value={formatDate(sub.current_period_end)}
              />
            )}
            {status === "trialing" && sub.trial_end && trialDays !== null && (
              <DisplayRow
                label="Trial"
                value={`${trialDays} day${trialDays !== 1 ? "s" : ""} remaining`}
                valueClass="text-ui-meta text-info"
              />
            )}
            {status === "canceling" && sub.current_period_end && (
              <DisplayRow
                label="Cancels on"
                value={formatDate(sub.current_period_end)}
                valueClass="text-ui-meta text-warn"
              />
            )}
            {sub.pending_downgrade_plan && sub.scheduled_change_at && (
              <DisplayRow
                label="Scheduled change"
                value={`${sub.pending_downgrade_plan} on ${formatDate(sub.scheduled_change_at)}`}
                valueClass="text-ui-meta text-warn"
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
                tone={status === "past_due" ? "error" : "accent"}
                onClick={handleBillingAction}
              />
            )}
            {portalError && (
              <div className="px-4 pb-2 text-ui-meta text-error">
                {portalError}
              </div>
            )}
          </RowList>
        </SettingsGroup>
      )}

      {/* ── Widgets ────────────────────────────────────────── */}
      <SettingsGroup label="Widgets">
        <RowList>
          <Row id="slots">
            <ActionRow
              label={slotHeadline(slots)}
              description={slotSubline(slots)}
              action="Open Catalog"
              onClick={() => navigate({ to: "/catalog" })}
            />
          </Row>
          {tier !== "uplink_ultimate" &&
            tier !== "super_user" &&
            !isLifetime && (
              <ActionRow
                label={tier === "free" ? "Upgrade to Uplink" : "Upgrade plan"}
                description="More slots — run more widgets at once."
                action="Upgrade"
                tone="accent"
                onClick={() => open("https://myscrollr.com/uplink")}
              />
            )}
        </RowList>
      </SettingsGroup>

      {/* ── Session ────────────────────────────────────────── */}
      <SettingsGroup label="Session">
        <RowList>
          <Row id="signOut">
            <ActionRow
              label="Sign out"
              description="Sign out of this device. Local preferences stay intact."
              action="Sign out"
              tone="error"
              onClick={() => setConfirmSignOut(true)}
            />
          </Row>
        </RowList>
      </SettingsGroup>

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
    </>
  );
}
