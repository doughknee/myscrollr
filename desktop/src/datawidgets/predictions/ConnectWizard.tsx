/**
 * ConnectWizard — "Connect your Kalshi account".
 *
 * Idiot-proof, on-device account linking. The user never sees the term
 * "API key"; the downloaded private key is called "your secure connection
 * file". The file is imported by DRAG-AND-DROP — Tauri hands us the file's
 * PATH (never its contents), which we pass to the Rust backend. The backend
 * reads, validates (a signed read-only /portfolio/balance call), and stores it
 * in the OS keychain. Nothing secret ever crosses into JS or leaves the
 * machine.
 *
 * Plain-language safety copy is front-and-center: stays on your computer,
 * never sent to Scrollr, read-only (never places bets).
 */
import { useCallback, useEffect, useState } from "react";
import { clsx } from "clsx";
import { open } from "@tauri-apps/plugin-shell";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { motion } from "motion/react";
import {
  ShieldCheck,
  ExternalLink,
  FileCheck2,
  UploadCloud,
  CheckCircle2,
  Loader2,
  AlertCircle,
  HelpCircle,
  ChevronDown,
} from "lucide-react";
import {
  kalshiConnect,
  isKalshiAvailable,
  type CredentialStatus,
} from "./kalshi";
import { formatUsdCents } from "./positions";
import { loadPref, savePref } from "../../preferences";

const HELP_OPEN_KEY = "predictions.connectHelpOpen";

const KALSHI_PROFILE_URL = "https://kalshi.com/account/profile";

interface ConnectWizardProps {
  /** Called once the account is verified + stored. Receives fresh status. */
  onConnected: (status: CredentialStatus) => void;
  hex: string;
}

/** Strip a filesystem path down to its file name for display. */
function baseName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

