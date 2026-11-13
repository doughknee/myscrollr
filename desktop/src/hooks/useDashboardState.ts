/**
 * Where the shared dashboard query stands (pending / failed / ready), for a
 * component that renders outside the shell data provider (the Sidebar is a
 * sibling of it). Observes the shell's own query without fetching: the shell
 * owns the polling, this only reads it and can ask for a retry.
 */
import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { dashboardQueryOptions, dashboardState } from "../api/queries";
import type { DashboardState } from "../api/queries";

export function useDashboardState(): { state: DashboardState; retry: () => void } {
  const query = useQuery({ ...dashboardQueryOptions(), enabled: false });
  const { refetch } = query;
  const retry = useCallback(() => void refetch(), [refetch]);
  return { state: dashboardState(query), retry };
}
