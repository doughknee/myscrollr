import { useState, useCallback, useRef, useEffect } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getStore, setStore, removeStore } from "../../lib/store";
import clsx from "clsx";

// ── Updater storage keys ────────────────────────────────────────
//
// `lastUpdateDate` is the pub_date of the currently running build, used
// to distinguish "up to date" from "same version, different pub_date"
// (rebuild without version bump).
//
// `pendingUpdate` is written when `downloadAndInstall` completes but
// BEFORE the new build is actually running (the user still needs to
// relaunch). On next mount we promote it to `lastUpdateDate` only
// when the running version matches — otherwise we know the download
// never took effect (user dismissed relaunch, app crashed, etc.).
const KEY_LAST_UPDATE_DATE = "scrollr:lastUpdateDate";
const KEY_PENDING_UPDATE = "scrollr:pendingUpdate";

interface PendingUpdate {
  version: string;
  date: string;
}
import type {
  AppearancePrefs,
  WindowPrefs,
  Theme,
} from "../../preferences";
import {
  Section,
  ToggleRow,
  SegmentedRow,
  DisplayRow,
  ResetButton,
} from "./SettingsControls";

// ── Update state machine ────────────────────────────────────────

type UpdateStatus =
  | { step: "idle" }
  | { step: "checking" }
  | { step: "up-to-date" }
  | { step: "available"; version: string; body: string }
  | { step: "downloading"; downloaded: number; total: number }
  | { step: "ready" }
  | { step: "error"; message: string };

// ── Props ───────────────────────────────────────────────────────

interface GeneralSettingsProps {
  appearance: AppearancePrefs;
  window_: WindowPrefs;
  onAppearanceChange: (prefs: AppearancePrefs) => void;
  onWindowChange: (prefs: WindowPrefs) => void;
  onReset: () => void;
  autostartEnabled: boolean;
  onAutostartChange: (enabled: boolean) => void;
  appVersion: string;
}

// ── Options ─────────────────────────────────────────────────────

const THEME_OPTIONS: { value: Theme; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "Auto" },
];

const SCALE_PRESETS: { value: string; label: string }[] = [
  { value: "85", label: "85%" },
  { value: "100", label: "100%" },
  { value: "115", label: "115%" },
  { value: "130", label: "130%" },
];

const FONT_WEIGHT_OPTIONS: { value: string; label: string }[] = [
  { value: "normal", label: "Normal" },
  { value: "medium", label: "Medium" },
  { value: "bold", label: "Bold" },
];

// ── Component ───────────────────────────────────────────────────