export default function ConnectWizard({ onConnected, hex }: ConnectWizardProps) {
  const available = isKalshiAvailable();

  const [keyId, setKeyId] = useState("");
  const [filePath, setFilePath] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState<"idle" | "checking" | "ok" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [balanceCents, setBalanceCents] = useState<number | null>(null);

  // "How do I get this?" help — expanded the first time, then remembered.
  const [helpOpen, setHelpOpen] = useState(() => loadPref<boolean>(HELP_OPEN_KEY, true));
  const toggleHelp = useCallback(() => {
    setHelpOpen((prev) => {
      const next = !prev;
      savePref(HELP_OPEN_KEY, next);
      return next;
    });
  }, []);

  // ── Drag-and-drop (Tauri webview-level; gives us file paths) ─────
  // While the wizard is mounted, a file dropped anywhere on the window is
  // treated as the connection file. We highlight the drop zone on hover.
  useEffect(() => {
    if (!available) return;
    let unlisten: (() => void) | null = null;
    let cancelled = false;

    getCurrentWebview()
      .onDragDropEvent((event) => {
        const p = event.payload;
        if (p.type === "over") {
          setDragging(true);
        } else if (p.type === "leave") {
          setDragging(false);
        } else if (p.type === "drop") {
          setDragging(false);
          const dropped = p.paths?.[0];
          if (dropped) {
            setFilePath(dropped);
            setStatus("idle");
            setErrorMsg(null);
          }
        }
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [available]);

  const canConnect = keyId.trim().length > 0 && !!filePath && status !== "checking";

  const handleConnect = useCallback(async () => {
    if (!filePath || keyId.trim().length === 0) return;
    setStatus("checking");
    setErrorMsg(null);
    try {
      const result = await kalshiConnect({ keyId: keyId.trim(), pemPath: filePath });
      setBalanceCents(result.balance_cents);
      setStatus("ok");
      // Brief success beat, then hand control to the panel.
      setTimeout(() => {
        onConnected({ connected: true, key_id: result.key_id });
      }, 1200);
    } catch (err) {
      // The backend returns already-friendly, plain-language messages.
      setStatus("error");
      setErrorMsg(typeof err === "string" ? err : "Something went wrong. Please try again.");
    }
  }, [filePath, keyId, onConnected]);

  if (!available) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
        <ShieldCheck size={28} className="text-fg-3" />
        <p className="text-sm font-medium text-fg-2">Available in the desktop app</p>
        <p className="max-w-xs text-[12px] text-fg-3">
          Connecting your Kalshi account keeps your credentials safely on your
          own computer — so it&rsquo;s only available in the Scrollr desktop app.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-3.5 px-4 py-6">
      {/* Header — compact */}
      <div className="flex flex-col items-center gap-1.5 text-center">
        <div
          className="flex h-11 w-11 items-center justify-center rounded-2xl"
          style={{ background: `${hex}1f`, color: hex }}
        >
          <TrendingUpMark />
        </div>
        <h2 className="text-[17px] font-semibold text-fg">Connect your Kalshi account</h2>
        <p className="max-w-xs text-[12px] leading-relaxed text-fg-3">
          See your balance, positions, and live profit &amp; loss right inside Scrollr.
        </p>
      </div>

      {/* Import card — front and center */}
      <div className="flex flex-col gap-3 rounded-xl border border-edge/50 bg-surface p-3.5">
        {/* One-line safety note */}
        <div className="flex items-center gap-2 rounded-lg bg-up/[0.07] px-2.5 py-1.5 text-[11.5px] text-fg-2">
          <ShieldCheck size={14} className="shrink-0 text-up" />
          <span>
            Stays on your computer · <span className="font-medium">read-only</span> · never
            sent to Scrollr
          </span>
        </div>

        {/* Key ID */}
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-medium text-fg-2">Your Key ID</span>
          <input
            type="text"
            value={keyId}
            onChange={(e) => {
              setKeyId(e.target.value);
              if (status === "error") setStatus("idle");
            }}
            placeholder="e.g. 1a2b3c4d-5e6f-7a8b-…"
            spellCheck={false}
            autoComplete="off"
            className="rounded-lg border border-edge/50 bg-base-100 px-3 py-2 font-mono text-[12px] text-fg outline-none transition-colors focus:border-accent/60"
          />
          <span className="text-[11px] text-fg-4">
            Kalshi shows this next to the connection you just created.
          </span>
        </label>

        {/* Drop zone */}
        <button
          type="button"
          // The actual import is drag-and-drop; clicking just reassures the
          // user where to drop. We intentionally never ask them to paste the
          // file's contents.
          className={clsx(
            "flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors",
            dragging
              ? "border-accent/70 bg-accent/[0.07]"
              : filePath
                ? "border-up/50 bg-up/[0.05]"
                : "border-edge/60 bg-base-100/40 hover:border-edge",
          )}
        >
          {filePath ? (
            <>
              <FileCheck2 size={22} className="text-up" />
              <span className="text-[12.5px] font-medium text-fg">
                {baseName(filePath)}
              </span>
              <span className="text-[11px] text-fg-3">
                Looks good — drop a different file to replace it.
              </span>
            </>
          ) : (
            <>
              <UploadCloud
                size={22}
                className={dragging ? "text-accent" : "text-fg-3"}
              />
              <span className="text-[12.5px] font-medium text-fg-2">
                Drag your secure connection file here
              </span>
              <span className="text-[11px] text-fg-4">
                The file Kalshi downloaded for you
              </span>
            </>
          )}
        </button>

        {/* Error */}
        {status === "error" && errorMsg && (
          <div className="flex items-start gap-2 rounded-lg border border-error/25 bg-error/10 px-3 py-2 text-[12px] text-error">
            <AlertCircle size={15} className="mt-0.5 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Success */}
        {status === "ok" && balanceCents != null && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-2 rounded-lg border border-up/30 bg-up/10 px-3 py-2 text-[13px] font-medium text-up"
          >
            <CheckCircle2 size={16} className="shrink-0" />
            <span>Connected — {formatUsdCents(balanceCents)} in your Kalshi account</span>
          </motion.div>
        )}

        {/* Connect button */}
        <button
          type="button"
          onClick={handleConnect}
          disabled={!canConnect}
          className={clsx(
            "flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-[13px] font-semibold transition-all cursor-pointer",
            canConnect
              ? "text-white hover:-translate-y-px"
              : "cursor-not-allowed bg-surface-2 text-fg-4",
          )}
          style={canConnect ? { background: hex } : undefined}
        >
          {status === "checking" ? (
            <>
              <Loader2 size={15} className="animate-spin" />
              Checking with Kalshi…
            </>
          ) : status === "ok" ? (
            <>
              <CheckCircle2 size={15} />
              Connected
            </>
          ) : (
            "Connect my account"
          )}
        </button>
      </div>

      {/* Collapsible help — "How do I get these?" (open first time, remembered) */}
      <div className="rounded-xl border border-edge/40">
        <button
          type="button"
          onClick={toggleHelp}
          aria-expanded={helpOpen}
          className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-[12.5px] font-medium text-fg-2 transition-colors hover:text-fg cursor-pointer"
        >
          <HelpCircle size={15} className="shrink-0 text-fg-3" />
          How do I get my Key ID and connection file?
          <ChevronDown
            size={15}
            className={clsx("ml-auto shrink-0 text-fg-3 transition-transform", helpOpen ? "" : "-rotate-90")}
          />
        </button>

        {helpOpen && (
          <div className="border-t border-edge/30 px-3.5 py-3">
            <ol className="flex flex-col gap-2.5">
              <GuideStep n={1} title="Open your Kalshi profile">
                <p className="text-[12px] text-fg-3">
                  We&rsquo;ll take you to the right page on Kalshi.
                </p>
                <button
                  type="button"
                  onClick={() => open(KALSHI_PROFILE_URL).catch(() => {})}
                  className="mt-1.5 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium text-white transition-transform hover:-translate-y-px cursor-pointer"
                  style={{ background: hex }}
                >
                  <ExternalLink size={13} />
                  Open Kalshi
                </button>
              </GuideStep>

              <GuideStep n={2} title="Create your secure connection">
                <p className="text-[12px] leading-relaxed text-fg-3">
                  On that page, choose{" "}
                  <span className="font-medium text-fg-2">&ldquo;Create New API Key&rdquo;</span>.
                  A small <span className="font-medium text-fg-2">connection file</span>{" "}
                  downloads to your computer (usually your Downloads folder), and your
                  <span className="font-medium text-fg-2"> Key ID</span> is shown right next to it.
                </p>
              </GuideStep>

              <GuideStep n={3} title="Bring them back here">
                <p className="text-[12px] text-fg-3">
                  Paste the Key ID above and drag the file into the box. That&rsquo;s it.
                </p>
              </GuideStep>
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Bits ─────────────────────────────────────────────────────────

function GuideStep({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-2 font-mono text-[11px] font-semibold text-fg-2">
        {n}
      </span>
      <div className="flex flex-col gap-0.5">
        <span className="text-[13px] font-medium text-fg">{title}</span>
        {children}
      </div>
    </li>
  );
}

/** Small inline mark so the header doesn't depend on the channel icon import. */
function TrendingUpMark() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
      <polyline points="16 7 22 7 22 13" />
    </svg>
  );
}
