/**
 * ContactForm — unified support form with six categories:
 * Bug Report, Feature Request, General Feedback, Billing, Account, and Widget Help.
 *
 * Bug reports collect diagnostics via `collect_diagnostics` Tauri command,
 * file attachments, and frequency. Feature requests collect priority.
 * All categories pre-fill user identity from the auth JWT when available.
 */
import { useState, useEffect, useRef, useCallback, useMemo, useId } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Bug, Lightbulb, MessageSquare, CreditCard, UserCog, Radio, Paperclip, X } from "lucide-react";
import clsx from "clsx";
import { toast } from "sonner";
import { authFetch, request, ApiError } from "../../api/client";
import { SelectMenu } from "../widget-bar/SelectMenu";
import { getUserIdentity, isSignedOut } from "../../auth";
import { getCatalogItems } from "../../marketplace";
import { useCatalog } from "../../hooks/useCatalog";
import LoadingGlyph from "../LoadingGlyph";

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

const CATEGORY_SUBTITLES: Record<Category, string> = {
  bug: "Describe the issue. System diagnostics are added when they can be collected",
  feature: "Tell us what you'd like to see in Scrollr",
  feedback: "Share your thoughts and suggestions",
  billing: "Questions about charges, plan changes, or cancellations",
  account: "Issues with signing in, password, or account settings",
  widget: "Issues with a specific widget",
};

// Categories whose form is a single description textarea — only the
// copy differs.
const SIMPLE_FIELDS: Partial<
  Record<Category, { label: string; placeholder: string; hint?: string }>
