import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import AlsoCell from "./AlsoCell";
import { accentFor } from "./parts";

describe("AlsoCell", () => {
  it("names the widget and says why it has nothing on, in that widget's colour", () => {
    const { getByText, container } = render(<AlsoCell code="EPL" text="next match Sat, Oct 17, 6:30 AM" accent="#37003c" />);
    expect(getByText("EPL")).toBeTruthy();
    expect(getByText("next match Sat, Oct 17, 6:30 AM")).toBeTruthy();
    expect((container.querySelector("button") as HTMLElement).style.getPropertyValue("--accent")).toBe("#37003c");
  });

  it("width-stable: the tag is first and fixed, the message truncates after it", () => {
    const { container } = render(<AlsoCell code="NBA" text="off-season" accent="#c9082a" />);
    expect(container.querySelector('[data-part="code"]')!.classList.contains("shrink-0")).toBe(true);
    const text = container.querySelector('[data-part="text"]')!;
    expect(text.classList.contains("min-w-0")).toBe(true);
    expect(text.classList.contains("truncate")).toBe(true);
  });

  it("clicks through", () => {
    const onClick = vi.fn();
    const { container } = render(<AlsoCell code="PBS" text="no headlines yet" accent="#2638c4" onClick={onClick} />);
    fireEvent.click(container.querySelector("button")!);
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe("accentFor", () => {
  it("widget: the brand colour, lifted on dark only", () => {
    expect(accentFor("widget", "#0b2265", false)).toBe("#0b2265");
    expect(accentFor("widget", "#0b2265", true)).not.toBe("#0b2265");
    expect(accentFor("widget", "#ffcc00", true)).toBe("#ffcc00");
  });

  it("theme is the app's green; subtle, or no brand, is grey", () => {
    expect(accentFor("theme", "#0b2265", true)).toBe("var(--color-primary)");
    expect(accentFor("subtle", "#0b2265", true)).toBe("var(--color-fg-3)");
    expect(accentFor("widget", undefined, true)).toBe("var(--color-fg-3)");
  });
});
