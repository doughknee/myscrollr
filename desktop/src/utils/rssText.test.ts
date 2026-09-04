import { describe, it, expect } from "vitest";
import { decodeEntities, plainText, sourceTab } from "./rssText";

describe("decodeEntities", () => {
  it("decodes the forms feeds actually emit", () => {
    expect(decodeEntities("There&#39;s")).toBe("There's");
    expect(decodeEntities("Here&rsquo;s &amp; there")).toBe("Here’s & there");
    expect(decodeEntities("&#x27;quoted&#x27;")).toBe("'quoted'");
  });
  it("leaves unknown entities alone rather than eating them", () => {
    expect(decodeEntities("&bogus;")).toBe("&bogus;");
  });
});

describe("plainText", () => {
  it("strips tags and collapses whitespace", () => {
    expect(plainText("<p>Overview</p>\n\n  If you   <b>recently</b> updated")).toBe("Overview If you recently updated");
  });
  it("is empty for nothing", () => {
    expect(plainText(null)).toBe("");
    expect(plainText("   ")).toBe("");
  });
});

describe("sourceTab", () => {
  it("uppercases and drops a leading The", () => {
    expect(sourceTab("The Guardian")).toBe("GUARDIAN");
    expect(sourceTab("Engadget")).toBe("ENGADGET");
  });
  it("falls back to the first word past twelve characters", () => {
    expect(sourceTab("The Hollywood Reporter")).toBe("HOLLYWOOD");
    expect(sourceTab("PBS NewsHour")).toBe("PBS NEWSHOUR"); // exactly 12
    expect(sourceTab("Seeking Alpha")).toBe("SEEKING");
  });
});
