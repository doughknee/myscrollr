/**
 * Channel route — redirect shim. Every source renders at /widget/$id
 * since REL-49 (one route = one word: widgets); this path survives for
 * stored lastRoute values, ticker-chip deep links, and old muscle
 * memory.
 */
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/channel/$type")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/widget/$id", params: { id: params.type } });
  },
});
