import { invoke } from "@tauri-apps/api/core";
import type { MouseEvent } from "react";

/**
 * Open a web link in the system browser. Every external link goes through
 * here: the Rust `open_external` command cleans the environment on Linux
 * AppImages (where the shell plugin's `open` launches nothing and reports
 * success, SCROLLR-8) and accepts only http and https. The returned promise
 * rejects when the link is refused or cannot be opened.
 */
export function openExternal(url: string): Promise<void> {
  return invoke<void>("open_external", { url });
}

/**
 * `onClick` for a plain `<a href>` to an outside page. Never give such an
 * anchor a `_blank` target: the shell plugin's injected script catches those
 * clicks and calls `shell.open`, which the app does not allow (SCROLLR-470).
 */
export function openLinkOnClick(event: MouseEvent<HTMLAnchorElement>): void {
  event.preventDefault();
  void openExternal(event.currentTarget.href).catch(() => {});
}
