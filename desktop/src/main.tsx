// Sentry must initialize before any other module imports so the SDK can
// attach to browser globals before React/Tauri plugins start running.
import { initSentry, SentryFallback } from "./sentry";
initSentry("ticker");

import { StrictMode } from "react";
import * as Sentry from "@sentry/react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  MotionConfig,
  hasReducedMotionListener,
  prefersReducedMotion,
} from "motion/react";
import "./api/fetchOverride";
import { initStore } from "./lib/store";
import { createQueryClient } from "./query";
import App from "./App";
import { startDevBus } from "./dev/bus";
import "./style.css";

// SCROLLR-5: the ticker window opts out of the OS reduced-motion preference.
// The marquee is motion-plus <Ticker>, whose per-frame rAF loop is gated on
// `useReducedMotion()` — which reads this module-level flag directly and
// ignores <MotionConfig reducedMotion>, so no prop or provider can reach it.
// With the loop off the bar still lurches ~270px whenever a slot turns, which
// is what two Windows users reported as "it never scrolls". The scroll is how
// this window delivers content, not decoration, so claiming the listener slot
// before Motion installs its own pins the preference false for this entry
// only. app-main.tsx (the main window) is untouched, and the decorative chip
// keyframes stay gated on `@media (prefers-reduced-motion: reduce)` in
// style.css, which this does not affect.
hasReducedMotionListener.current = true;
prefersReducedMotion.current = false;

const queryClient = createQueryClient();
// This entry serves every ticker window ("ticker", "ticker-2", …); the
// dev bus addresses each by its own label.
startDevBus(getCurrentWindow().label, { qc: queryClient });

initStore().catch((err) => console.error("[Scrollr] Store init failed:", err)).then(() => {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <Sentry.ErrorBoundary fallback={SentryFallback}>
        <MotionConfig reducedMotion="user">
          <QueryClientProvider client={queryClient}>
            <App />
          </QueryClientProvider>
        </MotionConfig>
      </Sentry.ErrorBoundary>
    </StrictMode>,
  );
});
