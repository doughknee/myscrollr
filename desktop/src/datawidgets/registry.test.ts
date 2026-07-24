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

  it("surfaces data widgets in every category of the catalog", () => {
    const byCategory = new Set(getCatalogItems().map((it) => it.category));
    for (const c of ["finance", "sports", "news", "fantasy", "predictions"]) {
      expect(byCategory.has(c as never), `category "${c}" has no catalog items`).toBe(true);
    }
  });
});
