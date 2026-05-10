/**
 * EmptySection — unified empty state for any page section.
 *
 * Replaces the per-page bespoke empty states (Home, Catalog filter,
 * Source Feed-tab, Source Configure-tab, etc.) with one component
 * that renders a centered icon + title + 1-line message + optional
 * primary CTA.
 *
 * Used inside <PageSection variant="card"> as the body when the
 * section has nothing to show, and standalone as a hero-style empty
 * for the entire content area.
 *
 * IA refactor 2026-05-09 — every empty looks the same so users learn
 * the pattern once.
 */
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { motion } from "motion/react";
import clsx from "clsx";

// ── Props ───────────────────────────────────────────────────────

interface EmptySectionProps {
  /** Lucide icon component rendered in a tinted circle at the top. */
  icon: LucideIcon;
  /** Required H-level message. Keep it short. */
  title: string;
  /** Optional 1–2 line explanation under the title. */
  description?: string;
  /** Optional primary action (button/link element). */
  action?: ReactNode;
  /** Compact density — used inside small cards. */
  compact?: boolean;
}

// ── Component ───────────────────────────────────────────────────

export default function EmptySection({
  icon: Icon,
  title,
  description,
  action,
  compact = false,
}: EmptySectionProps) {
  // Children stagger in. Icon pops with a spring, then heading,
  // description, and action fade up in sequence. Keeps the
  // "first-paint of an empty room" feeling welcoming, not abrupt.
  return (
    <div
      className={clsx(
        "flex flex-col items-center justify-center text-center",
        compact ? "py-6 px-4" : "py-12 px-6",
      )}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: "spring", stiffness: 280, damping: 22 }}
        className={clsx(
          "inline-flex items-center justify-center rounded-full bg-accent/10 text-accent",
          compact ? "w-9 h-9 mb-3" : "w-12 h-12 mb-4",
        )}
      >
        <Icon size={compact ? 16 : 22} aria-hidden />
      </motion.div>
      <motion.h3
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, delay: 0.06, ease: [0.22, 0.61, 0.36, 1] }}
        className={clsx(
          "font-semibold text-fg mb-1.5",
          compact ? "text-sm" : "text-base",
        )}
      >
        {title}
      </motion.h3>
      {description && (
        <motion.p
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: 0.1, ease: [0.22, 0.61, 0.36, 1] }}
          className={clsx(
            "text-fg-3 leading-relaxed max-w-sm mx-auto",
            compact ? "text-[11px] mb-3" : "text-sm mb-5",
          )}
        >
          {description}
        </motion.p>
      )}
      {action && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: 0.14, ease: [0.22, 0.61, 0.36, 1] }}
        >
          {action}
        </motion.div>
      )}
    </div>
  );
}
