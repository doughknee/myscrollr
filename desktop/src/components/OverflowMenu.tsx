/**
 * OverflowMenu — accessible "..." dropdown menu for contextual actions.
 *
 * Used on source pages (channels and widgets) to expose Configure,
 * Display preferences, ticker management, and Remove without
 * stealing screen real estate via a tab band. Feed becomes the
 * single visible page; secondary actions live behind the menu.
 *
 * Built on @floating-ui/react for positioning + a11y wiring. Items
 * render as buttons with optional icon, label, and a "destructive"
 * variant for Remove. A `divider: true` item renders a thin
 * separator. Pressing Escape or clicking outside closes the menu;
 * Enter/Space activates an item.
 */
import { useState, useRef, cloneElement, useEffect } from "react";
import type { ReactElement, ReactNode, Ref } from "react";
import {
  useFloating,
  autoUpdate,
  offset,
  flip,
  shift,
  useClick,
  useDismiss,
  useRole,
  useInteractions,
  useListNavigation,
  useTypeahead,
  useTransitionStyles,
  FloatingFocusManager,
  FloatingPortal,
} from "@floating-ui/react";
import type { Placement } from "@floating-ui/react";
import clsx from "clsx";
import { Settings2, ChevronDown } from "lucide-react";
import type { LucideIcon } from "lucide-react";

// ── Item types ──────────────────────────────────────────────────

export type OverflowMenuItem =
  | {
      key: string;
      label: string;
      icon?: LucideIcon;
      onSelect: () => void;
      destructive?: boolean;
      disabled?: boolean;
      /** Optional small caption shown beneath the label. */
      hint?: string;
    }
  | { key: string; divider: true };

// ── Props ───────────────────────────────────────────────────────

interface OverflowMenuProps {
  items: OverflowMenuItem[];
  /** Tooltip + aria label for the trigger button. Default: "More". */
  triggerLabel?: string;
  /** Custom trigger element. If omitted, a default "..." icon button renders. */
  trigger?: ReactElement<{ ref?: Ref<HTMLElement> }>;
  /** Preferred menu placement. Default: "bottom-end". */
  placement?: Placement;
}

// ── Component ───────────────────────────────────────────────────

export default function OverflowMenu({
  items,
  triggerLabel = "Options",
  trigger,
  placement = "bottom-end",
}: OverflowMenuProps) {
  const [isOpen, setIsOpen] = useState(false);

  // useListNavigation index tracks position within `items`. Dividers
  // and disabled rows have null refs so keyboard nav skips them.
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const listRef = useRef<Array<HTMLElement | null>>([]);

  // Resolve the themed app shell as the portal root so the floating
  // menu inherits the right CSS variables (light vs dark). Without
  // this, the portal mounts at <body> — outside the
  // #app-shell[data-theme="light"] selector — and the menu always
  // looks dark even when the app is light.
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setPortalRoot(document.getElementById("app-shell"));
  }, []);

  const labels = items.map((it) =>
    "divider" in it ? null : it.label,
  );

  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    placement,
    transform: false,
    middleware: [
      offset(4),
      flip({ fallbackAxisSideDirection: "end" }),
      shift({ padding: 8 }),
    ],
    whileElementsMounted: autoUpdate,
  });

  const click = useClick(context);
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: "menu" });
  const listNav = useListNavigation(context, {
    listRef,
    activeIndex,
    onNavigate: setActiveIndex,
  });
  const typeahead = useTypeahead(context, {
    listRef: { current: labels },
    activeIndex,
    onMatch: isOpen ? setActiveIndex : undefined,
  });

  const { getReferenceProps, getFloatingProps, getItemProps } = useInteractions([
    click,
    dismiss,
    role,
    listNav,
    typeahead,
  ]);

  const { isMounted, styles: transitionStyles } = useTransitionStyles(context, {
    duration: 120,
    initial: { opacity: 0, transform: "translateY(-4px) scale(0.97)" },
    open: { opacity: 1, transform: "translateY(0) scale(1)" },
  });

  // Default trigger: a small pill button with a Settings2 (sliders +
  // gear) icon, a label, and a chevron-down to signal "this opens a
  // menu". Reads as "Options" rather than "more stuff" — clearer
  // affordance than a 3-dot button. Background tints when the menu is
  // open so the trigger looks pressed.
  const defaultTrigger: ReactNode = (
    <button
      type="button"
      aria-label={triggerLabel}
      aria-haspopup="menu"
      aria-expanded={isOpen}
      className={clsx(
        "flex items-center gap-1.5 h-7 px-2 rounded-md text-[11px] font-medium transition-colors",
        isOpen
          ? "bg-accent/15 text-accent"
          : "text-fg-3 hover:text-fg hover:bg-surface-hover",
      )}
    >
      <Settings2 size={13} />
      <span>Options</span>
      <ChevronDown
        size={11}
        className={clsx("transition-transform", isOpen && "rotate-180")}
      />
    </button>
  );

  return (
    <>
      {cloneElement(
        (trigger ?? defaultTrigger) as ReactElement<{ ref?: Ref<HTMLElement> }>,
        {
          ref: refs.setReference,
          ...getReferenceProps(),
        },
      )}

      {/* Portal root is #app-shell so the menu inherits the active
          theme's CSS variables (the light-mode overrides are scoped to
          that element via [data-theme="light"]). Falls back to body
          when the shell isn't mounted yet (e.g. during initial render). */}
      <FloatingPortal root={portalRoot}>
        {isMounted && (
          <FloatingFocusManager context={context} modal={false}>
            <div
              ref={refs.setFloating}
              style={{ ...floatingStyles, ...transitionStyles }}
              {...getFloatingProps()}
              className="z-50 min-w-[220px] py-1 rounded-lg border border-edge bg-surface-2 shadow-lg shadow-black/20 outline-none"
            >
              {items.map((item, i) => {
                if ("divider" in item) {
                  return (
                    <div
                      key={item.key}
                      role="separator"
                      className="my-1 h-px bg-edge/60"
                    />
                  );
                }

                const Icon = item.icon;
                const isActive = activeIndex === i;
                return (
                  <button
                    key={item.key}
                    type="button"
                    role="menuitem"
                    disabled={item.disabled}
                    ref={(node) => {
                      listRef.current[i] = node;
                    }}
                    // Pass our onClick INTO getItemProps so floating-ui
                    // merges it with its own list-navigation handlers.
                    // Spreading {...getItemProps()} *after* a sibling
                    // onClick would silently overwrite ours, which was
                    // why menu items weren't doing anything.
                    {...getItemProps({
                      onClick() {
                        if (item.disabled) return;
                        item.onSelect();
                        setIsOpen(false);
                      },
                    })}
                    className={clsx(
                      "flex items-center gap-2.5 w-full px-3 py-2 text-left text-[12px] transition-colors outline-none",
                      item.disabled && "opacity-40 cursor-not-allowed",
                      !item.disabled && item.destructive
                        ? isActive
                          ? "bg-error/10 text-error"
                          : "text-error hover:bg-error/10"
                        : isActive
                          ? "bg-accent/10 text-fg"
                          : "text-fg-2 hover:bg-surface-hover hover:text-fg",
                    )}
                  >
                    {Icon && (
                      <Icon
                        size={14}
                        className="shrink-0"
                        aria-hidden
                      />
                    )}
                    <span className="flex-1 min-w-0">
                      <span className="block truncate font-medium">
                        {item.label}
                      </span>
                      {item.hint && (
                        <span className="block truncate text-[10px] text-fg-4 mt-0.5">
                          {item.hint}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </FloatingFocusManager>
        )}
      </FloatingPortal>
    </>
  );
}
