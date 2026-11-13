import { useEffect, useRef } from "react";
import { prerelease, valid } from "semver";
import { openExternal } from "../../../lib/openExternal";
import { updateController, useUpdateController } from "../../../lib/updateController";
import { channelLocked, updateBusy } from "../../../lib/updateState";
import { RowList, SettingsButton, SettingsGroup, SegmentedRow } from "../SettingsControls";
import ReleaseNotes from "../ReleaseNotes";
import ConfirmDialog from "../../ConfirmDialog";
import UpdateErrorNotice from "../../UpdateErrorNotice";
import PageHeader from "./PageHeader";
import { Row } from "./Row";
import { SETTINGS_ROWS } from "../rows";
import type { UpdateSnapshot } from "../../../lib/updateState";

export function updateDescription(s: UpdateSnapshot): string {
  switch (s.phase) {
    case "initializing": return "Loading update preferences…";
    case "selecting": return "Saving update channel…";
    case "checking": return "Checking for updates…";
    case "recovery": return `Ready to return to Stable ${s.version}. Review the change before installing.`;
    case "available": return `Version ${s.version} is available.`;
    case "downloading": return "Downloading and verifying update…";
    case "installing": return "Installing update. Scrollr may close and reopen.";
    case "restarting": return "Restarting Scrollr…";
    case "ready": return "Update installed. Restart to apply it.";
    case "current": return `You have the latest approved ${s.channel === "beta" ? "Beta channel" : "Stable"} release.`;
    case "waiting": return `Your installed version is ahead of the ${s.channel === "beta" ? "Beta" : "Stable"} channel. Automatic updates will wait for a newer release.`;
    case "error": return "Could not complete the update. Your installed version has not been confirmed as current.";
    default: return SETTINGS_ROWS.updates.checkNow.description;
  }
}

export default function UpdatesPage({ appVersion }: { appVersion?: string }) {
  const state = useUpdateController();
  const recoveryControl = useRef<HTMLDivElement>(null);
  useEffect(() => { void updateController.initialize(); }, []);
  const installed = state.currentVersion || appVersion || "";
  const betaBuild = valid(installed) && prerelease(installed);
  const busy = updateBusy(state);
  const progress = state.total ? Math.min(100, Math.round(state.downloaded / state.total * 100)) : undefined;
  return <>
    <PageHeader title="Updates" subtitle={<>
      Installed <span className="font-mono text-accent">{installed ? `v${installed}` : "—"}</span>
      {betaBuild && <span className="ml-2 rounded bg-accent/10 px-2 py-0.5 text-accent">Beta build</span>}
    </>} />
    <SettingsGroup>
      <RowList>
        <Row id="releaseChannel">
          <fieldset disabled={!state.initialized || channelLocked(state)} className="min-w-0 disabled:opacity-60">
            <SegmentedRow label={SETTINGS_ROWS.updates.releaseChannel.label}
              description="Choose updates for this device. Switching channels does not install anything."
              value={state.channel} options={[{ value: "stable", label: "Stable" }, { value: "beta", label: "Beta" }]}
              onChange={channel => { void updateController.selectChannel(channel); }} />
          </fieldset>
          <p className="px-4 pb-3 text-ui-meta leading-relaxed text-fg-3">
            Beta includes early releases that may have bugs, plus newer stable releases. It uses your usual Scrollr account and data.
            {state.channel === "beta" && " Choose Stable to stop receiving beta updates. To replace an installed beta, use Return to Stable when a verified recovery is available."}
            {state.suggestBeta && " You are running a beta build while Stable updates are selected."}
            {state.phase === "ready" && " Restart before changing channels."}
          </p>
        </Row>
        <Row id="checkNow">
          <div className="space-y-3 px-4 py-4" aria-live="polite">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-ui-body font-medium text-fg">{updateDescription(state)}</p>
                <UpdateErrorNotice state={state} className="mt-2" />
              </div>
              {!busy && (state.phase === "ready"
                ? <SettingsButton tone="accent" onClick={() => { void updateController.restart(); }}>Restart now</SettingsButton>
                : state.phase === "recovery"
                  ? null
                : state.phase === "available"
                  ? <SettingsButton tone="accent" onClick={() => { void updateController.install(state.offerId); }}>Download &amp; install</SettingsButton>
                  : <SettingsButton onClick={() => { void updateController.check(); }}>{state.phase === "error" ? "Retry" : "Check now"}</SettingsButton>)}
            </div>
            {state.phase === "downloading" && <>
              <div role="progressbar" aria-label="Update download" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}
                className="h-1 overflow-hidden rounded bg-base-300">
                <div className="h-full rounded bg-accent" style={{ width: progress === undefined ? "30%" : `${progress}%` }} />
              </div>
              <p className="text-ui-meta text-fg-3">{(state.downloaded / 1_048_576).toFixed(1)} MB downloaded{progress !== undefined ? ` · ${progress}%` : ""}</p>
            </>}
            {state.phase === "available" && state.body && <p className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-ui-meta leading-relaxed text-fg-3">{state.body}</p>}
            {state.phase === "waiting" && state.recoveryVersion && <div ref={recoveryControl}><SettingsButton tone="accent" onClick={() => { void updateController.prepareRecovery(); }}>Return to Stable {state.recoveryVersion}…</SettingsButton></div>}
            {betaBuild && state.channel === "stable" && !busy && state.phase !== "ready" && <div className="space-y-2">
              {state.phase === "waiting" && !state.recoveryVersion && <p className="text-ui-meta text-fg-3">In-app recovery is not verified for this version or installer. Recovery instructions cover the supported options.</p>}
              <SettingsButton onClick={() => { void openExternal("https://github.com/doughknee/myscrollr/blob/main/docs/beta-recovery.md").catch(() => {}); }}>Beta recovery instructions</SettingsButton>
            </div>}
            {(state.phase === "available" || state.phase === "error") && <SettingsButton onClick={() => {
              const url = state.version ? `https://github.com/doughknee/myscrollr/releases/tag/desktop-v${encodeURIComponent(state.version)}` : "https://github.com/doughknee/myscrollr/releases";
              void openExternal(url).catch(() => {});
            }}>View releases and installers</SettingsButton>}
          </div>
        </Row>
      </RowList>
    </SettingsGroup>
    <ConfirmDialog open={state.phase === "recovery"} title={`Return to Stable ${state.version}?`}
      restoreFocus={() => recoveryControl.current?.querySelector("button") ?? null}
      description={`Replace installed ${installed} with Stable ${state.version}. Fill this display will be unavailable; the ticker returns to docking. Your account and compatible preferences stay in place. Scrollr may close and restart. Future updates will use Stable.`}
      confirmLabel={`Install Stable ${state.version}`} onCancel={() => { void updateController.cancelRecovery(); }}
      onConfirm={() => { void updateController.installRecovery(state.offerId); }} />
    <div data-row="releaseHistory" className="mt-5"><ReleaseNotes channel={state.channel} installedVersion={installed} approvedVersion={state.feedVersion} /></div>
  </>;
}
