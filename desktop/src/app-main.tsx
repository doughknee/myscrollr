import { StrictMode } from "react";
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

initStore().catch((err) => console.error("[Scrollr] Store init failed:", err)).then(() => {
  const router = createAppRouter(queryClient);

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <MotionConfig reducedMotion="user">
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </MotionConfig>
    </StrictMode>,
  );
});
