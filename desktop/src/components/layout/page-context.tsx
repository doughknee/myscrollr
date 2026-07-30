/**
 * PageContext — lets every route declare its identity (title, optional
 * subtitle, optional tab strip, optional menu of contextual actions)
 * so the TopBar can render all of it inline.
 *
 * Layout in the TopBar:
 *   [parentLabel / title]  [tab pills (if any)]  [Options pill / action]
 * Sibling-tab navigation is rendered as a compact segmented control
 * inside the bar itself — the breadcrumb area has plenty of slack and
 * a separate full-width tab band wastes vertical space. Walkthrough
 * fix 2026-05-11 round 3.
 */
import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { OverflowMenuItem } from "../OverflowMenu";

export interface PageIdentity {
  /** Page title, e.g. "Sports", "Settings", "Catalog". */
  title: string;
  /** Optional 1-line subtitle / tagline. */
  subtitle?: string;
  /**
   * For source pages, the parent breadcrumb label (e.g. "Home"). Used
   * to render "Home / Sports" style breadcrumb in the TopBar.
   */
  parentLabel?: string;
  /** Click handler for the parent breadcrumb (e.g. navigate to /feed). */
  onParentClick?: () => void;
  /**
   * Optional click handler for the title itself. Used when the page
   * has sub-routes (e.g. on `/widget/sports_nfl/info`, clicking
   * "Sports" should go back to `/widget/sports_nfl`). When omitted,
   * and no menuItems make the title a menu, the title renders as plain
   * text.
   */
  onTitleClick?: () => void;
  /**
   * Optional contextual menu items. When provided, the TopBar renders
   * an "Options" pill button after the breadcrumb. Clicking the pill
   * opens an OverflowMenu of these items. The breadcrumb itself is
   * never a menu trigger — it's always plain navigation text.
   */
  menuItems?: OverflowMenuItem[];
  /** Aria label for the menu trigger. Default: 'Page options'. */
  menuLabel?: string;
  /**
   * Optional non-menu action rendered after the breadcrumb (e.g. a
   * raw Trash button on routes that don't otherwise have a menu).
   * Most routes should prefer menuItems; this is a fallback for
   * surfaces that need a plain icon button.
   */
  entityAction?: ReactNode;
}

interface PageIdentityRegistry {
  identity: PageIdentity | null;
  setIdentity: (next: PageIdentity | null) => void;
}

const PageIdentityContext = createContext<PageIdentityRegistry | null>(null);

/** Provider — mount once at the app shell. */
export function PageIdentityProvider({ children }: { children: ReactNode }) {
  const [identity, setIdentity] = useState<PageIdentity | null>(null);
  return (
    <PageIdentityContext.Provider value={{ identity, setIdentity }}>
      {children}
    </PageIdentityContext.Provider>
  );
}

/** TopBar reads the current page identity here. */
export function usePageIdentity(): PageIdentity | null {
  const ctx = useContext(PageIdentityContext);
  return ctx?.identity ?? null;
}

/**
 * Routes call this from inside PageLayout to publish their identity.
 * Effect-based so the identity stays in sync with prop changes; the
 * cleanup clears the identity on unmount so brief flashes of "stale"
 * identity don't appear during route changes.
 */
export function useRegisterPageIdentity(identity: PageIdentity) {
  const ctx = useContext(PageIdentityContext);
  // Stringify so the effect deps capture nested-object equality
  // without forcing parents to memoize the menu nodes / handlers.
  // We hash the menu by its keys + labels — that's what visually
  // changes between routes; click handlers are stable closures.
  const menuKey = identity.menuItems
    ? identity.menuItems
        .map((it) =>
          "divider" in it ? `div:${it.key}` : `${it.key}:${it.label}`,
        )
        .join("|")
    : "";
  const key = JSON.stringify({
    title: identity.title,
    subtitle: identity.subtitle,
    parentLabel: identity.parentLabel,
    menuLabel: identity.menuLabel,
    menuKey,
  });
  useEffect(() => {
    ctx?.setIdentity(identity);
    return () => ctx?.setIdentity(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    key,
    identity.entityAction,
    identity.onParentClick,
    identity.onTitleClick,
    identity.menuItems,
  ]);
}
