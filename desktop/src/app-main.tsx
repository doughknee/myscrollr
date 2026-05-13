// Sentry must initialize before any other module imports so the SDK can
// attach to browser globals before React/Tauri plugins start running.
import { initSentry } from "./sentry";
initSentry("app");

import { StrictMode } from "react";
import * as Sentry from "@sentry/react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { MotionConfig } from "motion/react";
import "./api/fetchOverride";
import { initStore } from "./lib/store";
import { createQueryClient } from "./query";
import { createAppRouter } from "./router";
import "./style.css";
// Sonner CSS must ship in the entry bundle, not a code-split route chunk,
// so toasts fired during/right after first paint are styled correctly.
import "sonner/dist/styles.css";

const queryClient = createQueryClient();

const SentryFallback = (
  <div style={{ padding: 24, fontFamily: "system-ui" }}>
    <h1 style={{ fontSize: 20, fontWeight: 600 }}>Something went wrong</h1>
    <p style={{ marginTop: 8, opacity: 0.7 }}>
      Reload to recover. The team has been notified.
    </p>
  </div>
);

initStore().catch((err) => console.error("[Scrollr] Store init failed:", err)).then(() => {
  const router = createAppRouter(queryClient);

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <Sentry.ErrorBoundary fallback={SentryFallback}>
        <MotionConfig reducedMotion="user">
          <QueryClientProvider client={queryClient}>
            <RouterProvider router={router} />
          </QueryClientProvider>
        </MotionConfig>
      </Sentry.ErrorBoundary>
    </StrictMode>,
  );
});
