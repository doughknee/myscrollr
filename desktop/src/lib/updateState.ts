import { gt, gte, prerelease, valid } from "semver";
import type { DownloadEvent } from "@tauri-apps/plugin-updater";

export type UpdateChannel = "stable" | "beta";
export interface UpdateCandidate {
  version: string;
  body?: string;
  download: (progress: (event: DownloadEvent) => void, options: { timeout: number }) => Promise<void>;
  install: () => Promise<void>;
  close: () => Promise<void>;
}
export interface UpdateDependencies {
  load: () => Promise<{ version: string; channel: unknown; fresh: boolean }>;
  saveChannel: (channel: UpdateChannel) => Promise<void>;
  check: (channel: UpdateChannel) => Promise<{ feedVersion: string; update: UpdateCandidate | null }>;
  restart: () => Promise<void>;
}
export type UpdatePhase = "idle" | "initializing" | "selecting" | "checking" | "current" | "waiting" | "available" | "downloading" | "installing" | "ready" | "restarting" | "error";
export interface UpdateSnapshot {
  initialized: boolean;
  phase: UpdatePhase;
  currentVersion: string;
  channel: UpdateChannel;
  suggestBeta: boolean;
  offerId: number;
  version?: string;
  body?: string;
  error?: string;
  errorOperation?: UpdatePhase;
  downloaded: number;
  total?: number;
}
export const DOWNLOAD_TIMEOUT_MS = 180_000;
export const updateBusy = (s: UpdateSnapshot) => ["initializing", "selecting", "checking", "downloading", "installing", "restarting"].includes(s.phase);
export const channelLocked = (s: UpdateSnapshot) => updateBusy(s) || s.phase === "ready";
const errorText = (e: unknown) => e instanceof Error ? e.message : String(e);

/** Main-window singleton in production. Native requests cancel before releasing the lock;
 * never race an IPC operation against a JavaScript timer and leave it running underneath.
 */
export class UpdateController {
  private state: UpdateSnapshot = { initialized: false, phase: "idle", currentVersion: "", channel: "stable", suggestBeta: false, offerId: 0, downloaded: 0 };
  private listeners = new Set<() => void>();
  private candidate: UpdateCandidate | null = null;
  private operation: Promise<void> | null = null;
  private minimum?: string;
  constructor(private deps: UpdateDependencies) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private set(patch: Partial<UpdateSnapshot>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  private run(phase: UpdatePhase, work: () => Promise<void>): Promise<void> {
    if (this.operation) return this.operation;
    const task = Promise.resolve().then(work).catch(e => {
      this.set({ phase: "error", error: errorText(e), errorOperation: phase });
    }).finally(() => { if (this.operation === task) this.operation = null; });
    this.operation = task;
    this.set({ phase, error: undefined, errorOperation: undefined });
    return task;
  }
  private async discard() {
    const candidate = this.candidate;
    this.candidate = null;
    this.set({ version: undefined, body: undefined, offerId: this.state.offerId + 1, downloaded: 0, total: undefined });
    await candidate?.close().catch(() => {});
  }
  initialize = (): Promise<void> => {
    if (this.state.initialized) return Promise.resolve();
    return this.run("initializing", async () => {
      const { version, channel: stored, fresh } = await this.deps.load();
      if (!valid(version)) throw new Error("Could not read the installed version. Please restart Scrollr.");
      const explicit = stored === "stable" || stored === "beta";
      const betaBuild = !!prerelease(version);
      const channel = explicit ? stored : fresh && betaBuild ? "beta" : "stable";
      if (!explicit) await this.deps.saveChannel(channel);
      this.set({ initialized: true, phase: "idle", currentVersion: version, channel, suggestBeta: betaBuild && channel === "stable" });
    });
  };
  selectChannel = async (channel: UpdateChannel): Promise<void> => {
    if (!this.state.initialized || channelLocked(this.state) || this.operation || channel === this.state.channel) return;
    if (channel !== "stable" && channel !== "beta") return;
    return this.run("selecting", async () => {
      await this.discard();
      await this.deps.saveChannel(channel);
      this.set({ channel, phase: "idle", suggestBeta: false });
    });
  };
  setMinimum = (minimum?: string) => { this.minimum = minimum && valid(minimum) ? minimum : undefined; };
  check = async (): Promise<void> => {
    await this.initialize();
    if (!this.state.initialized || this.state.phase === "ready" || this.state.phase === "restarting") return;
    if (this.operation) return this.operation;
    return this.run("checking", async () => {
      await this.discard();
      const { feedVersion, update } = await this.deps.check(this.state.channel);
      this.candidate = update;
      try {
        if (!valid(feedVersion) || (this.state.channel === "stable" && prerelease(feedVersion))) throw new Error("Invalid update feed. No update was accepted.");
        if (update && (update.version !== feedVersion || !gt(update.version, this.state.currentVersion))) throw new Error("The update is not newer than your installed version.");
        if (!update && gt(feedVersion, this.state.currentVersion)) throw new Error("The update is unavailable for this installation.");
        if (this.minimum && !gte(feedVersion, this.minimum)) throw new Error("The required update is not available on this channel yet. Please retry later.");
        this.set({ phase: update ? "available" : gt(this.state.currentVersion, feedVersion) ? "waiting" : "current", version: update?.version, body: update?.body });
      } catch (error) {
        await this.discard();
        throw error;
      }
    });
  };
  install = async (offerId = this.state.offerId): Promise<void> => {
    if (this.operation || this.state.phase !== "available" || !this.candidate || offerId !== this.state.offerId) return;
    const candidate = this.candidate;
    return this.run("downloading", async () => {
      try {
        if (this.minimum && !gte(candidate.version, this.minimum)) throw new Error("A newer update is required. Check for updates again.");
        this.set({ downloaded: 0, total: undefined });
        await candidate.download(event => {
          if (event.event === "Started") this.set({ total: event.data.contentLength || undefined });
          if (event.event === "Progress") this.set({ downloaded: this.state.downloaded + event.data.chunkLength });
        }, { timeout: DOWNLOAD_TIMEOUT_MS });
        this.set({ phase: "installing" });
        await candidate.install();
        await candidate.close().catch(() => {});
        this.candidate = null;
        this.set({ phase: "ready" });
      } catch (error) {
        await this.discard();
        throw new Error(`Could not install the update. Check your connection and retry. ${errorText(error)}`);
      }
    });
  };
  restart = (): Promise<void> => {
    if (this.operation || this.state.phase !== "ready") return Promise.resolve();
    return this.run("restarting", async () => {
      try { await this.deps.restart(); }
      catch { this.set({ phase: "ready", error: "Scrollr could not restart. Retry, or quit Scrollr from the tray and reopen it. The update is already installed." }); return; }
      this.set({ phase: "ready" });
    });
  };
}
