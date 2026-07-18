/**
 * Ticker route — redirect shim. The page merged into /customize
 * (Ticker tab, the default) in REL-44; the path survives for stored
 * lastRoute values, tray/ticker-window deep links, and muscle memory.
 */
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/ticker")({
  beforeLoad: () => {
    throw redirect({ to: "/customize" });
  },
});
