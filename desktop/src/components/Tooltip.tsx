/**
 * Tooltip — themed tooltip with fast appearance and viewport-aware positioning.
 *
 * Uses Floating UI for positioning (flip/shift at viewport edges) and
 * portal rendering (avoids overflow:hidden clipping). Appears after a
 * short hover delay (150ms default, vs native title ~500-1000ms).
 *
 * When `content` is undefined, renders children as a passthrough with
 * zero overhead — useful for conditional tooltips (e.g. sidebar collapsed state).
 */
import { useState, cloneElement } from "react";
import type { ReactElement, Ref } from "react";
import {
  useFloating,
  autoUpdate,
  offset,
  flip,
  shift,
  useHover,
  useFocus,
  useDismiss,
  useRole,
  useInteractions,
  useTransitionStyles,
  FloatingPortal,
} from "@floating-ui/react";
import type { Placement, Side } from "@floating-ui/react";

interface TooltipProps {
  /** Tooltip text. When undefined, renders children without tooltip. */
  content: string | undefined;
  /** Preferred placement. Auto-flips if near viewport edge. Default "top". */
  side?: Placement;
  /** The trigger element. Must be a single React element. */
  children: ReactElement<{ ref?: Ref<HTMLElement> }>;
}

/** Slide-in transform per placement side. */
const SLIDE: Record<Side, string> = {
  top: "translateY(4px)",
  bottom: "translateY(-4px)",
  left: "translateX(4px)",
  right: "translateX(-4px)",
};

export default function Tooltip({
  content,
  side = "top",
  children,
}: TooltipProps) {
  const [isOpen, setIsOpen] = useState(false);

  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    placement: side,
    // Use top/left positioning instead of transform so that
    // useTransitionStyles can own the transform property for
    // enter/exit animations without overwriting the position.
    transform: false,
    middleware: [
      offset(6),
      flip({ fallbackAxisSideDirection: "start" }),
      shift({ padding: 5 }),
    ],
    whileElementsMounted: autoUpdate,
  });

  const hover = useHover(context, { move: false, delay: { open: 150 } });
  const focus = useFocus(context);
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: "tooltip" });

  const { getReferenceProps, getFloatingProps } = useInteractions([
    hover,
    focus,
    dismiss,
    role,
  ]);

  const { isMounted, styles: transitionStyles } = useTransitionStyles(
    context,
    {
      duration: 100,
      initial: ({ side: s }) => ({
        opacity: 0,
        transform: SLIDE[s],
      }),
    },
  );

  // Passthrough when no content — hooks above are called unconditionally
  if (!content) return children;

  return (
    <>
      {cloneElement(children, {
        ref: refs.setReference,
        ...getReferenceProps(),
      })}
      {/* Portal renders at body level — outside the themed shell container.
          Use hardcoded dark tooltip colors (convention: tooltips are always
          dark, matching macOS/Figma/VS Code behavior). */}
      <FloatingPortal>
        {isMounted && (
          <div
            ref={refs.setFloating}
            style={{ ...floatingStyles, ...transitionStyles }}
            className="z-50 px-2.5 py-1 text-xs font-medium rounded-md pointer-events-none select-none whitespace-nowrap bg-[#282838] text-[#e2e2ec] border border-[#383848] shadow-[0_2px_8px_rgba(0,0,0,0.25)]"
            {...getFloatingProps()}
          >
            {content}
          </div>
        )}
      </FloatingPortal>
    </>
  );
}
