import { useState } from "react";
import { ChevronDown, AlertCircle } from "lucide-react";
import clsx from "clsx";
import { TROUBLESHOOTING_ARTICLES } from "./support-content";

export default function TroubleshootingSection() {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  function toggle(index: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }

  return (
    <div className="space-y-3">
      {TROUBLESHOOTING_ARTICLES.map((article, i) => {
        const isOpen = expanded.has(i);
        return (
          <div
            key={i}
            className="overflow-hidden rounded-xl border border-edge/35 bg-base-150/35"
          >
            <button
              onClick={() => toggle(i)}
              aria-expanded={isOpen}
              className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-base-150/50 cursor-pointer"
            >
              <AlertCircle size={16} className="shrink-0 text-accent" />
              <span className="flex-1 text-ui-body font-semibold">
                {article.title}
              </span>
              <ChevronDown
                size={16}
                className={clsx(
                  "shrink-0 text-fg-3 transition-transform duration-200",
                  isOpen && "rotate-180",
                )}
              />
            </button>
            <div
              className={clsx(
                "overflow-hidden transition-all duration-200",
                isOpen ? "max-h-[500px] opacity-100" : "max-h-0 opacity-0",
              )}
            >
              <div className="space-y-4 px-4 pb-4 pt-1">
                <div>
                  <p className="text-ui-section">Symptoms</p>
                  <ul className="mt-1.5 list-inside list-disc space-y-1 text-ui-meta">
                    {article.symptoms.map((symptom, j) => (
                      <li key={j}>{symptom}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="text-ui-section">Steps to fix</p>
                  <ol className="mt-1.5 list-inside list-decimal space-y-1 text-ui-meta">
                    {article.steps.map((step, j) => (
                      <li key={j}>{step}</li>
                    ))}
                  </ol>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
