// REL-234: install a rule-6 audit harness on the ticker window.
// Buffers every DOM mutation inside .ticker-container to
// window.__tickerAudit (capped at 5000); the driving session drains it
// periodically. Each chip DOM node gets a stable synthetic id (WeakMap) so
// concurrently-live chips are never conflated with each other when
// diffing "did this same position's content change" offline.
(() => {
  if (window.__tickerObs) {
    window.__tickerObs.disconnect();
  }
  const container = document.querySelector(".ticker-container");
  if (!container) return "NO CONTAINER";
  window.__tickerAudit = [];
  const AUDIT_CAP = 5000;

  const chipWrapperFor = (node) => {
    let el = node.nodeType === 3 ? node.parentElement : node;
    while (el && el !== container && !(el.hasAttribute && el.hasAttribute("data-chip"))) {
      el = el.parentElement;
    }
    return el && el !== container ? el : null;
  };

  const overlaps = (el) => {
    const box = container.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return r.right > box.left && r.left < box.right;
  };

  const anyInstanceVisible = (chipEl) => {
    const slot = chipEl.getAttribute("data-rotate-slot");
    const nodes = slot
      ? container.querySelectorAll(`[data-rotate-slot="${CSS.escape(slot)}"]`)
      : [chipEl];
    for (const n of nodes) {
      if (overlaps(n)) return true;
    }
    return false;
  };

  const UTILITY_LABELS = ["SYSMON", "CLOCK", "WEATHER", "TIMER"];
  const LEAGUE_PREFIXES = [
    "MLB", "MLS", "NFL", "NBA", "NHL", "NCAAF", "NCAAB", "EPL", "UFC", "F1",
    "BUNDESLIGA", "SERIE A", "LIGUE 1", "EUROLEAGUE", "KHL", "NPB",
  ];
  const kindOf = (chipEl) => {
    const slot = chipEl.getAttribute("data-rotate-slot");
    if (slot) {
      const prefix = slot.replace(/-slot-\d+$/, "");
      const tag = prefix.split("-")[0];
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
  // chips (e.g. one finance symbol and the sysmon gauge) are never diffed
  // against each other just because neither has a data-rotate-slot.
  let nextNodeId = 1;
  const nodeIds = new WeakMap();
  const idFor = (chipEl) => {
    let id = nodeIds.get(chipEl);
    if (!id) {
      id = nextNodeId++;
      nodeIds.set(chipEl, id);
    }
    return id;
  };

  const push = (entry) => {
    const buf = window.__tickerAudit;
    buf.push(entry);
    if (buf.length > AUDIT_CAP) buf.splice(0, buf.length - AUDIT_CAP);
  };

  const obs = new MutationObserver((mutations) => {
    const now = Date.now();
    for (const m of mutations) {
      const chipEl = chipWrapperFor(m.target);
      if (!chipEl) continue;
      let before = null;
      let after = null;
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
  window.__tickerObs = obs;
  return { installed: true, initialCount: container.querySelectorAll(".ticker-item, .clone-item").length };
})()
