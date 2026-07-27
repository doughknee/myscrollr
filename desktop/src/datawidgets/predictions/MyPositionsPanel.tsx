/**
 * MyPositionsPanel — the "My Positions" surface for the predictions widget.
 *
 * When the user hasn't linked Kalshi, this renders the {@link ConnectWizard}.
 * Once linked, it shows their balance, open positions with LIVE profit & loss
 * (marked to market against the same prices the widget already streams),
 * recent fills, and resting orders — plus an easy Disconnect.
 *
 * Live updates come from two places:
 *   1. Market prices tick in via the widget's existing dashboard feed
 *      (`markets`), so unrealized P&L re-computes on every price change with no
 *      extra network calls.
 *   2. The authenticated read-only WS stream (`kalshi-user-event`) tells us when
 *      the *account* changed (a fill, a position/qty change), which triggers a
 *      debounced re-fetch of the portfolio snapshot.
 *
 * Everything here is read-only. There is no order entry.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clsx } from "clsx";
import { open } from "@tauri-apps/plugin-shell";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  RefreshCw,
  Unplug,
  Wifi,
  WifiOff,
  ExternalLink,
  Inbox,
} from "lucide-react";
import { useTauriListener } from "../../hooks/useTauriListener";
import { useNow } from "../../hooks/useNow";
import { relativeTime } from "../../utils/format";
import ConnectWizard from "./ConnectWizard";
import {
  kalshiStatus,
  kalshiPortfolio,
  kalshiDisconnect,
  kalshiStartUserStream,
  kalshiStopUserStream,
  isKalshiAvailable,
  KALSHI_USER_EVENT,
  KALSHI_STREAM_STATUS,
  type CredentialStatus,
  type KalshiPosition,
  type KalshiStreamStatus,
} from "./kalshi";
import {
  buildPriceMap,
  lookupYesPrice,
  computePositionPnl,
  computePortfolioSummary,
  sortPositionsByValue,
  formatUsdCents,
  formatSignedUsdCents,
} from "./positions";
import type { Prediction } from "../../types";

const PORTFOLIO_KEY = ["kalshi", "portfolio"] as const;
const KALSHI_PORTFOLIO_FALLBACK = "https://kalshi.com/portfolio";

interface MyPositionsPanelProps {
  /** Live market list from the dashboard — used to mark positions to market. */
  markets: Prediction[];
  hex: string;
}

