import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { emit } from "@tauri-apps/api/event";
import { Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { useRef, useSyncExternalStore } from "react";
import { FRESH_INSTALL_KEY, getStore, initStore, readStoreShared, removeStorePersisted, setStorePersisted } from "./store";
import { UpdateController } from "./updateState";
import type { UpdateChannel, UpdateSnapshot } from "./updateState";

export const UPDATE_CHANNEL_KEY = "scrollr:update-channel";
type Metadata = ConstructorParameters<typeof Update>[0];
export async function saveUpdateChannel(channel: UpdateChannel): Promise<void> {
  const previous = await readStoreShared<UpdateChannel>(UPDATE_CHANNEL_KEY);
  try { await setStorePersisted(UPDATE_CHANNEL_KEY, channel); }
  catch {
    // setStorePersisted changes the shared in-memory store before flushing disk.
    // Restore it too, or a later unrelated save could silently enroll this device.
    try {
      if (previous === undefined) await removeStorePersisted(UPDATE_CHANNEL_KEY);
      else await setStorePersisted(UPDATE_CHANNEL_KEY, previous);
    } catch {
      throw new Error("The update preference could not be saved or restored. Restart Scrollr and verify your channel before updating.");
    }
    throw new Error("Could not save the update channel. Your previous choice was restored. Check available disk space and retry.");
  }
}
export const updateController = new UpdateController({
  load: async () => {
    await initStore();
    return { version: await getVersion(), channel: await readStoreShared(UPDATE_CHANNEL_KEY), fresh: getStore(FRESH_INSTALL_KEY, false) };
  },
  saveChannel: saveUpdateChannel,
  check: async channel => {
    const result = await invoke<{ feedVersion: string; update: Metadata | null; recoveryVersion?: string | null }>("check_update_channel", { channel });
    return { feedVersion: result.feedVersion, recoveryVersion: result.recoveryVersion, update: result.update ? new Update(result.update) : null };
  },
  prepareRecovery: async () => {
    const result = await invoke<{ feedVersion: string; update: Metadata | null; recoveryVersion: string }>("prepare_stable_recovery");
    return { ...result, update: result.update ? new Update(result.update) : null };
  },
  restart: relaunch,
  installFailed: () => void emit("ticker-reposition").catch(() => {}),
});
const sameValue = (a: unknown, b: unknown) =>
  Object.is(a, b) ||
  (typeof a === "object" && typeof b === "object" && a !== null && b !== null &&
    Object.keys(a).length === Object.keys(b).length &&
    Object.entries(a).every(([k, v]) => Object.is(v, (b as Record<string, unknown>)[k])));

/**
 * The controller's snapshot, or what `select` makes of it. Every download chunk
 * is a new snapshot (SCROLLR-429), so a caller that does not show progress passes
 * a selector over the fields it reads and re-renders only when one of them
 * changes; the app shell uses this, so a download no longer renders it per chunk.
 */
export function useUpdateController<T = UpdateSnapshot>(select: (s: UpdateSnapshot) => T = (s) => s as unknown as T): T {
  const last = useRef<{ snap: UpdateSnapshot; value: T } | null>(null);
  const read = () => {
    const snap = updateController.getSnapshot();
    const prev = last.current;
    if (prev?.snap === snap) return prev.value;
    const next = select(snap);
    const value = prev && sameValue(prev.value, next) ? prev.value : next;
    last.current = { snap, value };
    return value;
  };
  return useSyncExternalStore(updateController.subscribe, read, read);
}
