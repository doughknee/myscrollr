import { describe, it, expect } from "vitest";

import { getDataWidget, getAllDataWidgets } from "./registry";
import { getCatalogItems } from "../marketplace";

// Regression guard for REL-50: the registry matches manifest exports by the
// name suffix "DataWidget". If the suffix and the
// `*DataWidget` export names ever drift apart again, NO data-widget source
// registers, and every data catalog item is silently dropped — the Catalog
// page collapses to Utilities only. tsc can't see this (runtime glob match),
// so assert it here.
const DATA_SOURCES = ["finance", "sports", "fantasy", "rss", "predictions"] as const;

describe("datawidget registry", () => {
  it("registers every data-widget source", () => {
    for (const id of DATA_SOURCES) {
      expect(getDataWidget(id), `source "${id}" not registered`).toBeDefined();
    }
    expect(getAllDataWidgets().length).toBe(DATA_SOURCES.length);
  });

  // REL-63: Home used to dispatch on source name in routes/feed.tsx, so a
  // source without a renderer just fell through to a generic empty row. Now
  // feed.tsx renders `manifest.HomeRows` unconditionally — a source that
  // forgot to wire one would crash the Home page rather than degrade. The
  // type makes it required, but the registry is populated by a runtime glob
  // that tsc cannot see through, so assert it.
  it("every data-widget source provides a Home renderer", () => {
    for (const id of DATA_SOURCES) {
      const m = getDataWidget(id);
      expect(typeof m?.HomeRows, `source "${id}" has no HomeRows`).toBe("function");
    }
  });

  // The optional Home hooks must be functions when present — a stray object
  // or string would throw only when a user opened Home with that widget.
  it("optional Home hooks are functions when defined", () => {
    for (const id of DATA_SOURCES) {
      const m = getDataWidget(id)!;
      for (const hook of ["normalizeHome"] as const) {
        const fn = m[hook];
        if (fn !== undefined) {
          expect(typeof fn, `${id}.${hook} is not a function`).toBe("function");
        }
      }
    }
  });

  it("surfaces data widgets in every category of the catalog", () => {
    const byCategory = new Set(getCatalogItems().map((it) => it.category));
    for (const c of ["finance", "sports", "news", "fantasy", "predictions"]) {
      expect(byCategory.has(c as never), `category "${c}" has no catalog items`).toBe(true);
    }
  });
});
