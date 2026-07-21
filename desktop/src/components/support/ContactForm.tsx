/**
 * ContactForm — unified support form with six categories:
 * Bug Report, Feature Request, General Feedback, Billing, Account, and Widget Help.
 *
 * Bug reports collect diagnostics via `collect_diagnostics` Tauri command,
 * file attachments, and frequency. Feature requests collect priority.
 * All categories pre-fill user identity from the auth JWT when available.
 */
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Bug, Lightbulb, MessageSquare, CreditCard, UserCog, Radio, Paperclip, X, Loader2 } from "lucide-react";
import clsx from "clsx";
import { toast } from "sonner";
import { authFetch, ApiError } from "../../api/client";
import { SelectMenu } from "../widget-bar/SelectMenu";
import { getUserIdentity, isAuthenticated } from "../../auth";
import { getCatalogItems } from "../../marketplace";

// ── Types ────────────────────────────────────────────────────────

interface ContactFormProps {
  onBack: () => void;
}

type Category = "bug" | "feature" | "feedback" | "billing" | "account" | "widget";

interface Attachment {
  filename: string;
  mime_type: string;
  data: string; // base64
}

type Frequency = "always" | "sometimes" | "first_time";
type Priority = "nice_to_have" | "important" | "critical";

// ── Constants ────────────────────────────────────────────────────

const CATEGORY_OPTIONS: { value: Category; label: string; icon: typeof Bug }[] = [
  { value: "bug", label: "Bug Report", icon: Bug },
  { value: "feature", label: "Feature Request", icon: Lightbulb },
  { value: "feedback", label: "General Feedback", icon: MessageSquare },
  { value: "billing", label: "Billing & Subscription", icon: CreditCard },
  { value: "account", label: "Account & Login", icon: UserCog },
  { value: "widget", label: "Widget Help", icon: Radio },
];

const FREQUENCY_OPTIONS: { value: Frequency; label: string }[] = [
  { value: "always", label: "Always" },
  { value: "sometimes", label: "Sometimes" },
  { value: "first_time", label: "First time" },
];

const PRIORITY_OPTIONS: { value: Priority; label: string }[] = [
  { value: "nice_to_have", label: "Nice to have" },
  { value: "important", label: "Important" },
  { value: "critical", label: "Critical" },
];

const HEADER_CONFIG: Record<Category, { title: string; subtitle: string }> = {
  bug: {
    title: "Report a Bug",
    subtitle: "Describe the issue and we'll include diagnostics automatically",
  },
  feature: {
    title: "Request a Feature",
    subtitle: "Tell us what you'd like to see in Scrollr",
  },
  feedback: {
    title: "Send Feedback",
    subtitle: "Share your thoughts and suggestions",
  },
  billing: {
    title: "Billing & Subscription Help",
    subtitle: "Questions about charges, plan changes, or cancellations",
  },
  account: {
    title: "Account & Login Help",
    subtitle: "Issues with signing in, password, or account settings",
  },
  widget: {
    title: "Widget Help",
    subtitle: "Issues with a specific widget",
  },
};

const SUBMIT_LABELS: Record<Category, string> = {
  bug: "Submit Bug Report",
  feature: "Submit Feature Request",
  feedback: "Submit Feedback",
  billing: "Submit Billing Question",
  account: "Submit Account Question",
  widget: "Submit Widget Issue",
};

const SUCCESS_MESSAGES: Record<Category, string> = {
  bug: "Bug report submitted — we'll follow up by email",
  feature: "Feature request submitted — thanks for the suggestion",
  feedback: "Feedback submitted — thanks for sharing",
  billing: "Billing question submitted — we'll follow up by email",
  account: "Account question submitted — we'll follow up by email",
  widget: "Widget issue submitted — we'll follow up by email",
};

const MAX_FILES = 5;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

// ── Helpers ──────────────────────────────────────────────────────

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip the data:...;base64, prefix
      const base64 = result.split(",")[1] ?? "";
      resolve(base64);
    };
    reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
    reader.readAsDataURL(file);
  });
}

// ── Component ────────────────────────────────────────────────────

