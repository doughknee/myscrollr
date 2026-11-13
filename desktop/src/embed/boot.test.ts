/**
 * The website host (boot.ts) answers every native command the shared ticker
 * invokes at boot; an unanswered one resolves to null and used to crash the
 * bar (SCROLLR-451). Add a command here when the ticker starts calling it.
 */
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

const TICKER_COMMANDS = [
  "ticker_display",
  "set_ticker_visible",
  "pin_window",
  "position_ticker",
  "set_hide_on_fullscreen",
  "sync_tray_ticker",
  "report_screen_state",
  "set_crash_reports",
  "start_sse",
  "stop_sse",
  "get_system_info",
];

describe("embed host", () => {
  const boot = readFileSync("src/embed/boot.ts", "utf8");
  it.each(TICKER_COMMANDS)("answers %s explicitly", (cmd) => {
    expect(boot).toContain(`case "${cmd}":`);
  });
});
