import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { useSyncExternalStore } from "react";
import { FRESH_INSTALL_KEY, getStore, initStore, readStoreShared, removeStorePersisted, setStorePersisted } from "./store";
import { UpdateController } from "./updateState";
import type { UpdateChannel } from "./updateState";

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
});
export function useUpdateController() {
  return useSyncExternalStore(updateController.subscribe, updateController.getSnapshot, updateController.getSnapshot);
}
