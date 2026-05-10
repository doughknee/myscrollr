/**
 * PageContext — lets every route declare its identity (title, optional
 * subtitle, optional entityAction) so the TopBar can render that
 * identity as breadcrumb-style navigation.
 *
 * Pre-polish-pass the page header lived inside the route's content
 * area. Now the page identity sits in the always-visible TopBar and
 * the route just publishes its title via this context. Tabs still
 * live at the top of the content area (they're sub-navigation, not
 * page identity).
 */
import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

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
   * Optional contextual action (Trash on source pages, etc.)
   * rendered after the title in the TopBar.
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
 * identity don't appear during route transitions.
 */
export function useRegisterPageIdentity(identity: PageIdentity) {
  const ctx = useContext(PageIdentityContext);
  // Stringify so the effect deps capture nested-object equality
  // without forcing parents to memoize the entityAction node.
  const key = JSON.stringify({
    title: identity.title,
    subtitle: identity.subtitle,
    parentLabel: identity.parentLabel,
  });
  useEffect(() => {
    ctx?.setIdentity(identity);
    return () => ctx?.setIdentity(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, identity.entityAction, identity.onParentClick]);
}