export default function MyPositionsPanel({ markets, hex }: MyPositionsPanelProps) {
  const available = isKalshiAvailable();
  const queryClient = useQueryClient();
  const now = useNow();

  // ── Connection status ─────────────────────────────────────────
  const [credStatus, setCredStatus] = useState<CredentialStatus | null>(null);
  const [streamStatus, setStreamStatus] = useState<KalshiStreamStatus>("disconnected");

  useEffect(() => {
    if (!available) return;
    let active = true;
    kalshiStatus()
      .then((s) => active && setCredStatus(s))
      .catch(() => active && setCredStatus({ connected: false, key_id: null }));
    return () => {
      active = false;
    };
  }, [available]);

  const connected = credStatus?.connected === true;

  // ── Portfolio query (only when connected) ─────────────────────
  const {
    data: portfolio,
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: PORTFOLIO_KEY,
    queryFn: kalshiPortfolio,
    enabled: available && connected,
    staleTime: 5_000,
    refetchOnWindowFocus: true,
  });

  // ── Live stream lifecycle ─────────────────────────────────────
  useEffect(() => {
    if (!available || !connected) return;
    kalshiStartUserStream().catch(() => {});
    return () => {
      kalshiStopUserStream().catch(() => {});
    };
  }, [available, connected]);

  // Account changed → debounced portfolio refetch (coalesce bursts of fills).
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useTauriListener(
    KALSHI_USER_EVENT,
    () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: PORTFOLIO_KEY });
      }, 600);
    },
    [queryClient],
  );
  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  useTauriListener<{ status?: KalshiStreamStatus }>(
    KALSHI_STREAM_STATUS,
    (e) => {
      const s = e.payload?.status;
      if (s) setStreamStatus(s);
      // On (re)connect, resnapshot via REST so we never drift from the WS.
      if (s === "connected") {
        queryClient.invalidateQueries({ queryKey: PORTFOLIO_KEY });
      }
    },
    [queryClient],
  );

  // ── Disconnect ────────────────────────────────────────────────
  const handleDisconnect = useCallback(async () => {
    await kalshiDisconnect().catch(() => {});
    queryClient.removeQueries({ queryKey: PORTFOLIO_KEY });
    setStreamStatus("disconnected");
    setCredStatus({ connected: false, key_id: null });
  }, [queryClient]);

  const handleConnected = useCallback(
    (s: CredentialStatus) => {
      setCredStatus(s);
      queryClient.invalidateQueries({ queryKey: PORTFOLIO_KEY });
    },
    [queryClient],
  );

  // ── Derived: prices + title/link maps ─────────────────────────
  const prices = useMemo(() => buildPriceMap(markets), [markets]);
  const meta = useMemo(() => {
    const m = new Map<string, { title: string; link?: string }>();
    for (const p of markets) {
      m.set(p.ticker, { title: p.title, link: p.link });
      m.set(p.id, { title: p.title, link: p.link });
    }
    return m;
  }, [markets]);

  const lookupMeta = useCallback(
    (ticker: string) => meta.get(ticker) ?? meta.get(`kalshi:${ticker}`),
    [meta],
  );

  // ── Render: not connected → wizard ────────────────────────────
  if (!available || !connected) {
    // While we're still resolving status on desktop, hold off to avoid a flash
    // of the wizard for an already-connected user.
    if (available && credStatus === null) {
      return <PanelSkeleton />;
    }
    return <ConnectWizard onConnected={handleConnected} hex={hex} />;
  }

  if (isLoading) {
    return <PanelSkeleton />;
  }

  if (isError || !portfolio) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
        <WifiOff size={26} className="text-fg-3" />
        <p className="text-sm font-medium text-fg-2">Couldn&rsquo;t load your portfolio</p>
        <p className="max-w-xs text-[12px] text-fg-3">
          We couldn&rsquo;t reach Kalshi just now. Your connection is still saved.
        </p>
        <button
          type="button"
          onClick={() => refetch()}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium text-white cursor-pointer"
          style={{ background: hex }}
        >
          <RefreshCw size={13} />
          Try again
        </button>
      </div>
    );
  }

  const summary = computePortfolioSummary(portfolio, prices);
  const sortedPositions = sortPositionsByValue(portfolio.positions, prices);

  return (
    // Page-scroll layout: the Source page owns the scroll (an inner
    // `overflow-y-auto` here created a dead scrollport in-app — same fix
    // as the FeedTab control bar). The summary scrolls with the content:
    // pinning it under the sticky switcher needs a hardcoded offset that
    // drifts with the bar's height, and it never pinned in prod anyway.
    // ponytail: if stacked pinning is ever wanted, share the bar height
    // via a CSS var instead of a px literal.
    <div className="flex min-h-full flex-1 flex-col">
      {/* Summary header */}
      <div className="border-b border-edge/30 bg-surface px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-fg-3">Account value</div>
            <div className="font-mono text-2xl font-bold tabular-nums text-fg">
              {formatUsdCents(summary.totalValueCents)}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <StreamPill status={streamStatus} />
            <button
              type="button"
              onClick={() => refetch()}
              title="Refresh"
              aria-label="Refresh portfolio"
              className="flex h-7 w-7 items-center justify-center rounded-md border border-edge/40 text-fg-3  hover:text-fg cursor-pointer"
            >
              <RefreshCw size={13} />
            </button>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[12px] tabular-nums">
          <Stat label="Cash" value={formatUsdCents(summary.balanceCents)} />
          <Stat label="Positions" value={formatUsdCents(summary.positionsValueCents)} />
          <Stat
            label="Unrealized"
            value={formatSignedUsdCents(summary.unrealizedPnlCents)}
            tone={summary.unrealizedPnlCents > 0 ? "up" : summary.unrealizedPnlCents < 0 ? "down" : "flat"}
          />
        </div>
      </div>

      {/* Open positions */}
      <Section
        title="Open positions"
        count={summary.openPositions}
        emptyIcon={Inbox}
        emptyText="No open positions yet."
        empty={sortedPositions.length === 0}
      >
        <div className="grid gap-px bg-edge">
          {sortedPositions.map((pos) => (
            <PositionRow
              key={pos.ticker}
              pos={pos}
              yesPrice={lookupYesPrice(prices, pos.ticker)}
              meta={lookupMeta(pos.ticker)}
            />
          ))}
        </div>
      </Section>

      {/* Resting orders */}
      {portfolio.resting_orders.length > 0 && (
        <Section title="Resting orders" count={portfolio.resting_orders.length}>
          <div className="flex flex-col">
            {portfolio.resting_orders.map((o, i) => {
              const m = lookupMeta(o.ticker);
              return (
                <div
                  key={`${o.ticker}-${i}`}
                  className="flex items-center gap-2 border-b border-edge/20 px-4 py-2 text-[12px]"
                >
                  <SideTag side={o.side} />
                  <span className="min-w-0 flex-1 truncate text-fg-2">
                    {m?.title ?? o.ticker}
                  </span>
                  <span className="font-mono tabular-nums text-fg-3">
                    {o.remaining_count} @ {o.price_cents}¢
                  </span>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* Recent fills */}
      <Section
        title="Recent fills"
        count={portfolio.fills.length}
        emptyText="No trades yet."
        empty={portfolio.fills.length === 0}
      >
        <div className="flex flex-col">
          {portfolio.fills.slice(0, 25).map((f, i) => {
            const m = lookupMeta(f.ticker);
            return (
              <div
                key={`${f.ticker}-${i}`}
                className="flex items-center gap-2 border-b border-edge/20 px-4 py-2 text-[12px]"
              >
                <span
                  className={clsx(
                    "font-mono text-[10px] font-semibold uppercase",
                    f.action.toLowerCase() === "buy" ? "text-up" : "text-down",
                  )}
                >
                  {f.action}
                </span>
                <SideTag side={f.side} />
                <span className="min-w-0 flex-1 truncate text-fg-2">{m?.title ?? f.ticker}</span>
                <span className="font-mono tabular-nums text-fg-3">
                  {f.count} @ {f.price_cents}¢
                </span>
                <span className="w-12 shrink-0 text-right font-mono text-[11px] text-fg-4">
                  {relativeTime(f.created_time, now)}
                </span>
              </div>
            );
          })}
        </div>
      </Section>

      {/* Footer: disconnect */}
      <div className="mt-auto flex items-center justify-between gap-3 border-t border-edge/30 px-4 py-3">
        <span className="font-mono text-[10.5px] text-fg-4">
          Linked on this device · read-only
        </span>
        <button
          type="button"
          onClick={handleDisconnect}
          className="inline-flex items-center gap-1.5 rounded-lg bg-error/10 px-3 py-1.5 text-[12px] font-medium text-error  hover:bg-error/20 cursor-pointer"
        >
          <Unplug size={13} />
          Disconnect
        </button>
      </div>
    </div>
  );
}

// ── Position row ─────────────────────────────────────────────────

function PositionRow({
  pos,
  yesPrice,
  meta,
}: {
  pos: KalshiPosition;
  yesPrice: number | undefined;
  meta: { title: string; link?: string } | undefined;
}) {
  const pnl = computePositionPnl(pos, yesPrice);
  const tone = !pnl ? "flat" : pnl.unrealizedPnlCents > 0 ? "up" : pnl.unrealizedPnlCents < 0 ? "down" : "flat";
  const link = meta?.link ?? KALSHI_PORTFOLIO_FALLBACK;

  return (
    <button
      type="button"
      onClick={() => open(link).catch(() => {})}
      title="Open on Kalshi"
      className="flex w-full items-center gap-3 bg-surface px-4 py-2.5 text-left  hover:bg-surface-hover cursor-pointer"
    >
      <SideTag side={pos.side} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12.5px] text-fg-2">{meta?.title ?? pos.ticker}</div>
        <div className="mt-0.5 font-mono text-[11px] tabular-nums text-fg-4">
          {pos.count} contract{pos.count === 1 ? "" : "s"}
          {pnl ? ` · now ${pnl.currentPriceCents}¢` : ""}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className="font-mono text-[13px] font-semibold tabular-nums text-fg">
          {pnl ? formatUsdCents(pnl.marketValueCents) : formatUsdCents(pos.exposure_cents)}
        </div>
        {pnl && (
          <div
            className={clsx(
              "font-mono text-[11px] tabular-nums",
              tone === "up" && "text-up",
              tone === "down" && "text-down",
              tone === "flat" && "text-fg-3",
            )}
          >
            {formatSignedUsdCents(pnl.unrealizedPnlCents)}
          </div>
        )}
      </div>
      <ExternalLink size={13} className="shrink-0 text-fg-4" />
    </button>
  );
}

// ── Bits ─────────────────────────────────────────────────────────

function SideTag({ side }: { side: string }) {
  const isYes = side.toLowerCase() === "yes";
  const isNo = side.toLowerCase() === "no";
  return (
    <span
      className={clsx(
        "shrink-0 rounded px-1.5 py-px font-mono text-[10px] font-bold uppercase",
        isYes && "bg-up/15 text-up",
        isNo && "bg-down/15 text-down",
        !isYes && !isNo && "bg-surface-2 text-fg-3",
      )}
    >
      {side || "—"}
    </span>
  );
}

function Stat({
  label,
  value,
  tone = "flat",
}: {
  label: string;
  value: string;
  tone?: "up" | "down" | "flat";
}) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="text-fg-4">{label}</span>
      <span
        className={clsx(
          "font-semibold",
          tone === "up" && "text-up",
          tone === "down" && "text-down",
          tone === "flat" && "text-fg-2",
        )}
      >
        {value}
      </span>
    </span>
  );
}

function StreamPill({ status }: { status: KalshiStreamStatus }) {
  const live = status === "connected";
  return (
    <span
      title={live ? "Live updates on" : `Live updates: ${status}`}
      className={clsx(
        "flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
        live ? "bg-up/12 text-up" : "bg-surface-2 text-fg-3",
      )}
    >
      {live ? <Wifi size={11} /> : <WifiOff size={11} />}
      {live ? "Live" : status === "reconnecting" ? "Reconnecting" : "Offline"}
    </span>
  );
}

function Section({
  title,
  count,
  children,
  empty,
  emptyText,
  emptyIcon: EmptyIcon,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
  empty?: boolean;
  emptyText?: string;
  emptyIcon?: React.ComponentType<{ size?: number; className?: string }>;
}) {
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 px-4 pb-1 pt-3">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-fg-3">
          {title}
        </span>
        {count != null && count > 0 && (
          <span className="font-mono text-[10px] text-fg-4">{count}</span>
        )}
      </div>
      {empty ? (
        <div className="flex flex-col items-center gap-1.5 px-4 py-6 text-center">
          {EmptyIcon && <EmptyIcon size={18} className="text-fg-4" />}
          <span className="text-[12px] text-fg-3">{emptyText}</span>
        </div>
      ) : (
        children
      )}
    </div>
  );
}

function PanelSkeleton() {
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="h-8 w-40 rounded bg-surface-2 " />
      {Array.from({ length: 4 }, (_, i) => (
        <div
          key={i}
          className="h-12 rounded bg-surface-2/60 "
        />
      ))}
    </div>
  );
}
