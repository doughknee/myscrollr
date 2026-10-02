/** The GitHub widget's config migration (SCROLLR-312): never lose a repo list. */
import { describe, expect, it } from "vitest";
import { GITHUB_DEFAULTS, inQuietHours, migrateGitHub } from "./config";

const DEFAULTS = { prs: "mine", issues: "off" };

describe("migrateGitHub", () => {
  it("nothing stored (a fresh install, a pre-GitHub blob, garbage): the defaults", () => {
    for (const raw of [undefined, null, {}, "x", 7, { repos: "nope" }]) {
      expect(migrateGitHub(raw)).toEqual(GITHUB_DEFAULTS);
    }
  });

  it("1.7.0's {owner, repo} list: every repo kept, in order, with the defaults; workflows left to core", () => {
    const got = migrateGitHub({ repos: [{ owner: "octo", repo: "app" }, { owner: "o", repo: "r" }] });
    expect(got.repos).toEqual([
      { repo: "octo/app", ...DEFAULTS },
      { repo: "o/r", ...DEFAULTS },
    ]);
    expect(got.repos[0]).not.toHaveProperty("workflows");
  });

  it("1.7.0's bar prefs: quiet hours and the flash kept, the other switches dropped", () => {
    const got = migrateGitHub({
      repos: [{ owner: "o", repo: "r" }],
      bar: { quiet: true, quietFrom: "23:00", quietTo: "07:00", flash: false, reviews: false, otherPRs: true },
    });
    expect(got).toEqual({ repos: [{ repo: "o/r", ...DEFAULTS }], quietHours: { on: true, from: "23:00", to: "07:00" }, flash: false });
    expect(got).not.toHaveProperty("bar");
  });

  it("this release's shape round-trips; a bad field falls back to its default, never costing the repo", () => {
    const v2 = {
      repos: [
        { repo: "o/a", workflows: ["test", "deploy"], prs: "all", issues: "assigned" },
        { repo: "o/b", workflows: [], prs: "off", issues: "new" },
        { repo: "o/c", workflows: [3, "lint"], prs: "everything", issues: 9 },
      ],
      quietHours: { on: true, from: "22:30", to: "nope" },
      flash: false,
    };
    expect(migrateGitHub(v2)).toEqual({
      repos: [
        { repo: "o/a", workflows: ["test", "deploy"], prs: "all", issues: "assigned" },
        { repo: "o/b", workflows: [], prs: "off", issues: "new" },
        { repo: "o/c", workflows: ["lint"], ...DEFAULTS },
      ],
      quietHours: { on: true, from: "22:30", to: "08:00" },
      flash: false,
    });
    expect(migrateGitHub(migrateGitHub(v2))).toEqual(migrateGitHub(v2));
  });

  it("a mixed list (both shapes, a bare name, duplicates in other casing, junk): every readable repo once", () => {
    const got = migrateGitHub({
      repos: [{ owner: "o", repo: "a" }, { repo: "O/A", prs: "all" }, "o/b", { repo: "not a repo" }, null, { owner: 1, repo: "x" }],
    });
    expect(got.repos.map((r) => r.repo)).toEqual(["o/a", "o/b"]);
  });
});

describe("inQuietHours", () => {
  const at = (h: number, m = 0) => new Date(2026, 9, 2, h, m);
  it("a window across midnight, one inside a day, off, and from = to", () => {
    const night = { on: true, from: "22:00", to: "08:00" };
    expect([at(23), at(7, 59), at(8), at(12)].map((d) => inQuietHours(night, d))).toEqual([true, true, false, false]);
    expect(inQuietHours({ on: true, from: "12:00", to: "13:00" }, at(12, 30))).toBe(true);
    expect(inQuietHours({ ...night, on: false }, at(23))).toBe(false);
    expect(inQuietHours({ on: true, from: "09:00", to: "09:00" }, at(9))).toBe(false);
  });
});