export default function GeneralSettings({
  appearance,
  window_,
  onAppearanceChange,
  onWindowChange,
  onReset,
  autostartEnabled,
  onAutostartChange,
  appVersion,
}: GeneralSettingsProps) {
  const [status, setStatus] = useState<UpdateStatus>({ step: "idle" });
  const pendingUpdate = useRef<Update | null>(null);

  // Reconcile pending-update state: if we previously downloaded an update
  // and the app is now running that exact version, promote the pending
  // pub_date to `lastUpdateDate`. If versions don't match, the user never
  // relaunched — drop the pending record so subsequent "check" calls don't
  // falsely report up-to-date.
  useEffect(() => {
    if (!appVersion) return;
    const pending = getStore<PendingUpdate | null>(KEY_PENDING_UPDATE, null);
    if (!pending) return;
    if (pending.version === appVersion) {
      setStore(KEY_LAST_UPDATE_DATE, pending.date);
    }
    removeStore(KEY_PENDING_UPDATE);
  }, [appVersion]);

  const setApp = <K extends keyof AppearancePrefs>(
    key: K,
    value: AppearancePrefs[K],
  ) => {
    onAppearanceChange({ ...appearance, [key]: value });
  };

  const handleCheckForUpdates = useCallback(async () => {
    setStatus({ step: "checking" });
    try {
      const update = await check();
      if (!update) {
        pendingUpdate.current = null;
        setStatus({ step: "up-to-date" });
        return;
      }

      // Same-version patch detection: when the remote version matches
      // the installed version, we suppress the "update available" UI
      // unless the remote pub_date has changed since we last recorded
      // it. KEY_LAST_UPDATE_DATE is normally seeded by the
      // post-downloadAndInstall reconcile loop above (lines 107-115).
      // For users who installed via a manual download (Windows MSI in
      // particular), that loop never runs, so the store stays empty
      // and every check used to false-positive. The empty-store branch
      // below seeds the date once on first check, then the existing
      // match-suppression takes over on subsequent checks.
      if (update.version === appVersion) {
        const storedDate = getStore<string | null>(KEY_LAST_UPDATE_DATE, null);
        if (storedDate === null) {
          // First in-app check on a build the in-app updater never
          // installed. Trust the remote pub_date and seed.
          setStore(KEY_LAST_UPDATE_DATE, update.date);
          pendingUpdate.current = null;
          setStatus({ step: "up-to-date" });
          return;
        }
        if (update.date === storedDate) {
          pendingUpdate.current = null;
          setStatus({ step: "up-to-date" });
          return;
        }
        // Stored date differs from remote: a genuine same-version
        // patched rebuild has shipped. Fall through to "available".
      }

      const isPatch = update.version === appVersion;
      pendingUpdate.current = update;
      setStatus({
        step: "available",
        version: update.version,
        body: isPatch
          ? "A patched build of your current version is available."
          : (update.body ?? ""),
      });
    } catch (err) {
      setStatus({
        step: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, [appVersion]);

  const handleDownloadAndInstall = useCallback(async () => {
    const update = pendingUpdate.current;
    if (!update) {
      setStatus({ step: "error", message: "No update available. Try checking again." });
      return;
    }

    setStatus({ step: "downloading", downloaded: 0, total: 0 });
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === "Started" && event.data.contentLength) {
          setStatus((prev) =>
            prev.step === "downloading"
              ? { ...prev, total: event.data.contentLength ?? 0 }
              : prev,
          );
        } else if (event.event === "Progress") {
          setStatus((prev) =>
            prev.step === "downloading"
              ? { ...prev, downloaded: prev.downloaded + (event.data.chunkLength ?? 0) }
              : prev,
          );
        }
      });

      // The new build is downloaded but NOT YET RUNNING — the user still
      // has to relaunch. Write to `pendingUpdate` instead of `lastUpdateDate`
      // so that if the user never relaunches we don't falsely report the
      // new build as installed on the next check. The reconcile useEffect
      // above promotes pending → lastUpdateDate once a later session is
      // actually running at `update.version`.
      if (update.date && update.version) {
        const pending: PendingUpdate = {
          version: update.version,
          date: update.date,
        };
        setStore(KEY_PENDING_UPDATE, pending);
      }

      setStatus({ step: "ready" });
    } catch (err) {
      setStatus({
        step: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  const handleRelaunch = useCallback(async () => {
    try {
      await relaunch();
    } catch (err) {
      setStatus({
        step: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  return (
    <div>
      <Section title="Appearance">
        <SegmentedRow
          label="Color mode"
          description="Choose light or dark colors"
          value={appearance.theme}
          options={THEME_OPTIONS}
          onChange={(v) => setApp("theme", v)}
        />
        <SegmentedRow
          label="Display size"
          description="Make everything bigger or smaller"
          value={String(appearance.uiScale)}
          options={SCALE_PRESETS}
          onChange={(v) => setApp("uiScale", Number(v) as AppearancePrefs["uiScale"])}
        />
        <SegmentedRow
          label="Font weight"
          description="Increase text thickness for readability"
          value={appearance.fontWeight}
          options={FONT_WEIGHT_OPTIONS}
          onChange={(v) => setApp("fontWeight", v as AppearancePrefs["fontWeight"])}
        />
        <ToggleRow
          label="High contrast text"
          description="Brighten muted text for easier reading"
          checked={appearance.highContrast}
          onChange={(v) => setApp("highContrast", v)}
        />
      </Section>

      <Section title="Window">
        <ToggleRow
          label="Always on top"
          description="Keep the ticker above all other windows"
          checked={window_.pinned}
          onChange={(v) => onWindowChange({ ...window_, pinned: v })}
        />
      </Section>

      <Section title="Startup">
        <ToggleRow
          label="Launch on system startup"
          description="Automatically open Scrollr when you start your computer"
          checked={autostartEnabled}
          onChange={onAutostartChange}
        />
      </Section>

      <Section title="Keyboard shortcuts">
        <ShortcutsList />
      </Section>

      <Section title="About">
        <DisplayRow label="Version" value={appVersion ? `v${appVersion}` : "\u2014"} />
      </Section>

      <Section title="Updates">
        <UpdateRow
          status={status}
          onCheck={handleCheckForUpdates}
          onDownload={handleDownloadAndInstall}
          onRelaunch={handleRelaunch}
        />
      </Section>

      <div className="flex items-center justify-end pt-2">
        <ResetButton label="Reset general settings" onClick={onReset} />
      </div>
    </div>
  );
}

// ── Keyboard shortcuts list (read-only) ─────────────────────────
//
// The desktop app already implements these shortcuts in __root.tsx —
// this component just documents them where users can find them.
// Customization is intentionally out of scope for now.

const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ["⌘/Ctrl", ","], label: "Open settings" },
  { keys: ["⌘/Ctrl", "T"], label: "Toggle ticker visibility" },
  { keys: ["⌘/Ctrl", "Shift", "T"], label: "Cycle theme (light → dark → auto)" },
  { keys: ["Esc"], label: "Back / close current view" },
];

function ShortcutsList() {
  return (
    <div className="px-3 py-2 space-y-1.5">
      {SHORTCUTS.map(({ keys, label }) => (
        <div key={label} className="flex items-center justify-between py-1">
          <span className="text-[12px] text-fg-3">{label}</span>
          <div className="flex items-center gap-1">
            {keys.map((k, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <span className="text-[10px] text-fg-4">+</span>}
                <kbd className="px-1.5 py-0.5 rounded bg-base-250 border border-edge/40 text-[10px] font-mono font-medium text-fg-2 shadow-sm">
                  {k}
                </kbd>
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Update row component ────────────────────────────────────────

interface UpdateRowProps {
  status: UpdateStatus;
  onCheck: () => void;
  onDownload: () => void;
  onRelaunch: () => void;
}

function UpdateRow({ status, onCheck, onDownload, onRelaunch }: UpdateRowProps) {
  switch (status.step) {
    case "idle":
      return (
        <div className="flex items-center justify-between px-3 py-2.5 rounded-lg">
          <span className="text-[12px] text-fg-3">Check for new versions</span>
          <button
            onClick={onCheck}
            className="text-[11px] font-medium px-2.5 py-1 rounded-md bg-base-250 text-fg-3 hover:text-fg-2 hover:bg-base-300 transition-all duration-150 active:scale-95 cursor-pointer"
          >
            Check for updates
          </button>
        </div>
      );

    case "checking":
      return (
        <div className="flex items-center justify-between px-3 py-2.5 rounded-lg">
          <span className="text-[12px] text-fg-3">Checking for updates...</span>
          <div className="w-4 h-4 border-2 border-fg-4 border-t-accent rounded-full animate-spin" />
        </div>
      );

    case "up-to-date":
      return (
        <div className="flex items-center justify-between px-3 py-2.5 rounded-lg">
          <div className="flex flex-col gap-0.5">
            <span className="text-[12px] text-accent leading-tight">
              You're on the latest version
            </span>
          </div>
          <button
            onClick={onCheck}
            className="text-[11px] font-medium px-2.5 py-1 rounded-md text-fg-4 hover:text-fg-2 hover:bg-base-250/50 transition-all duration-150 active:scale-95 cursor-pointer"
          >
            Check again
          </button>
        </div>
      );

    case "available":
      return (
        <div className="flex flex-col gap-2 px-3 py-2.5 rounded-lg">
          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-0.5">
              <span className="text-[12px] text-fg-2 leading-tight">
                Update available: <span className="text-accent font-semibold">v{status.version}</span>
              </span>
            </div>
            <button
              onClick={onDownload}
              className="text-[11px] font-semibold px-2.5 py-1 rounded-md bg-accent text-surface hover:bg-accent/90 transition-all duration-150 active:scale-95 cursor-pointer shrink-0 ml-4"
            >
              Download & install
            </button>
          </div>
          {status.body && (
            <div className="max-h-32 overflow-y-auto scrollbar-thin rounded-md bg-base-200/50 px-2.5 py-2">
              <p className="text-[11px] text-fg-4 leading-relaxed whitespace-pre-wrap">
                {status.body}
              </p>
            </div>
          )}
        </div>
      );

    case "downloading": {
      const pct = status.total > 0
        ? Math.min(100, Math.round((status.downloaded / status.total) * 100))
        : 0;
      return (
        <div className="flex flex-col gap-2 px-3 py-2.5 rounded-lg">
          <div className="flex items-center justify-between">
            <span className="text-[12px] text-fg-3 leading-tight">
              Downloading update...
            </span>
            <span className="text-[11px] text-fg-4 tabular-nums">
              {status.total > 0 ? `${pct}%` : "..."}
            </span>
          </div>
          <div
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Download progress"
            className="w-full h-1 rounded-full bg-base-300 overflow-hidden"
          >
            <div
              className={clsx(
                "h-full rounded-full transition-all duration-300",
                status.total > 0 ? "bg-accent" : "bg-accent/50 motion-safe:animate-pulse",
              )}
              style={{ width: status.total > 0 ? `${pct}%` : "30%" }}
            />
          </div>
        </div>
      );
    }

    case "ready":
      return (
        <div className="flex items-center justify-between px-3 py-2.5 rounded-lg">
          <div className="flex flex-col gap-0.5">
            <span className="text-[12px] text-accent leading-tight">
              Update installed
            </span>
            <span className="text-[11px] text-fg-4 leading-tight">
              Restart to apply the update
            </span>
          </div>
          <button
            onClick={onRelaunch}
            className="text-[11px] font-semibold px-2.5 py-1 rounded-md bg-accent text-surface hover:bg-accent/90 transition-all duration-150 active:scale-95 cursor-pointer"
          >
            Restart now
          </button>
        </div>
      );

    case "error":
      return (
        <div className="flex items-center justify-between px-3 py-2.5 rounded-lg">
          <div className="flex flex-col gap-0.5">
            <span className="text-[12px] text-error leading-tight">
              Couldn't check for updates
            </span>
            <span className="text-[11px] text-fg-4 leading-tight line-clamp-1">
              {status.message}
            </span>
          </div>
          <button
            onClick={onCheck}
            className="text-[11px] font-medium px-2.5 py-1 rounded-md text-fg-4 hover:text-fg-2 hover:bg-base-250/50 transition-all duration-150 active:scale-95 cursor-pointer"
          >
            Retry
          </button>
        </div>
      );
  }
}
