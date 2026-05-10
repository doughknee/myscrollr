/**
 * Apply theme family + color mode, UI scale, font weight, and contrast
 * to a shell element.
 *
 * Shared between the app window (#app-shell) and ticker window
 * (#desktop-shell). Handles the multi-theme color system:
 *
 *   - `themeFamily` picks the palette identity (Scrollr, Catppuccin,
 *     Dracula, …). One of `THEME_FAMILIES`.
 *   - `themeMode` is the light/dark/system selector. "system" resolves
 *     via prefers-color-scheme and stays reactive to OS changes.
 *
 * Together they form the `data-theme` attribute applied to the shell
 * and the document element, e.g. `data-theme="catppuccin-dark"`.
 *
 * UI scale uses Tauri's native webview zoom API, which scales the
 * entire rendering layer uniformly. This avoids the coordinate
 * mismatches that CSS `zoom` causes with portal-based components
 * (tooltips, toasts, modals).
 */
import { useEffect } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { resolveThemeMode, resolveThemeName } from "../preferences";
import type { ThemeFamily, ThemeMode, FontWeight } from "../preferences";

interface UseThemeOptions {
  shellId: string;
  themeFamily: ThemeFamily;
  themeMode: ThemeMode;
  uiScale: number;
  fontWeight: FontWeight;
  highContrast: boolean;
}

/**
 * Mirror written to localStorage so the pre-paint script in app.html
 * (and index.html for the ticker) can resolve the user's saved theme
 * synchronously before React mounts. Both the family and the unresolved
 * mode are stored so "system" stays responsive to OS changes between
 * launches.
 */
const THEME_MIRROR_KEY = "scrollr:theme-mirror";

interface ThemeMirror {
  family: ThemeFamily;
  mode: ThemeMode;
}

function writeMirror(family: ThemeFamily, mode: ThemeMode): void {
  try {
    const payload: ThemeMirror = { family, mode };
    localStorage.setItem(THEME_MIRROR_KEY, JSON.stringify(payload));
  } catch {
    // localStorage may be unavailable in some webview contexts —
    // pre-paint will fall back to Scrollr dark.
  }
}

export function useTheme({
  shellId,
  themeFamily,
  themeMode,
  uiScale,
  fontWeight,
  highContrast,
}: UseThemeOptions): void {
  // ── Theme application ────────────────────────────────────────
  useEffect(() => {
    const shell = document.getElementById(shellId);
    if (!shell) return;

    const resolvedMode = resolveThemeMode(themeMode);
    const dataTheme = resolveThemeName(themeFamily, resolvedMode);

    shell.classList.add("theme-transition");
    shell.dataset.theme = dataTheme;
    // Mirror the user's pref so the pre-paint script can read it on
    // next launch and avoid a theme flash for non-default families.
    writeMirror(themeFamily, themeMode);
    // Also ensure <html> stays in sync with the shell so the
    // pre-paint background colors don't fight us once React mounts.
    document.documentElement.setAttribute("data-theme", dataTheme);
    const timer = setTimeout(
      () => shell.classList.remove("theme-transition"),
      350,
    );

    if (themeMode === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = (e: MediaQueryListEvent) => {
        const nextMode = e.matches ? "dark" : "light";
        const next = resolveThemeName(themeFamily, nextMode);
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
  }, [shellId, themeFamily, themeMode]);

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
