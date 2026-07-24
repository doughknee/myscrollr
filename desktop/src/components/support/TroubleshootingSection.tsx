import { useState } from "react";
import { AlertCircle } from "lucide-react";
import Disclosure from "./Disclosure";
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
      {TROUBLESHOOTING_ARTICLES.map((article, i) => (
        <div
          key={i}
          className="overflow-hidden rounded-xl border border-edge/35 bg-base-150/35"
        >
          <Disclosure
            open={expanded.has(i)}
            onToggle={() => toggle(i)}
            header={
              <>
                <AlertCircle size={16} className="shrink-0 text-accent" />
                <span className="flex-1 text-ui-body font-semibold">
                  {article.title}
                </span>
              </>
            }
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
          </Disclosure>
        </div>
      ))}
    </div>
  );
}
