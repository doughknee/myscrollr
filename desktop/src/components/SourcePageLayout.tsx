/**
 * SourcePageLayout — page chassis for channel and widget routes.
 *
 * Renders through the universal `PageLayout` so source pages share
 * the same header band, tab bar, and content stack as every other
 * route. Adds the source-specific breadcrumb (Home / Name) and the
 * Trash entity-action.
 *
 * IA refactor 2026-05-09 — channels and widgets now share a 2-tab
 * structure (Feed / Configure). The legacy Display tab folded into
 * Configure as a section. See
 * docs/superpowers/specs/2026-05-09-desktop-ia-refactor-design.md
 */
import { useState } from "react";
import { Trash2 } from "lucide-react";
import Tooltip from "./Tooltip";
import ConfirmDialog from "./ConfirmDialog";
import PageLayout from "./layout/PageLayout";

// ── Shared tab constants ────────────────────────────────────────

export const VALID_TABS = ["feed", "configuration"] as const;
export type SourceTab = (typeof VALID_TABS)[number];

/** Parse a raw tab parameter into a valid SourceTab.
 *  - "display" is migrated to "configuration" (Display tab was folded
 *    into Configure as a section in the IA refactor). Old bookmarks
 *    and tray deeplinks still work.
 *  - Anything else falls back to "feed". */
export function parseSourceTab(rawTab: string): SourceTab {
  if (rawTab === "display") return "configuration";
  return (VALID_TABS as readonly string[]).includes(rawTab)
    ? (rawTab as SourceTab)
    : "feed";
}

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

// Channels and widgets share the same 2-tab structure now. Display
// preferences for channels live as a "Display" section inside the
// Configure tab — same chassis for both kinds.
const SOURCE_TABS = [
  { key: "feed", label: "Feed" },
  { key: "configuration", label: "Configure" },
];

interface SourcePageLayoutProps {
  name: string;
  /** Optional 1-line description rendered next to the name. */
  description?: string;
  activeTab: string;
  onTabChange: (tab: string) => void;
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
  description,
  activeTab,
  onTabChange,
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

  const entityAction = onRemove ? (
    <Tooltip content="Remove">
      <button
        onClick={handleRemove}
        aria-label={`Remove ${name}`}
        className="w-7 h-7 flex items-center justify-center rounded-lg text-fg-4 hover:text-red-400 hover:bg-red-500/10 transition-colors"
      >
        <Trash2 size={14} />
      </button>
    </Tooltip>
  ) : undefined;

  return (
    <>
      <PageLayout
        title={name}
        subtitle={description}
        parentLabel="Home"
        onParentClick={onBack}
        width="narrow"
        entityAction={entityAction}
        tabs={{
          items: SOURCE_TABS,
          activeKey: activeTab,
          onChange: onTabChange,
        }}
      >
        {children}
      </PageLayout>

      {/* Channel removal confirmation */}
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
