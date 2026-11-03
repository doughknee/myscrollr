import { useEffect } from "react";
import { prerelease, valid } from "semver";
import { open } from "@tauri-apps/plugin-shell";
import { updateController, useUpdateController } from "../../../lib/updateController";
import { channelLocked, updateBusy } from "../../../lib/updateState";
import { RowList, SettingsButton, SettingsGroup, SegmentedRow } from "../SettingsControls";
import ReleaseNotes from "../ReleaseNotes";
import PageHeader from "./PageHeader";
import { Row } from "./Row";
import { SETTINGS_ROWS } from "../rows";
import type { UpdateSnapshot } from "../../../lib/updateState";

export function updateDescription(s: UpdateSnapshot): string {
  switch (s.phase) {
    case "initializing": return "Loading update preferences…";
    case "selecting": return "Saving update channel…";
    case "checking": return "Checking for updates…";
    case "available": return `Version ${s.version} is available.`;
    case "downloading": return "Downloading and verifying update…";
    case "installing": return "Installing update. Scrollr may close and reopen.";
    case "restarting": return "Restarting Scrollr…";
    case "ready": return "Update installed. Restart to apply it.";
    case "current": return `You have the latest approved ${s.channel === "beta" ? "Beta channel" : "Stable"} release.`;
    case "waiting": return `Your installed version is ahead of the ${s.channel === "beta" ? "Beta" : "Stable"} channel. Scrollr will wait for a newer release; it will not downgrade.`;
    case "error": return "Could not complete the update. Your installed version has not been confirmed as current.";
    default: return SETTINGS_ROWS.updates.checkNow.description;
  }
}

export default function UpdatesPage({ appVersion }: { appVersion?: string }) {
  const state = useUpdateController();
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
            {state.channel === "beta" && " You can return to Stable here; Scrollr will wait until a newer stable version is available."}
            {state.suggestBeta && " You installed a beta manually. Choose Beta above if you want future beta updates."}
            {state.phase === "ready" && " Restart before changing channels."}
          </p>
        </Row>
        <Row id="checkNow">
          <div className="space-y-3 px-4 py-4" aria-live="polite">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-ui-body font-medium text-fg">{updateDescription(state)}</p>
                {state.error && <p role="alert" className="mt-2 break-words text-ui-meta text-error">{state.error}</p>}
              </div>
              {!busy && (state.phase === "ready"
                ? <SettingsButton tone="accent" onClick={() => { void updateController.restart(); }}>Restart now</SettingsButton>
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
            {(state.phase === "available" || state.phase === "error") && <SettingsButton onClick={() => {
              const url = state.version ? `https://github.com/doughknee/myscrollr/releases/tag/desktop-v${encodeURIComponent(state.version)}` : "https://github.com/doughknee/myscrollr/releases";
              void open(url).catch(() => {});
            }}>View releases and installers</SettingsButton>}
          </div>
        </Row>
      </RowList>
    </SettingsGroup>
    <div data-row="releaseHistory" className="mt-5"><ReleaseNotes /></div>
  </>;
}
