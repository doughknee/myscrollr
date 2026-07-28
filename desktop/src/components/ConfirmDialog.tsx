import { useEffect, useRef } from "react";
import clsx from "clsx";

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
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    dialogRef.current?.showModal();
    cancelRef.current?.focus();
    return () => restoreRef.current?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      className="fixed inset-0 z-[100] m-0 flex h-full max-h-none w-full max-w-none items-center justify-center border-0 bg-transparent p-0 backdrop:bg-transparent"
    >
      <div
        className="absolute inset-0 bg-surface/60 backdrop-blur-sm"
        onClick={onCancel}
      />
      <div className="relative w-full max-w-sm mx-4 p-5 rounded-xl bg-surface-2 border border-edge shadow-soft-md">
            <h3 className="text-sm font-semibold text-fg">{title}</h3>
            <p className="text-xs text-fg-3 mt-1.5 leading-relaxed">
              {description}
            </p>

            <div className="flex items-center justify-end gap-2 mt-5">
              <button
                ref={cancelRef}
                onClick={onCancel}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-fg-3 hover:text-fg-2 hover:bg-surface-hover cursor-pointer"
              >
                {cancelLabel}
              </button>
              <button
                onClick={onConfirm}
                className={clsx(
                  "px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer",
                  destructive
                    ? "bg-error/10 text-error hover:bg-error/20"
                    : "bg-accent/10 text-accent hover:bg-accent/20",
                )}
              >
                {confirmLabel}
              </button>
            </div>
      </div>
    </dialog>
  );
}
