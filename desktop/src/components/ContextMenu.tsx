/**
 * ContextMenu — minimal right-click menu primitive.
 *
 * Fixed-position floating menu at the pointer, clamped to the viewport,
 * dismissed on outside pointerdown / Escape / window blur / resize.
 * First consumer: the sidebar's per-widget menu (v1.1.2); built as a
 * standalone primitive so the ticker's row menus (v1.2.0 Double-Decker)
 * can reuse it.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import clsx from "clsx";
import type { LucideIcon } from "lucide-react";

export interface ContextMenuItem {
  key: string;
  label: string;
  icon?: LucideIcon;
  /** Error-tinted styling for irreversible actions (Remove). */
  destructive?: boolean;
  disabled?: boolean;
  /** Render a hairline divider above this item. */
  dividerBefore?: boolean;
  onSelect: () => void;
}

interface ContextMenuProps {
  open: boolean;
  /** Viewport coordinates — pass the triggering pointer event's clientX/Y. */
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export default function ContextMenu({
  open,
  x,
  y,
  items,
  onClose,
}: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  // Clamp to the viewport once the menu has real dimensions. Layout
  // effect so the clamp lands before paint — no jump on open.
  useLayoutEffect(() => {
    if (!open) return;
    const el = ref.current;
    if (!el) {
      setPos({ left: x, top: y });
      return;
    }
    const { width, height } = el.getBoundingClientRect();
    const pad = 8;
    setPos({
      left: Math.max(pad, Math.min(x, window.innerWidth - width - pad)),
      top: Math.max(pad, Math.min(y, window.innerHeight - height - pad)),
    });
  }, [open, x, y]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    // Capture phase so a click that opens something else still closes us.
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", onClose);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("resize", onClose);
    };
  }, [open, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          ref={ref}
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.98 }}
          transition={{ duration: 0.12, ease: [0.22, 0.61, 0.36, 1] }}
          role="menu"
          style={{ left: pos.left, top: pos.top, transformOrigin: "top left" }}
          className="fixed z-[100] min-w-[180px] rounded-lg border border-edge/60 bg-surface-2 py-1 shadow-lg"
        >
          {items.map((item) => (
            <div key={item.key}>
              {item.dividerBefore && <div className="my-1 h-px bg-edge/40" />}
              <button
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  onClose();
                  item.onSelect();
                }}
                className={clsx(
                  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-ui-meta transition-colors cursor-pointer",
                  item.disabled && "cursor-not-allowed opacity-50",
                  !item.disabled &&
                    (item.destructive
                      ? "text-error/90 hover:bg-error/10 hover:text-error"
                      : "text-fg-2 hover:bg-surface-hover hover:text-fg"),
                )}
              >
                {item.icon && <item.icon size={13} className="shrink-0" />}
                {item.label}
              </button>
            </div>
          ))}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
