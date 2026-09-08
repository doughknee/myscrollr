/**
 * The right-click menu reads its pin target out of the DOM, so the parse
 * is the trust boundary: whatever is on the wrapper has to either yield a
 * usable target or nothing at all (REL-239).
 */
import { describe, it, expect } from "vitest";
import { parsePinTarget, pinTargetAt } from "./pinTarget";

describe("parsePinTarget", () => {
  it("reads a well-formed subject", () => {
    expect(
      parsePinTarget('{"widget":"sports_mlb","subject":"New York Yankees","label":"Yankees"}'),
    ).toEqual({
      widget: "sports_mlb",
      subject: "New York Yankees",
      label: "Yankees",
    });
  });

  it("falls back to the subject when no label is carried", () => {
    expect(parsePinTarget('{"widget":"finance_stocks","subject":"AAPL"}')).toEqual({
      widget: "finance_stocks",
      subject: "AAPL",
      label: "AAPL",
    });
  });

  it("returns null for anything it cannot vouch for", () => {
    expect(parsePinTarget(null)).toBeNull();
    expect(parsePinTarget(undefined)).toBeNull();
    expect(parsePinTarget("")).toBeNull();
    expect(parsePinTarget("not json")).toBeNull();
    expect(parsePinTarget("[]")).toBeNull();
    expect(parsePinTarget('"clock"')).toBeNull();
    expect(parsePinTarget('{"widget":"clock"}')).toBeNull();
    expect(parsePinTarget('{"subject":"clock"}')).toBeNull();
    // An empty subject is not a subject; it would pin "nothing".
    expect(parsePinTarget('{"widget":"clock","subject":""}')).toBeNull();
  });
});

describe("pinTargetAt", () => {
  it("walks up from the clicked node to the chip wrapper", () => {
    document.body.innerHTML = `
      <div data-chip="" data-pin-subject='{"widget":"clock","subject":"clock","label":"Clock"}'>
        <button><span id="inner">12:04</span></button>
      </div>`;
    expect(pinTargetAt(document.getElementById("inner"))).toEqual({
      widget: "clock",
      subject: "clock",
      label: "Clock",
    });
  });

  it("returns null off a chip, and for a non-element target", () => {
    document.body.innerHTML = `<div id="bare">nothing here</div>`;
    expect(pinTargetAt(document.getElementById("bare"))).toBeNull();
    expect(pinTargetAt(null)).toBeNull();
    expect(pinTargetAt(window)).toBeNull();
  });
});