export default function ContactForm({ onBack }: ContactFormProps) {
  // Category
  const [category, setCategory] = useState<Category>("bug");

  // Shared fields
  const [description, setDescription] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");

  // Bug-specific fields
  const [whatWentWrong, setWhatWentWrong] = useState("");
  const [expectedBehavior, setExpectedBehavior] = useState("");
  const [frequency, setFrequency] = useState<Frequency | null>(null);

  // Feature-specific fields
  const [featureWhy, setFeatureWhy] = useState("");
  const [priority, setPriority] = useState<Priority | null>(null);

  // DataWidgetRow-specific fields
  const [widgetSelection, setWidgetSelection] = useState("");

  // Driven by the catalog rather than a hardcoded list. The old options were
  // the four coarse sources (Finance/Sports/RSS/Fantasy) under a label that
  // already asked "Which widget?" — so a user reporting a broken NFL feed had
  // to pick "Sports". The catalog is the authority on what a widget is, and
  // this stays correct as widgets are added server-side.
  const widgetOptions = useMemo(
    () => [
      { value: "", label: "Select a widget..." },
      ...getCatalogItems().map((w) => ({ value: w.name, label: w.name })),
    ],
    [],
  );

  // Attachments (bug only)
  const [files, setFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Diagnostics
  const [diagnostics, setDiagnostics] = useState<Record<string, unknown> | null>(null);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(true);

  // Submit state
  const [submitting, setSubmitting] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Auth state
  const authenticated = isAuthenticated();

  // ── Collect diagnostics on mount ────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    invoke<Record<string, unknown>>("collect_diagnostics")
      .then((result) => {
        if (!cancelled) setDiagnostics(result);
      })
      .catch((err) => {
        console.warn("[ContactForm] Failed to collect diagnostics:", err);
        if (!cancelled) setDiagnostics(null);
      })
      .finally(() => {
        if (!cancelled) setDiagnosticsLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  // ── Pre-fill user identity ──────────────────────────────────────
  useEffect(() => {
    const identity = getUserIdentity();
    if (identity.email) setEmail(identity.email);
    if (identity.name) setName(identity.name);
  }, []);

  // ── Cooldown timer cleanup ──────────────────────────────────────
  useEffect(() => {
    return () => {
      if (cooldownRef.current) clearInterval(cooldownRef.current);
    };
  }, []);

  // ── File handling ───────────────────────────────────────────────

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selected = Array.from(e.target.files ?? []);
      if (!selected.length) return;

      // Reset input so the same file can be re-selected
      e.target.value = "";

      const totalAfter = files.length + selected.length;
      if (totalAfter > MAX_FILES) {
        toast.error(`Maximum ${MAX_FILES} files allowed`);
        return;
      }

      const oversized = selected.filter((f) => f.size > MAX_FILE_SIZE);
      if (oversized.length) {
        toast.error(
          `${oversized.map((f) => f.name).join(", ")} exceeds 10MB limit`,
        );
        return;
      }

      setFiles((prev) => [...prev, ...selected]);
    },
    [files.length],
  );

  const removeFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // ── canSubmit logic ─────────────────────────────────────────────

  const canSubmit = (() => {
    if (submitting || cooldown > 0) return false;
    switch (category) {
      case "bug":
        return description.trim().length > 0 && whatWentWrong.trim().length > 0;
      case "feature":
      case "feedback":
      case "billing":
      case "account":
        return description.trim().length > 0;
      case "widget":
        return description.trim().length > 0 && widgetSelection !== "";
    }
  })();

  // ── Submit ──────────────────────────────────────────────────────

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);

    try {
      let payload: Record<string, unknown>;

      if (category === "bug") {
        // Convert files to base64 attachments
        const attachments: Attachment[] = await Promise.all(
          files.map(async (file) => ({
            filename: file.name,
            mime_type: file.type || "application/octet-stream",
            data: await readFileAsBase64(file),
          })),
        );

        payload = {
          category: "bug",
          description: description.trim(),
          what_went_wrong: whatWentWrong.trim(),
          expected_behavior: expectedBehavior.trim() || undefined,
          frequency: frequency ?? undefined,
          diagnostics: diagnostics ?? undefined,
          attachments: attachments.length > 0 ? attachments : undefined,
          email: email.trim() || undefined,
          name: name.trim() || undefined,
        };
      } else if (category === "feature") {
        payload = {
          category: "feature",
          description: description.trim(),
          expected_behavior: featureWhy.trim() || undefined,
          priority: priority ?? undefined,
          email: email.trim() || undefined,
          name: name.trim() || undefined,
        };
      } else if (category === "widget") {
        payload = {
          category: "widget",
          widget: widgetSelection,
          description: description.trim(),
          email: email.trim() || undefined,
          name: name.trim() || undefined,
        };
      } else {
        // feedback, billing, account — all just description
        payload = {
          category,
          description: description.trim(),
          email: email.trim() || undefined,
          name: name.trim() || undefined,
        };
      }

      await authFetch("/support/ticket", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      toast.success(SUCCESS_MESSAGES[category]);
      startCooldown(60);
      onBack();
    } catch (err) {
      // HTTP 429 — backend's per-user rate limit rejected this submission.
      // Surface the specific message AND start the client-side cooldown so
      // the user can't immediately retry (which would just 429 again).
      // Without this, the form's Submit button re-enables instantly and
      // every retry fires another useless 429; the user's UX is "nothing
      // works" when the real answer is "wait a minute."
      if (err instanceof ApiError && err.status === 429) {
        toast.error(err.message || "Please wait before submitting another ticket");
        startCooldown(60);
        return;
      }
      toast.error(`Failed to submit ${SUBMIT_LABELS[category].toLowerCase()} — please try again`);
    } finally {
      setSubmitting(false);
    }
  };

  /** Start the 60s submit-button cooldown. Used on both success and 429. */
  const startCooldown = (seconds: number) => {
    setCooldown(seconds);
    if (cooldownRef.current) clearInterval(cooldownRef.current);
    cooldownRef.current = setInterval(() => {
      setCooldown((prev) => {
        if (prev <= 1) {
          if (cooldownRef.current) clearInterval(cooldownRef.current);
          cooldownRef.current = null;
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  // ── Render helpers ──────────────────────────────────────────────

  // PageLayout already renders the page title (via the route), so we
  // drop the duplicate title banner. The per-category hint stays as
  // a short subtitle inside the card so users still see context for
  // the current category they picked. The form body lives inside a
  // dense card to match the surface chrome used everywhere else.
  const header = HEADER_CONFIG[category];
  const inputClass =
    "w-full bg-base-200 border border-edge/40 rounded-lg px-3 py-2 text-ui-body text-fg resize-none focus:border-accent/60 focus:outline-none placeholder:text-fg-4";
  const labelClass = "block text-ui-meta font-medium text-fg-2 mb-1.5";

  // ── Render ──────────────────────────────────────────────────────

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl border border-edge/35 bg-base-150/35 p-5 max-w-2xl mx-auto"
    >
      <p className="text-ui-meta mb-5">{header.subtitle}</p>

      <div className="space-y-5">
        {/* Category picker */}
        <div className="flex flex-wrap gap-2">
          {CATEGORY_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setCategory(opt.value)}
                className={clsx(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-ui-chip font-medium transition-colors cursor-pointer border",
                  category === opt.value
                    ? "bg-accent/15 text-accent border-accent/30"
                    : "bg-base-200 text-fg-3 border-edge/40 hover:text-fg-2",
                )}
              >
                <Icon size={13} />
                {opt.label}
              </button>
            );
          })}
        </div>

        {/* Email (only if not authenticated) */}
        {!authenticated && (
          <div>
            <label className={labelClass}>Email address</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              className={inputClass}
            />
          </div>
        )}

        {/* ── Bug Report fields ─────────────────────────────────── */}
        {category === "bug" && (
          <>
            <div>
              <label className={labelClass}>
                What were you trying to do?
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                required
                placeholder="Describe what you were doing..."
                className={inputClass}
              />
            </div>

            <div>
              <label className={labelClass}>What went wrong?</label>
              <textarea
                value={whatWentWrong}
                onChange={(e) => setWhatWentWrong(e.target.value)}
                rows={4}
                required
                placeholder="Describe the issue..."
                className={inputClass}
              />
            </div>

            <div>
              <label className={labelClass}>
                What did you expect to happen instead?
              </label>
              <textarea
                value={expectedBehavior}
                onChange={(e) => setExpectedBehavior(e.target.value)}
                rows={3}
                placeholder="Optional..."
                className={inputClass}
              />
            </div>

            {/* Frequency */}
            <div>
              <label className={labelClass}>
                Does this happen every time?
              </label>
              <div className="flex gap-2">
                {FREQUENCY_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setFrequency(opt.value)}
                    className={clsx(
                      "px-3 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer",
                      frequency === opt.value
                        ? "bg-accent/15 text-accent"
                        : "bg-surface-2 text-fg-3 hover:text-fg-2",
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Attachments */}
            <div>
              <label className={labelClass}>Attachments</label>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,.log,.txt,.json"
                onChange={handleFileSelect}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={files.length >= MAX_FILES}
                className={clsx(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer",
                  files.length >= MAX_FILES
                    ? "bg-surface-2 text-fg-4 cursor-not-allowed"
                    : "bg-surface-2 text-fg-3 hover:text-fg-2 hover:bg-surface-hover",
                )}
              >
                <Paperclip size={13} />
                Attach files
              </button>
              <p className="text-[11px] text-fg-4 mt-1">
                Max {MAX_FILES} files, 10MB each. Images, logs, text, JSON.
              </p>

              {/* File chips */}
              {files.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {files.map((file, i) => (
                    <span
                      key={`${file.name}-${i}`}
                      className="inline-flex items-center gap-1 bg-surface-2 border border-edge/30 rounded-md px-2 py-0.5 text-[11px] text-fg-2"
                    >
                      {file.name}
                      <button
                        type="button"
                        onClick={() => removeFile(i)}
                        className="text-fg-4 hover:text-fg-2 transition-colors cursor-pointer"
                        aria-label={`Remove ${file.name}`}
                      >
                        <X size={11} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Diagnostic Info */}
            <details className="group">
              <summary className="text-xs font-medium text-fg-3 cursor-pointer hover:text-fg-2 transition-colors select-none">
                {diagnosticsLoading
                  ? "Collecting system diagnostics..."
                  : "System diagnostics will be included"}
              </summary>
              <div className="mt-2">
                {diagnosticsLoading ? (
                  <div className="flex items-center gap-2 text-xs text-fg-4 py-3">
                    <Loader2 size={13} className="animate-spin" />
                    Collecting diagnostics...
                  </div>
                ) : diagnostics ? (
                  <pre className="text-[11px] font-mono bg-surface-2 rounded p-3 max-h-60 overflow-y-auto text-fg-3 whitespace-pre-wrap break-all">
                    {JSON.stringify(diagnostics, null, 2)}
                  </pre>
                ) : (
                  <p className="text-xs text-fg-4 py-2">
                    Diagnostics could not be collected.
                  </p>
                )}
              </div>
            </details>
          </>
        )}

        {/* ── Feature Request fields ────────────────────────────── */}
        {category === "feature" && (
          <>
            <div>
              <label className={labelClass}>
                What feature would you like?
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                required
                placeholder="Describe the feature..."
                className={inputClass}
              />
            </div>

            <div>
              <label className={labelClass}>
                Why is this important to you?
              </label>
              <textarea
                value={featureWhy}
                onChange={(e) => setFeatureWhy(e.target.value)}
                rows={3}
                placeholder="Optional..."
                className={inputClass}
              />
            </div>

            {/* Priority */}
            <div>
              <label className={labelClass}>How important is this to you?</label>
              <div className="flex gap-2">
                {PRIORITY_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setPriority(opt.value)}
                    className={clsx(
                      "px-3 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer",
                      priority === opt.value
                        ? "bg-accent/15 text-accent"
                        : "bg-surface-2 text-fg-3 hover:text-fg-2",
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {/* ── General Feedback fields ───────────────────────────── */}
        {category === "feedback" && (
          <div>
            <label className={labelClass}>Your feedback</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={5}
              required
              placeholder="What's on your mind?"
              className={inputClass}
            />
            <p className="text-fg-3 text-xs mt-1.5">
              Share suggestions, thoughts, or anything else
            </p>
          </div>
        )}

        {/* ── Billing fields ────────────────────────────────── */}
        {category === "billing" && (
          <div>
            <label className={labelClass}>Describe your billing question</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={5}
              required
              placeholder="Questions about charges, plan changes, cancellations..."
              className={inputClass}
            />
          </div>
        )}

        {/* ── Account fields ────────────────────────────────── */}
        {category === "account" && (
          <div>
            <label className={labelClass}>Describe your account issue</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={5}
              required
              placeholder="Issues with signing in, password, account settings..."
              className={inputClass}
            />
          </div>
        )}

        {/* ── Widget Help fields ───────────────────────────── */}
        {category === "widget" && (
          <>
            <div>
              <label className={labelClass}>Which widget?</label>
              <SelectMenu
                value={widgetSelection}
                options={widgetOptions}
                onChange={setWidgetSelection}
                ariaLabel="Which widget?"
                align="left"
              />
            </div>
            <div>
              <label className={labelClass}>Describe your issue</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={5}
                required
                placeholder="What's happening with this widget?"
                className={inputClass}
              />
            </div>
          </>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={!canSubmit}
          className={clsx(
            "w-full py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer",
            canSubmit
              ? "bg-accent text-white hover:bg-accent/90"
              : "bg-surface-2 text-fg-4 cursor-not-allowed",
          )}
        >
          {submitting ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 size={14} className="animate-spin" />
              Submitting...
            </span>
          ) : cooldown > 0 ? (
            `Submit (${cooldown}s)`
          ) : (
            SUBMIT_LABELS[category]
          )}
        </button>
      </div>
    </form>
  );
}
