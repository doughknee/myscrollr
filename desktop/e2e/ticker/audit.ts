/**
 * Rule-6 audit, injected with `page.addInitScript` (SCROLLR-227). Ported
 * from scripts/dev/rel234-install-audit.js (validated on PR #339). Buffers
 * every DOM mutation inside `.ticker-container` to `window.__tickerAudit`
 * with, per mutation, whether any instance of that chip overlapped the
 * container at that moment. Classification is offline, in
 * src/dev/tickerIdentity.ts.
 *
 * Self-contained on purpose: Playwright serialises this function's source
 * into the page, so nothing outside it may be referenced.
 */
export function installTickerAudit() {
  const AUDIT_CAP = 5000;
  const w = window as unknown as { __tickerAudit: unknown[]; __tickerObs?: MutationObserver };
  w.__tickerAudit = [];

  const install = (container: Element) => {
    const chipWrapperFor = (node: Node): Element | null => {
      let el: Element | null = node.nodeType === 3 ? node.parentElement : (node as Element);
      while (el && el !== container && !el.hasAttribute("data-chip")) el = el.parentElement;
      return el && el !== container ? el : null;
    };
    const overlaps = (el: Element) => {
      const box = container.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      return r.right > box.left && r.left < box.right;
    };
    const anyInstanceVisible = (chipEl: Element) => {
      const slot = chipEl.getAttribute("data-rotate-slot");
      const nodes = slot ? container.querySelectorAll(`[data-rotate-slot="${CSS.escape(slot)}"]`) : [chipEl];
      for (const n of nodes) if (overlaps(n)) return true;
      return false;
    };
    const UTILITY_LABELS = ["SYSMON", "CLOCK", "WEATHER", "TIMER"];
    const LEAGUE_PREFIXES = [
      "MLB", "MLS", "NFL", "NBA", "NHL", "NCAAF", "NCAAB", "EPL", "UFC", "F1",
      "BUNDESLIGA", "SERIE A", "LIGUE 1", "EUROLEAGUE", "KHL", "NPB",
    ];
    const kindOf = (chipEl: Element) => {
      const slot = chipEl.getAttribute("data-rotate-slot");
      if (slot) {
        const tag = slot.replace(/-slot-\d+$/, "").split("-")[0];
        if (tag === "spo") return "sports";
        if (tag === "fin") return "finance";
        if (tag === "rss") return "news";
        if (tag === "pred") return "predictions";
        if (tag === "uptime" || tag === "github") return "utility-capped";
        return tag;
      }
      const text = (chipEl.textContent || "").toUpperCase();
      if (UTILITY_LABELS.some((l) => text.startsWith(l))) return "utility";
      if (LEAGUE_PREFIXES.some((l) => text.startsWith(l))) return "sports";
      if (/^[A-Z.]{1,6}(\/[A-Z]{2,4})?[\d▲▼]/.test(text)) return "finance";
      return "unlabeled-fixed";
    };
    // Stable per-node identity across renders, so two concurrently-live
    // chips are never diffed against each other offline.
    let nextNodeId = 1;
    const nodeIds = new WeakMap<Element, number>();
    const idFor = (chipEl: Element) => {
      let id = nodeIds.get(chipEl);
      if (!id) {
        id = nextNodeId++;
        nodeIds.set(chipEl, id);
      }
      return id;
    };
    const push = (entry: unknown) => {
      const buf = w.__tickerAudit;
      buf.push(entry);
      if (buf.length > AUDIT_CAP) buf.splice(0, buf.length - AUDIT_CAP);
    };
    const obs = new MutationObserver((mutations) => {
      const now = Date.now();
      for (const m of mutations) {
        const chipEl = chipWrapperFor(m.target);
        if (!chipEl) continue;
        let before: string | null = null;
        let after: string | null = null;
        if (m.type === "characterData") {
          before = m.oldValue;
          after = m.target.textContent;
        } else if (m.type === "childList") {
          before = [...m.removedNodes].map((n) => n.textContent || "").join("|");
          after = [...m.addedNodes].map((n) => n.textContent || "").join("|");
          if (!before && !after) continue; // attribute-only churn on a childList record
        } else if (m.type === "attributes") {
          if (m.attributeName !== "data-rotate-slot") continue;
          before = m.oldValue;
          after = chipEl.getAttribute("data-rotate-slot");
          if (before === after) continue;
        }
        push({
          t: now,
          type: m.type,
          slot: chipEl.getAttribute("data-rotate-slot") || null,
          nodeId: idFor(chipEl),
          kind: kindOf(chipEl),
          before: (before || "").slice(0, 100),
          after: (after || "").slice(0, 100),
          chipText: (chipEl.textContent || "").slice(0, 100),
          visibleWhileChanging: anyInstanceVisible(chipEl),
        });
      }
    });
    obs.observe(container, {
      subtree: true,
      childList: true,
      characterData: true,
      characterDataOldValue: true,
      attributes: true,
      attributeOldValue: true,
      attributeFilter: ["data-rotate-slot"],
    });
    w.__tickerObs = obs;
  };

  // An init script runs before the document exists; wait for the bar.
  // And keep waiting: the first .ticker-container is the clock-only bar
  // rendered before /dashboard answers, and React replaces that element
  // when the data arrives, so follow the container, not the first one.
  let installed: Element | null = null;
  const waiter = new MutationObserver(() => {
    const c = document.querySelector(".ticker-container");
    if (!c || c === installed) return;
    w.__tickerObs?.disconnect();
    installed = c;
    install(c);
  });
  waiter.observe(document, { childList: true, subtree: true });
}
