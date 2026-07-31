/**
 * /updates — redirect into the unified settings surface.
 *
 * Same reasoning as /account: kept so bare-pathname callers (the account
 * menu's "What's new", the support hub tile, the cross-window navigate
 * channel) keep working without learning about search params.
 */
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/updates")({
  beforeLoad: () => {
    throw redirect({ to: "/customize", search: { page: "updates" }, replace: true });
  },
});
