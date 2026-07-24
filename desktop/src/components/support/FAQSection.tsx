import { useState } from "react";
import clsx from "clsx";
import Disclosure from "./Disclosure";
import { FAQ_ITEMS } from "./support-content";

export default function FAQSection() {
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

  // Wraps the question rows in the shared dense-card chrome used
  // by Settings/Catalog so the FAQ list reads as a single panel
  // instead of a flat divider stack.
  return (
    <div className="rounded-xl border border-edge/35 bg-base-150/35 overflow-hidden">
      {FAQ_ITEMS.map((item, i) => (
        <div
          key={i}
          className={clsx(
            i > 0 && "border-t border-edge/35",
          )}
        >
          <Disclosure
            open={expanded.has(i)}
            onToggle={() => toggle(i)}
            className="justify-between"
            header={
              <span className="text-ui-body font-medium">
                {item.question}
              </span>
            }
          >
            <p className="px-4 pb-4 pt-1 text-ui-meta">{item.answer}</p>
          </Disclosure>
        </div>
      ))}
    </div>
  );
}
