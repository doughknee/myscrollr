/**
 * Settings route — redirect shim. The page merged into /customize
 * (App tab) in REL-44; the path survives for stored lastRoute values,
 * old deep links, and muscle memory.
 */
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/settings")({
  beforeLoad: () => {
    throw redirect({ to: "/customize", search: { tab: "app" } });
  },
});