> = {
  feedback: {
    label: "Your feedback",
    placeholder: "What's on your mind?",
    hint: "Share suggestions, thoughts, or anything else",
  },
  billing: {
    label: "Describe your billing question",
    placeholder: "Questions about charges, plan changes, cancellations...",
  },
  account: {
    label: "Describe your account issue",
    placeholder: "Issues with signing in, password, account settings...",
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
// Attachments travel as base64 inside the JSON body, which the server caps at
// 4 MiB. Base64 adds a third, so the raw files get 2.5 MiB: 3.3 MiB encoded,
// which leaves room for the text and the diagnostics (D3-2).
const MAX_TOTAL_BYTES = 2.5 * 1024 * 1024;

const formatMB = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

// The public route (signed out) takes bug, feedback, billing and feature only.
// Account and widget questions go in as feedback; the message says which they
// were, so the person reading it still knows.
const PUBLIC_CATEGORY: Record<Category, string> = {
  bug: "bug",
  feature: "feature",
  feedback: "feedback",
  billing: "billing",
  account: "feedback",
  widget: "feedback",
};
const PUBLIC_MESSAGE_MIN = 10;
const PUBLIC_MESSAGE_MAX = 5000;
// The public route counts bytes (Go `len`), so the form must too.
const byteLength = (s: string) => new TextEncoder().encode(s).length;
function clipBytes(s: string, max: number) {
  let out = "";
  let n = 0;
  for (const ch of s) {
    n += byteLength(ch);
    if (n > max) break;
    out += ch;
  }
  return out;
}
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const TOO_LARGE_MESSAGE = `This wasn’t sent because it was too large. Remove an attachment, or use a smaller one (the limit is ${formatMB(MAX_TOTAL_BYTES)} in total). Your text is still here.`;

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
  // the coarse sources (Finance/Sports/RSS) under a label that already asked
  // "Which widget?" — so a user reporting a broken NFL feed had to pick
  // "Sports". The catalog is the authority on what a widget is, and this
  // stays correct as widgets are added server-side.
  // Keyed on the catalog version: with `[]` this pinned the option list to
  // whatever the bundled snapshot held at mount, so a widget added
  // server-side never became reportable.
  const catalogVersion = useCatalog();
  const widgetOptions = useMemo(
    () => [
      { value: "", label: "Select a widget..." },
      ...getCatalogItems().map((w) => ({ value: w.name, label: w.name })),
    ],
    [catalogVersion],
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
  // One send at a time: `submitting` only reaches the next render, so a double
  // click or Enter plus click could start two before the button disables (RC-14).
  const inFlight = useRef(false);
  // Why the last send did not go through, shown beside the button until the next try.
  const [sendError, setSendError] = useState<string | null>(null);

  // Auth state
  // Any stored session counts: authFetch refreshes a lapsed token itself.
  const authenticated = !isSignedOut();
  const uid = useId();
  const id = (name: string) => `${uid}-${name}`;
  const [fileError, setFileError] = useState<string | null>(null);
  const totalBytes = files.reduce((n, f) => n + f.size, 0);

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
        setFileError(`Maximum ${MAX_FILES} files allowed`);
        return;
      }

      const newTotal = totalBytes + selected.reduce((n, f) => n + f.size, 0);
      if (newTotal > MAX_TOTAL_BYTES) {
        setFileError(
          `${selected.map((f) => f.name).join(", ")} would bring the attachments to ${formatMB(newTotal)}. The limit is ${formatMB(MAX_TOTAL_BYTES)} in total.`,
        );
        return;
      }

      setFileError(null);
      setFiles((prev) => [...prev, ...selected]);
    },
    [files.length, totalBytes],
  );

  const removeFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
    setFileError(null);
  }, []);

  // The signed-out message: the route has one text field, so the form's
  // pieces go into it, labelled.
  function buildPublicMessage(): string {
    const parts: string[] = [];
    if (category === "account") parts.push("Account & Login question");
    if (category === "widget") parts.push(`Widget: ${widgetSelection || "not chosen"}`);
    parts.push(description.trim());
    if (category === "bug") {
      parts.push(`What went wrong:\n${whatWentWrong.trim()}`);
      if (expectedBehavior.trim()) parts.push(`Expected:\n${expectedBehavior.trim()}`);
      if (frequency) parts.push(`Happens: ${FREQUENCY_OPTIONS.find((o) => o.value === frequency)?.label}`);
    }
    if (category === "feature") {
      if (featureWhy.trim()) parts.push(`Why it matters:\n${featureWhy.trim()}`);
      if (priority) parts.push(`Importance: ${PRIORITY_OPTIONS.find((o) => o.value === priority)?.label}`);
    }
    return parts.join("\n\n").trim();
  }

  // ── canSubmit logic ─────────────────────────────────────────────

  // Signed out, the public route needs a real email and a message of 10 to
  // 5000 characters once the form has put its pieces together.
  const publicMessage = buildPublicMessage();
  const publicProblem = authenticated
    ? null
    : !EMAIL_PATTERN.test(email.trim())
      ? "Enter the email address we should reply to."
      : byteLength(publicMessage) < PUBLIC_MESSAGE_MIN && description.trim().length > 0
        ? `Write at least ${PUBLIC_MESSAGE_MIN} characters so we can help.`
        : byteLength(publicMessage) > PUBLIC_MESSAGE_MAX
          ? `That is too long to send without signing in (about ${PUBLIC_MESSAGE_MAX} letters at most, fewer in languages that use accents or other scripts).`
          : null;

  const canSubmit = (() => {
    if (submitting || cooldown > 0) return false;
    if (publicProblem) return false;
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
    if (!canSubmit || inFlight.current) return;

    inFlight.current = true;
    setSubmitting(true);
    setSendError(null);

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

      if (authenticated) {
        await authFetch("/support/ticket", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        // Signed out there is no session to refresh and none to lose, so this
        // goes through the plain `request`: no token, no session banner.
        const label = CATEGORY_OPTIONS.find((o) => o.value === category)?.label ?? "Message";
        const firstLine = description.trim().split("\n")[0];
        await request("/support/ticket/public", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: email.trim(),
            category: PUBLIC_CATEGORY[category],
            subject: clipBytes(`${label}: ${firstLine}`, 200),
            message: publicMessage,
            name: name.trim() || undefined,
          }),
        });
      }

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
      // The server answered with a refusal: nothing was created. No answer at
      // all (the 15 s deadline, a dropped connection) or a 5xx: it may have
      // been created, and sending again could make a second ticket (RC-14).
      // Either way the text stays in the form.
      if (err instanceof ApiError && err.status === 413) {
        setSendError(TOO_LARGE_MESSAGE);
        toast.error("Couldn’t send your message");
        return;
      }
      const unknown = !(err instanceof ApiError) || err.status >= 500;
      const message = unknown
        ? "We couldn’t confirm this was sent, and it may have arrived. Check your email for a confirmation before sending it again. Your text is still here."
        : "This wasn’t sent. Your text is still here, so you can try again.";
      setSendError(message);
      toast.error(unknown ? "Couldn’t confirm your message was sent" : "Couldn’t send your message");
    } finally {
      inFlight.current = false;
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
  const simpleField = SIMPLE_FIELDS[category];
  const inputClass =
    "w-full bg-base-200 border border-edge/40 rounded-lg px-3 py-2 text-ui-body text-fg resize-none focus:border-accent/60 focus:outline-none placeholder:text-fg-4";
  const labelClass = "block text-ui-meta font-medium text-fg-2 mb-1.5";

  // ── Render ──────────────────────────────────────────────────────

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl border border-edge/35 bg-base-150/35 p-5 max-w-2xl mx-auto"
    >
      <p className="text-ui-meta mb-5">
        {category === "bug" && !authenticated
          ? "Describe the issue"
          : CATEGORY_SUBTITLES[category]}
      </p>

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
                aria-pressed={category === opt.value}
                className={clsx(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-ui-chip font-medium cursor-pointer border",
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
            <label htmlFor={id("email")} className={labelClass}>Email address</label>
            <input
              id={id("email")}
              type="email"
              required
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
              <label htmlFor={id("desc")} className={labelClass}>
                What were you trying to do?
              </label>
              <textarea
                id={id("desc")}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                required
                placeholder="Describe what you were doing..."
                className={inputClass}
              />
            </div>

            <div>
              <label htmlFor={id("wrong")} className={labelClass}>What went wrong?</label>
              <textarea
                id={id("wrong")}
                value={whatWentWrong}
                onChange={(e) => setWhatWentWrong(e.target.value)}
                rows={4}
                required
                placeholder="Describe the issue..."
                className={inputClass}
              />
            </div>

            <div>
              <label htmlFor={id("expected")} className={labelClass}>
                What did you expect to happen instead?
              </label>
              <textarea
                id={id("expected")}
                value={expectedBehavior}
                onChange={(e) => setExpectedBehavior(e.target.value)}
                rows={3}
                placeholder="Optional..."
                className={inputClass}
              />
            </div>

            {/* Frequency */}
            <div>
              <span id={id("freq")} className={labelClass}>
                Does this happen every time?
              </span>
              <div role="group" aria-labelledby={id("freq")} className="flex gap-2">
                {FREQUENCY_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    aria-pressed={frequency === opt.value}
                    onClick={() => setFrequency(opt.value)}
                    className={clsx(
                      "px-3 py-1.5 rounded-full text-xs font-medium cursor-pointer",
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

            {authenticated ? (
              <>
              {/* Attachments */}
              <div>
                <span className={labelClass}>Attachments</span>
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
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer",
                    files.length >= MAX_FILES
                      ? "bg-surface-2 text-fg-4 cursor-not-allowed"
                      : "bg-surface-2 text-fg-3 hover:text-fg-2 hover:bg-surface-hover",
                  )}
                >
                  <Paperclip size={13} />
                  Attach files
                </button>
                <p className="text-[11px] text-fg-4 mt-1">
                  Up to {MAX_FILES} files, {formatMB(MAX_TOTAL_BYTES)} in total. Images, logs, text, JSON.
                  {files.length > 0 && ` Attached: ${formatMB(totalBytes)} of ${formatMB(MAX_TOTAL_BYTES)}.`}
                </p>
                {fileError && (
                  <p role="alert" className="text-[11px] text-error mt-1">
                    {fileError}
                  </p>
                )}

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
                          className="text-fg-4 hover:text-fg-2 cursor-pointer"
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
                <summary className="text-xs font-medium text-fg-3 cursor-pointer hover:text-fg-2 select-none">
                  {diagnosticsLoading
                    ? "Collecting system diagnostics..."
                    : diagnostics
                      ? "System diagnostics will be included"
                      : "System diagnostics could not be collected"}
                </summary>
                <div className="mt-2">
                  {diagnosticsLoading ? (
                    <div className="flex items-center gap-2 text-xs text-fg-4 py-3">
                      <LoadingGlyph size={13} />
                      Collecting diagnostics...
                    </div>
                  ) : diagnostics ? (
                    <pre className="text-[11px] font-mono bg-surface-2 rounded p-3 max-h-60 overflow-y-auto text-fg-3 whitespace-pre-wrap break-all">
                      {JSON.stringify(diagnostics, null, 2)}
                    </pre>
                  ) : (
                    <p className="text-xs text-fg-4 py-2">
                      Your report will be sent without them.
                    </p>
                  )}
                </div>
              </details>
              </>
            ) : (
              <p className="text-[11px] text-fg-4">
                Attachments and system diagnostics are only sent when you are signed in.
              </p>
            )}
          </>
        )}

        {/* ── Feature Request fields ────────────────────────────── */}
        {category === "feature" && (
          <>
            <div>
              <label htmlFor={id("desc")} className={labelClass}>
                What feature would you like?
              </label>
              <textarea
                id={id("desc")}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                required
                placeholder="Describe the feature..."
                className={inputClass}
              />
            </div>

            <div>
              <label htmlFor={id("why")} className={labelClass}>
                Why is this important to you?
              </label>
              <textarea
                id={id("why")}
                value={featureWhy}
                onChange={(e) => setFeatureWhy(e.target.value)}
                rows={3}
                placeholder="Optional..."
                className={inputClass}
              />
            </div>

            {/* Priority */}
            <div>
              <span id={id("priority")} className={labelClass}>How important is this to you?</span>
              <div role="group" aria-labelledby={id("priority")} className="flex gap-2">
                {PRIORITY_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    aria-pressed={priority === opt.value}
                    onClick={() => setPriority(opt.value)}
                    className={clsx(
                      "px-3 py-1.5 rounded-full text-xs font-medium cursor-pointer",
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

        {/* ── Feedback / Billing / Account fields ───────────────── */}
        {simpleField && (
          <div>
            <label htmlFor={id("desc")} className={labelClass}>{simpleField.label}</label>
            <textarea
              id={id("desc")}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={5}
              required
              placeholder={simpleField.placeholder}
              className={inputClass}
            />
            {simpleField.hint && (
              <p className="text-fg-3 text-xs mt-1.5">{simpleField.hint}</p>
            )}
          </div>
        )}

        {/* ── Widget Help fields ───────────────────────────── */}
        {category === "widget" && (
          <>
            <div>
              <span className={labelClass}>Which widget?</span>
              <SelectMenu
                value={widgetSelection}
                options={widgetOptions}
                onChange={setWidgetSelection}
                ariaLabel="Which widget?"
                align="left"
              />
            </div>
            <div>
              <label htmlFor={id("desc")} className={labelClass}>Describe your issue</label>
              <textarea
                id={id("desc")}
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

        {publicProblem && description.trim() && (
          <p className="text-ui-meta text-fg-3">{publicProblem}</p>
        )}

        {sendError && (
          <p role="alert" className="text-ui-meta text-error">
            {sendError}
          </p>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={!canSubmit}
          className={clsx(
            "w-full py-2 rounded-lg text-sm font-medium cursor-pointer",
            canSubmit
              ? "bg-accent text-white hover:bg-accent/90"
              : "bg-surface-2 text-fg-4 cursor-not-allowed",
          )}
        >
          {submitting ? (
            <span className="flex items-center justify-center gap-2">
              <LoadingGlyph size={14} />
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
