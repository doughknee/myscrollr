/**
 * Apply theme, UI scale, font weight, and contrast to a shell element.
 *
 * Shared between the app window (#app-shell) and ticker window (#desktop-shell).
 * Handles dark/light/system themes with smooth transitions and prefers-color-scheme
 * media query listening for system mode.
 *
 * UI scale uses Tauri's native webview zoom API, which scales the entire
 * rendering layer uniformly. This avoids the coordinate mismatches that
 * CSS `zoom` causes with portal-based components (tooltips, toasts, modals).
 */
import { useEffect } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { resolveTheme } from "../preferences";
import type { Theme, FontWeight } from "../preferences";

interface UseThemeOptions {
  shellId: string;
  theme: Theme;
  uiScale: number;
  fontWeight: FontWeight;
  highContrast: boolean;
}

export function useTheme({
  shellId,
  theme,
  uiScale,
  fontWeight,
  highContrast,
}: UseThemeOptions): void {
  // ── Theme application ────────────────────────────────────────
  useEffect(() => {
    const shell = document.getElementById(shellId);
    if (!shell) return;

    const resolved = resolveTheme(theme);
    shell.classList.add("theme-transition");
    shell.dataset.theme = resolved;
    // Mirror the user's pref to localStorage so the pre-paint script
    // in app.html can read it synchronously on next launch and avoid
    // the dark-flash for light-system users. Stores the *unresolved*
    // pref so "system" stays responsive to OS changes between launches.
    try {
      localStorage.setItem("scrollr:theme-mirror", theme);
    } catch {
      // localStorage may be unavailable in some webview contexts —
      // pre-paint will fall back to OS preference.
    }
    // Also ensure <html> stays in sync with the shell so the pre-paint
    // background colors don't fight us once the React tree has mounted.
    document.documentElement.setAttribute("data-theme", resolved);
    const timer = setTimeout(
      () => shell.classList.remove("theme-transition"),
      350,
    );

    if (theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = (e: MediaQueryListEvent) => {
        const next = e.matches ? "dark" : "light";
        shell.dataset.theme = next;
        document.documentElement.setAttribute("data-theme", next);
      };
      mq.addEventListener("change", handler);
      return () => {
        clearTimeout(timer);
        mq.removeEventListener("change", handler);
      };
    }

    return () => clearTimeout(timer);
  }, [shellId, theme]);

  // ── UI scale via native webview zoom ─────────────────────────
  useEffect(() => {
    getCurrentWebview()
      .setZoom(uiScale / 100)
      .catch(() => {});
  }, [uiScale]);

  // ── Font weight ──────────────────────────────────────────────
  useEffect(() => {
    const shell = document.getElementById(shellId);
    if (!shell) return;

    shell.classList.remove("font-weight-normal", "font-weight-medium", "font-weight-bold");
    if (fontWeight !== "normal") {
      shell.classList.add(`font-weight-${fontWeight}`);
    }
  }, [shellId, fontWeight]);

  // ── High contrast ────────────────────────────────────────────
  useEffect(() => {
    const shell = document.getElementById(shellId);
    if (!shell) return;

    shell.classList.toggle("high-contrast", highContrast);
  }, [shellId, highContrast]);
}
