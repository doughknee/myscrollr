import { useEffect, useState } from "react";
import { Check, Loader2, Pencil, X } from "lucide-react";
import { clsx } from "clsx";

// ── ProfileField ────────────────────────────────────────────────
//
// Inline edit-in-place row for the Account settings panel. Renders as
// a label + value with an "Edit" pencil; on click, swaps the value
// for an input and Save/Cancel buttons. The save handler is async so
// the parent can run a server mutation before we re-collapse the row.
//
// Errors are surfaced inline beneath the input. We deliberately do
// NOT collapse the row on error so the user can correct and retry
// without re-typing. A blank/unchanged save is treated as a no-op
// cancel for forgiving UX.

interface ProfileFieldProps {
  label: string;
  value: string;
  placeholder?: string;
  type?: "text" | "email";
  onSave: (next: string) => Promise<void>;
}

export default function ProfileField({
  label,
  value,
  placeholder,
  type = "text",
  onSave,
}: ProfileFieldProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Resync the draft when the parent re-fetches and the user isn't
  // mid-edit. Prevents the input from showing a stale value if the
  // server-side update was applied via another client.
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  async function handleSave() {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === value) {
      setEditing(false);
      setError(null);
      return;
    }
    // Lightweight client-side email validation. The server is the
    // authoritative validator, but rejecting obviously malformed
    // input here saves a round-trip and keeps the failure inline.
    if (type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError("Invalid email address");
      return;
    }
    try {
      setSaving(true);
      setError(null);
      await onSave(trimmed);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    setDraft(value);
    setEditing(false);
    setError(null);
  }

  return (
    <div className="px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-wider text-fg-4 mb-1.5">
        {label}
      </div>
      {editing ? (
        <div className="flex items-center gap-2">
          <input
            type={type}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={placeholder}
            disabled={saving}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
              if (e.key === "Escape") handleCancel();
            }}
            className="flex-1 px-2.5 py-1.5 text-xs bg-base-300 border border-edge rounded-md text-fg focus:outline-none focus:border-accent/60 disabled:opacity-60"
          />
          <button
            onClick={handleSave}
            disabled={saving}
            aria-label="Save"
            className={clsx(
              "p-1.5 rounded-md transition-colors",
              "bg-accent/10 text-accent hover:bg-accent/20",
              "disabled:opacity-60 disabled:cursor-not-allowed",
            )}
          >
            {saving ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Check size={12} />
            )}
          </button>
          <button
            onClick={handleCancel}
            disabled={saving}
            aria-label="Cancel"
            className="p-1.5 rounded-md text-fg-4 hover:text-fg-2 hover:bg-base-300 disabled:opacity-60 transition-colors"
          >
            <X size={12} />
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-fg-2 truncate min-w-0 flex-1">
            {value || (
              <span className="italic text-fg-4">
                {placeholder ?? "Not set"}
              </span>
            )}
          </span>
          <button
            onClick={() => setEditing(true)}
            className="shrink-0 flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-fg-4 hover:text-fg-2 hover:bg-base-300 rounded-md transition-colors"
          >
            <Pencil size={10} /> Edit
          </button>
        </div>
      )}
      {error && (
        <p className="mt-1.5 text-[11px] text-error/80 leading-snug">{error}</p>
      )}
    </div>
  );
}
