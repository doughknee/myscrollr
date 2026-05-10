import { useEffect, useRef } from "react";
import FocusLock from "react-focus-lock";
import clsx from "clsx";
import { motion, AnimatePresence } from "motion/react";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Focus the cancel button when the dialog opens
  useEffect(() => {
    if (open) cancelRef.current?.focus();
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  return (
    <AnimatePresence>
      {open && (
        <FocusLock returnFocus>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className="fixed inset-0 z-[100] flex items-center justify-center"
          >
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="absolute inset-0 bg-surface/60 backdrop-blur-sm"
              onClick={onCancel}
            />

            {/* Panel */}
            <motion.div
              initial={{ opacity: 0, scale: 0.94, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 4 }}
              transition={{ type: "spring", stiffness: 380, damping: 28 }}
              className="relative w-full max-w-sm mx-4 p-5 rounded-xl bg-surface-2 border border-edge shadow-soft-md"
            >
              <h3 className="text-sm font-semibold text-fg">{title}</h3>
              <p className="text-xs text-fg-3 mt-1.5 leading-relaxed">
                {description}
              </p>

              <div className="flex items-center justify-end gap-2 mt-5">
                <button
                  ref={cancelRef}
                  onClick={onCancel}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-fg-3 hover:text-fg-2 hover:bg-surface-hover transition-all duration-150 active:scale-95 cursor-pointer"
                >
                  {cancelLabel}
                </button>
                <button
                  onClick={onConfirm}
                  className={clsx(
                    "px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 active:scale-95 cursor-pointer",
                    destructive
                      ? "bg-error/10 text-error hover:bg-error/20"
                      : "bg-accent/10 text-accent hover:bg-accent/20",
                  )}
                >
                  {confirmLabel}
                </button>
              </div>
            </motion.div>
          </div>
        </FocusLock>
      )}
    </AnimatePresence>
  );
}
