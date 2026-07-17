/**
 * SourcePageLayout — page chassis for channel and widget routes.
 *
 * Renders through the universal `PageLayout`. Since the configure-page
 * teardown the feed is the only page a source has — every setting lives
 * inside the widget itself (bar + gear popover). The Options pill keeps
 * the source-level Remove action; the breadcrumb is plain navigation.
 *
 * IA refactor 2026-05-09 — see
 * docs/superpowers/specs/2026-05-09-desktop-ia-refactor-design.md
 * Walkthrough discoverability fix 2026-05-11.
 */
import { useState } from "react";
import { Trash2 } from "lucide-react";
import ConfirmDialog from "./ConfirmDialog";
import PageLayout from "./layout/PageLayout";
import { type OverflowMenuItem } from "./OverflowMenu";

/** Fallback for when a source (channel or widget) is not found. */
export function SourceNotFound({
  kind,
  name,
}: {
  kind: "Channel" | "Widget";
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

  /** Source-level remove action. */
  onRemove?: () => void;
  /** "channel" triggers a ConfirmDialog before removal; "widget" removes immediately. */
  sourceKind?: "channel" | "widget";
}

export default function SourcePageLayout({
  name,
  onBack,
  children,
  onRemove,
  sourceKind,
}: SourcePageLayoutProps) {
  const [confirmRemove, setConfirmRemove] = useState(false);

  function handleRemove() {
    if (sourceKind === "channel") {
      setConfirmRemove(true);
    } else {
      onRemove?.();
    }
  }

  const menuItems: OverflowMenuItem[] = [];
  if (onRemove) {
    menuItems.push({
      key: "remove",
      label: `Remove ${name}`,
      icon: Trash2,
      destructive: true,
      onSelect: handleRemove,
    });
  }

  return (
    <>
      <PageLayout
        title={name}
        parentLabel="Home"
        onParentClick={onBack}
        // The feed is data-dense (grids of trade cards, score cards, RSS
        // articles, etc.): full width, flush to the content area — the
        // feed's own components own their padding.
        width="wide"
        noContentPadding
        menuItems={menuItems}
        menuLabel={`${name} options`}
      >
        {children}
      </PageLayout>

      {/* Channel removal confirmation. Widgets remove immediately
          via the useUndoableAction toast (see widget route). */}
      <ConfirmDialog
        open={confirmRemove}
        title={`Remove ${name}?`}
        description={`This will delete your ${name} configuration and remove it from the dashboard. You can re-add it from the Catalog.`}
        confirmLabel="Remove"
        destructive
        onConfirm={() => {
          setConfirmRemove(false);
          onRemove?.();
        }}
        onCancel={() => setConfirmRemove(false)}
      />
    </>
  );
}
