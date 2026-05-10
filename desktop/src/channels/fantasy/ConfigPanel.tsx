import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Ghost, Link2, Loader2 } from "lucide-react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { open } from "@tauri-apps/plugin-shell";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import UpgradePrompt from "../../components/UpgradePrompt";
import { authFetch } from "../../api/client";
import {
  fantasyStatusOptions,
  fantasyLeaguesOptions,
  queryKeys,
} from "../../api/queries";
import { getLimit } from "../../tierLimits";
import { LeaguePicker } from "./LeaguePicker";
import { ImportProgress } from "./ImportProgress";
import { ConnectedView } from "./ConnectedView";
import type { Channel } from "../../api/client";
import type { SubscriptionTier } from "../../auth";
import type { LeagueResponse, DiscoveredLeague } from "./types";
import type { ImportStatus } from "./ImportProgress";

// ── Local types ──────────────────────────────────────────────────

type Phase =
  | "disconnected"
  | "discovering"
  | "picking"
  | "importing"
  | "connected";

// ── Props ────────────────────────────────────────────────────────

interface FantasyConfigPanelProps {
  channel: Channel;
  subscriptionTier: SubscriptionTier;
  hex: string;
}

// ── Main Component ───────────────────────────────────────────────

export default function FantasyConfigPanel({
  channel: _channel,
  subscriptionTier,
  hex,
}: FantasyConfigPanelProps) {
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<Phase>("disconnected");
  const [awaitingYahoo, setAwaitingYahoo] = useState(false);
  const phaseInitRef = useRef(false);

  const { data: statusData } = useQuery({
    ...fantasyStatusOptions(),
    refetchInterval: awaitingYahoo ? 2000 : false,
  });

  const { data: leaguesData } = useQuery({
    ...fantasyLeaguesOptions(),
  });

  const yahooConnected = statusData?.connected ?? false;
  const leagues: LeagueResponse[] = (leaguesData?.leagues ?? []) as LeagueResponse[];

  const maxFantasy = getLimit(subscriptionTier, "fantasy");
  const remainingCapacity = Math.max(0, maxFantasy - leagues.length);
  const atLeagueLimit = leagues.length >= maxFantasy;

  // Determine initial phase from query data
  const initialPhase = useMemo(
    (): Phase => (statusData && yahooConnected ? "connected" : "disconnected"),
    [statusData, yahooConnected],
  );

  // Sync phase from query data on initial load
  useEffect(() => {
    if (statusData && !phaseInitRef.current) {
      phaseInitRef.current = true;
      setPhase(initialPhase);
    }
  }, [statusData, initialPhase]);

  const [noLeaguesFound, setNoLeaguesFound] = useState(false);
  const [discoveredLeagues, setDiscoveredLeagues] = useState<
    DiscoveredLeague[]
  >([]);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [importStatuses, setImportStatuses] = useState<
    Record<string, ImportStatus>
  >({});
  const [discoverError, setDiscoverError] = useState<string | null>(null);

  // ── League discovery ───────────────────────────────────────────

  const discoverMutation = useMutation({
    mutationFn: () =>
      authFetch<{ leagues: DiscoveredLeague[]; error?: string }>(
        "/users/me/yahoo-leagues/discover",
        { method: "POST" },
      ),
    onSuccess: (result) => {
      if (result.error) {
        setDiscoverError(result.error);
        setPhase(leagues.length > 0 ? "connected" : "disconnected");
        return;
      }
      const discovered = result.leagues || [];
      setDiscoveredLeagues(discovered);
      const alreadyImported = new Set(leagues.map((l) => l.league_key));
      const newLeagues = discovered.filter(
        (l) => !alreadyImported.has(l.league_key),
      );
      if (newLeagues.length === 0) {
        // Tell the user whether Yahoo had zero leagues total or just
        // no *new* ones to import.
        if (discovered.length === 0) {
          setNoLeaguesFound(true);
          toast.info("No fantasy leagues found on your Yahoo account");
        } else {
          setNoLeaguesFound(false);
          toast.info("All your Yahoo leagues are already imported");
        }
        setPhase("connected");
        return;
      }
      setNoLeaguesFound(false);
      const preSelected = new Set(
        newLeagues
          .filter((l) => !l.is_finished)
          .map((l) => l.league_key)
          .slice(0, remainingCapacity),
      );
      setSelectedKeys(preSelected);
      setPhase("picking");
    },
    onError: (err: Error) => {
      setDiscoverError(
        err.message || "Something went wrong while looking for your leagues",
      );
      setPhase(leagues.length > 0 ? "connected" : "disconnected");
    },
  });

  const startDiscovery = useCallback(() => {
    setPhase("discovering");
    setDiscoverError(null);
    setNoLeaguesFound(false);
    setDiscoveredLeagues([]);
    discoverMutation.mutate();
  }, [discoverMutation]);

  // ── Import selected leagues ────────────────────────────────────

  const importLeagueMutation = useMutation({
    mutationFn: (league: DiscoveredLeague) =>
      authFetch<{ status: string; error?: string }>(
        "/users/me/yahoo-leagues/import",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            league_key: league.league_key,
            game_code: league.game_code,
            season: league.season,
          }),
        },
      ),
  });

  const importSelected = useCallback(async () => {
    const keys = Array.from(selectedKeys).slice(0, remainingCapacity);
    if (keys.length === 0) return;

    setPhase("importing");

    const statuses: Record<string, ImportStatus> = {};
    for (const key of keys) statuses[key] = "pending";
    setImportStatuses({ ...statuses });

    for (const key of keys) {
      const league = discoveredLeagues.find((l) => l.league_key === key);
      if (!league) continue;

      statuses[key] = "importing";
      setImportStatuses({ ...statuses });

      try {
        const result = await importLeagueMutation.mutateAsync(league);
        statuses[key] = result.error ? "error" : "done";
        // Invalidate the dashboard as soon as each league finishes so the
        // Feed tab can show the newly-synced data immediately rather than
        // waiting for the next 120s sync cycle.
        if (!result.error) {
          queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
        }
      } catch {
        statuses[key] = "error";
      }
      setImportStatuses({ ...statuses });
    }

    const doneCount = Object.values(statuses).filter((s) => s === "done").length;
    const errorCount = Object.values(statuses).filter((s) => s === "error").length;
    if (errorCount === 0) {
      toast.success(`${doneCount} league${doneCount === 1 ? "" : "s"} imported`);
    } else if (doneCount > 0) {
      toast.info(`${doneCount} imported, ${errorCount} failed`);
    } else {
      toast.error("League import failed");
    }

    // The dashboard query is what powers the Feed tab — without this
    // invalidation the user can go from Configure to Feed and see stale
    // data until the 120s sync cycle or another refetch trigger fires.
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.fantasy.leagues }),
      queryClient.invalidateQueries({ queryKey: queryKeys.fantasy.status }),
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
    ]);
    setPhase("connected");
  }, [selectedKeys, discoveredLeagues, queryClient, importLeagueMutation, remainingCapacity]);

  // ── Detect Yahoo connection via polling ─────────────────────────

  useEffect(() => {
    if (awaitingYahoo && statusData?.connected) {
      setAwaitingYahoo(false);
      toast.success("Yahoo account connected");
      queryClient.invalidateQueries({ queryKey: queryKeys.fantasy.leagues });
      startDiscovery();
    }
  }, [awaitingYahoo, statusData, queryClient, startDiscovery]);

  // ── Timeout if Yahoo sign-in takes too long ───────────────────

  useEffect(() => {
    if (!awaitingYahoo) return;
    const timeout = setTimeout(() => {
      setAwaitingYahoo(false);
      toast.error("Yahoo sign-in timed out — try again");
    }, 5 * 60 * 1000);
    return () => clearTimeout(timeout);
  }, [awaitingYahoo]);

  // ── Yahoo connect / disconnect ─────────────────────────────────

  const handleYahooConnect = useCallback(async () => {
    // /yahoo/start requires the Bearer header (it's Auth: true on the
    // gateway), but the system browser launched by shell::open cannot
    // carry it. So we ask the server for the Yahoo consent URL via an
    // authenticated JSON request, then open the returned URL externally.
    try {
      const { redirect_url } = await authFetch<{ redirect_url: string }>(
        "/yahoo/start?response=json",
        { headers: { Accept: "application/json" } },
      );
      if (!redirect_url) {
        toast.error("Couldn't start Yahoo sign-in");
        return;
      }
      await open(redirect_url);
      setAwaitingYahoo(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      if (msg.toLowerCase().includes("unauthorized") || msg.toLowerCase().includes("authentication")) {
        toast.error("Sign in to your account first");
      } else {
        toast.error("Couldn't open Yahoo sign-in");
      }
    }
  }, []);

  const disconnectMutation = useMutation({
    mutationFn: () =>
      authFetch("/users/me/yahoo", { method: "DELETE" }),
    onSuccess: () => {
      queryClient.setQueryData(queryKeys.fantasy.status, { connected: false, synced: false });
      queryClient.setQueryData(queryKeys.fantasy.leagues, { leagues: [] });
      setPhase("disconnected");
      phaseInitRef.current = false;
      toast.success("Yahoo account disconnected");
    },
    onError: (err) => {
      console.error("[Fantasy] disconnect failed:", err);
      toast.error("Couldn't disconnect Yahoo account");
    },
  });

  const handleYahooDisconnect = useCallback(() => {
    disconnectMutation.mutate();
  }, [disconnectMutation]);

  // ── Picking helpers ────────────────────────────────────────────

  const alreadyImported = new Set(leagues.map((l) => l.league_key));
  const pickableLeagues = discoveredLeagues.filter(
    (l) => !alreadyImported.has(l.league_key),
  );

  const toggleLeague = (key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else if (next.size < remainingCapacity) {
        next.add(key);
      }
      return next;
    });
  };
  const selectAll = () =>
    setSelectedKeys(
      new Set(
        pickableLeagues
          .map((l) => l.league_key)
          .slice(0, remainingCapacity),
      ),
    );
  const deselectAll = () => setSelectedKeys(new Set());

  // ── Render ─────────────────────────────────────────────────────

  return (
    <div className="w-full max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6 px-3">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center"
          style={{
            background: `${hex}30`,
            boxShadow: `0 0 15px ${hex}30, 0 0 0 1px ${hex}30`,
          }}
        >
          <Ghost size={16} style={{ color: hex }} />
        </div>
        <div>
          <h2 className="text-sm font-bold text-fg">Fantasy</h2>
          <p className="text-[11px] text-fg-3">Yahoo Fantasy Sports</p>
        </div>
      </div>

      {/* ── FREE TIER GATE ────────────────────────────────────── */}
      {maxFantasy === 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center py-10 space-y-4 px-3"
        >
          <Ghost size={40} className="mx-auto text-fg-3/30" />
          <div className="space-y-2">
            <p className="text-sm font-bold text-fg-2">Fantasy Sports</p>
            <p className="text-[12px] text-fg-3 max-w-xs mx-auto">
              Track your Yahoo Fantasy leagues with live scores, standings,
              and rosters.
            </p>
          </div>
          <UpgradePrompt
            max={0}
            noun="Fantasy leagues"
            tier={subscriptionTier}
          />
        </motion.div>
      )}

      {/* ── DISCONNECTED ──────────────────────────────────────── */}
      {maxFantasy > 0 && phase === "disconnected" && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center py-10 space-y-4 px-3"
        >
          <Ghost size={40} className="mx-auto text-fg-3/30" />
          <div className="space-y-2">
            <p className="text-sm font-bold text-fg-2">No Leagues Connected</p>
            <p className="text-[12px] text-fg-3 max-w-xs mx-auto">
              Connect your Yahoo account to see your fantasy leagues, matchup
              scores, standings, and rosters.
            </p>
          </div>
          {discoverError && (
            <p className="text-[12px] text-error max-w-xs mx-auto">
              {discoverError}
            </p>
          )}
          <button
            onClick={handleYahooConnect}
            disabled={awaitingYahoo}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] font-medium text-white transition-colors cursor-pointer disabled:opacity-60"
            style={{ background: hex }}
          >
            {awaitingYahoo ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Waiting for Yahoo sign-in…
              </>
            ) : (
              <>
                <Link2 size={14} />
                Connect Yahoo Account
              </>
            )}
          </button>
        </motion.div>
      )}

      {/* ── DISCOVERING ───────────────────────────────────────── */}
      {phase === "discovering" && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center py-10 space-y-4 px-3"
        >
          <div className="flex items-center justify-center gap-1.5 h-6">
            {[0, 1, 2, 3, 4].map((i) => (
              <motion.div
                key={i}
                className="w-1.5 rounded-full origin-center"
                style={{ height: 8, background: hex }}
                animate={{
                  scaleY: [1, 3, 1],
                  opacity: [0.3, 1, 0.3],
                }}
                transition={{
                  duration: 1,
                  repeat: Infinity,
                  delay: i * 0.12,
                  ease: "easeInOut",
                }}
              />
            ))}
          </div>
          <div className="space-y-2">
            <p
              className="text-sm font-bold"
              style={{ color: `${hex}B3` }}
            >
              Finding Your Leagues
            </p>
            <p className="text-[12px] text-fg-3 max-w-xs mx-auto">
              Looking through your Yahoo Fantasy account for leagues across all
              sports.
            </p>
          </div>
        </motion.div>
      )}

      {/* ── PICKING ───────────────────────────────────────────── */}
      {phase === "picking" && (
        <LeaguePicker
          pickableLeagues={pickableLeagues}
          selectedKeys={selectedKeys}
          onToggle={toggleLeague}
          onSelectAll={selectAll}
          onDeselectAll={deselectAll}
          onImport={importSelected}
          onSkip={() =>
            setPhase(leagues.length > 0 ? "connected" : "disconnected")
          }
          atLeagueLimit={atLeagueLimit}
          leagueCount={leagues.length}
          maxLeagues={maxFantasy}
          remainingCapacity={remainingCapacity}
          subscriptionTier={subscriptionTier}
          hex={hex}
        />
      )}

      {/* ── IMPORTING ─────────────────────────────────────────── */}
      {phase === "importing" && (
        <ImportProgress
          selectedKeys={selectedKeys}
          discoveredLeagues={discoveredLeagues}
          importStatuses={importStatuses}
          hex={hex}
        />
      )}

      {/* ── CONNECTED ─────────────────────────────────────────── */}
      {phase === "connected" && (
        <ConnectedView
          leagues={leagues}
          yahooConnected={yahooConnected}
          atLeagueLimit={atLeagueLimit}
          maxLeagues={maxFantasy}
          subscriptionTier={subscriptionTier}
          hex={hex}
          noLeaguesFound={noLeaguesFound}
          onStartDiscovery={startDiscovery}
          onDisconnect={handleYahooDisconnect}
        />
      )}
    </div>
  );
}
