import { useEffect } from "react";
import { recordPostHogDesktopEvent } from "../api/client";
import { isPrimaryTicker } from "../lib/windowRole";
import type { ProductActivityCategory } from "../api/client";

const RUNNING_DELAY_MS = 30_000;
const PRESENCE_INTERVAL_MS = 5 * 60_000;

export function usePostHogActivity({
  authenticated,
  enabled,
  categories,
  production = import.meta.env.PROD,
}: {
  authenticated: boolean;
  enabled: boolean;
  categories: ProductActivityCategory[];
  production?: boolean;
}) {
  useEffect(() => {
    if (!production || !isPrimaryTicker() || !authenticated || !enabled) return;
    const send = (event: Parameters<typeof recordPostHogDesktopEvent>[0]) => {
      void recordPostHogDesktopEvent(event).catch(() => {});
    };
    send({ event: "desktop_app_opened" });
    const running = window.setTimeout(
      () => send({ event: "desktop_app_running" }),
      RUNNING_DELAY_MS,
    );
    const presence = window.setInterval(
      () => send({ event: "desktop_presence" }),
      PRESENCE_INTERVAL_MS,
    );
    return () => {
      window.clearTimeout(running);
      window.clearInterval(presence);
    };
  }, [authenticated, enabled, production]);

  useEffect(() => {
    if (!production || !isPrimaryTicker() || !authenticated || !enabled) return;
    for (const feature of [...new Set(categories)]) {
      void recordPostHogDesktopEvent({
        event: "desktop_feature_configured",
        feature,
      }).catch(() => {});
    }
  }, [authenticated, categories, enabled, production]);
}
