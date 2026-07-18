/**
 * SourcePageLayout — page chassis for channel and widget routes.
 *
 * Renders through the universal `PageLayout`. Since the configure-page
 * teardown the feed is the only page a source has — every setting lives
 * inside the widget itself (its top bar), and source-level
 * removal lives in the sidebar right-click menu and the catalog info
 * page, so the page chrome carries no Options menu at all.
 *
 * IA refactor 2026-05-09 — see
 * docs/superpowers/specs/2026-05-09-desktop-ia-refactor-design.md
 */
import PageLayout from "./layout/PageLayout";

/** Fallback for when a source (channel or widget) is not found. */
export function SourceNotFound({
  kind,
  name,
}: {
  kind: "Widget";
  name: string;
}) {
  return (
    <PageLayout title={kind + " not found"} width="narrow">
      <div className="flex flex-col items-center justify-center text-center max-w-sm mx-auto gap-3 py-12">
        <p className="text-sm text-fg-3">
          The {kind.toLowerCase()} &ldquo;{name}&rdquo; is not installed.
        </p>
      </div>
    </PageLayout>
  );
}

// ── Layout ──────────────────────────────────────────────────────

interface SourcePageLayoutProps {
  name: string;
  /** Click handler for the parent breadcrumb in the TopBar
   *  (typically navigates back to /feed). */
  onBack: () => void;
  children: React.ReactNode;
}

export default function SourcePageLayout({
  name,
  onBack,
  children,
}: SourcePageLayoutProps) {
  return (
    <PageLayout
      title={name}
      parentLabel="Home"
      onParentClick={onBack}
      // The feed is data-dense (grids of trade cards, score cards, RSS
      // articles, etc.): full width, flush to the content area — the
      // feed's own components own their padding.
      width="wide"
      noContentPadding
      // Source→source swaps overlap-crossfade so the (identical)
      // WidgetBar shell reads as stationary chrome; only the bar's
      // contents and the feed animate.
      stableChrome
    >
      {children}
    </PageLayout>
  );
}
