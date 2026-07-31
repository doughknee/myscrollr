/**
 * The settings surface.
 *
 * One route for all of settings, with `?page=` selecting which of the
 * seven pages the rail is showing. This replaced the old split across
 * /customize (App | Ticker tabs), /account and /updates — those two are
 * now redirects into this route, so the IA is one surface with one way
 * in.
 *
 * The search query lives here rather than inside the surface so it
 * survives a page switch within the same route mount and so the route
 * remains the single owner of "what is on screen".
 */
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import RouteError from "../components/RouteError";
import SettingsSurface from "../components/settings/SettingsSurface";
import {
  DEFAULT_SETTINGS_PAGE,
  isSettingsPage,
  type SettingsPage,
} from "../components/settings/pages";

export const Route = createFileRoute("/customize")({
  component: CustomizeRoute,
  errorComponent: RouteError,
  // Materialise the default so the URL always names the page it is
  // showing — otherwise `/customize` and `/customize?page=appearance`
  // are the same screen under two addresses, and the rail's
  // aria-current has to guess.
  validateSearch: (search: Record<string, unknown>): { page: SettingsPage } => ({
    page: isSettingsPage(search.page) ? search.page : DEFAULT_SETTINGS_PAGE,
  }),
});

function CustomizeRoute() {
  const { page } = Route.useSearch();
  const [query, setQuery] = useState("");

  return (
    <SettingsSurface page={page} query={query} onQueryChange={setQuery} />
  );
}
