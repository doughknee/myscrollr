// Sentry must initialize before any other module imports so the SDK can
// attach to browser globals before React/Tauri plugins start running.
import { initSentry, SentryFallback } from "./sentry";
initSentry("ticker");

import { StrictMode } from "react";
import * as Sentry from "@sentry/react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import "./api/fetchOverride";
import { initStore } from "./lib/store";
import { createQueryClient } from "./query";
import App from "./App";
import { startDevBus } from "./dev/bus";
import "./style.css";

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
