/**
 * /account — redirect into the unified settings surface.
 *
 * Kept as a route rather than deleted because several things address
 * settings by bare pathname: the cross-window `scrollr:navigate`
 * channel, the tray's navigate-to listener, and `routePaths.isMountable`
 * (which splits on "/" and would treat "/customize?page=profile" as one
 * literal segment). Those can all keep sending "/account".
 */
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/account")({
  beforeLoad: () => {
    throw redirect({ to: "/customize", search: { page: "profile" }, replace: true });
  },
});
