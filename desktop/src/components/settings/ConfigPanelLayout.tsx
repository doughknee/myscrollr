/**
 * Shared layout wrapper for widget ConfigPanels.
 *
 * Wraps the configure-tab body with consistent width + reset footer.
 * The widget's title / subtitle / icon used to render here, but those
 * now live in the TopBar's breadcrumb (via PageContext) so duplicating
 * them on the page would be redundant. The icon + hex props are kept
 * for backward compat / future use; they're currently unused.
 */
import { ResetButton } from "./SettingsControls";

interface ConfigPanelLayoutProps {
  /** Widget brand glyph. Kept for API stability; currently unused
   *  since the TopBar carries the page identity. */
  icon?: React.ReactNode;
  /** Widget brand hex. Kept for API stability. */
  hex?: string;
  /** Human label. Kept for API stability; rendered in the TopBar. */
  title?: string;
  /** Subtitle. Kept for API stability; rendered in the TopBar. */
  subtitle?: string;
  onReset: () => void;
  children: React.ReactNode;
}

export default function ConfigPanelLayout({
  onReset,
  children,
}: ConfigPanelLayoutProps) {
  // The parent route shell uses `fillHeight` for configure tabs, which
  // strips outer scroll and expects children to provide their own
  // scroll viewport. We provide that here so every widget's
  // configure page scrolls when its content exceeds available height
  // (otherwise sections past the fold are silently clipped).
  // See `components/layout/PageLayout.tsx` `fillHeight` branch.
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
        <div className="w-full max-w-2xl mx-auto pb-8">
          {children}

          {/* Reset footer */}
          <div className="flex items-center justify-end pt-2 px-3">
            <ResetButton onClick={onReset} />
          </div>
        </div>
      </div>
    </div>
  );
}
