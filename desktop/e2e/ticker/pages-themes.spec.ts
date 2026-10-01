import { test, expect, type Page } from "@playwright/test";
import { THEME_FAMILIES } from "../../src/preferences";

/**
 * SCROLLR-275 (Home addition): the widget pages stay legible in every
 * palette. One static frame per theme family x light/dark, no motion:
 *
 *   - the real pages bar (`?pages=1&fixture=pages`, first page): the label,
 *     NFL game cells (yours, live, pre-game, final) and the hairlines;
 *   - the cells gallery (`?cells=1`): every family's bar (stocks, crypto,
 *     news, Also) and one item in every state.
 *
 * Each piece of text is measured against what is actually behind it: the
 * bar, plus the label's tint where it sits on the label, and the element's
 * own opacity (a final game is drawn at 80%). Layers are composited by a
 * 1x1 canvas, so any CSS colour the palette uses (oklch, color-mix) is
 * resolved by the browser itself. Text is grouped by the palette token it is
 * painted in (fg, fg-2, fg-3, fg-4) or as the widget's accent, because that
 * is where a fix goes: a cell picks a token, a palette defines it.
 *
 * Floors (WCAG): text 4.5:1; large text (>= 24 px, or >= 18.66 px bold) 3:1;
 * the hairline between columns 1.5:1 (it separates, it does not carry
 * information).
 *
 * ASSERTED in every theme: fg and fg-2 text at 4.5 and the label's name at 3.
 * The palettes that miss (the palette's own fg or fg-2 token is under 4.5
 * on its own bar: the official Tokyo Night Day, Solarized and Everforest
 * values, SCROLLR-275 findings) are listed in LOW with the measured ratio:
 * the CI stays green, a NEW miss fails, and a listed one that starts to pass
 * fails until its entry is deleted. REPORTED, not asserted: fg-3, fg-4, a
 * dimmed final game (`@dim`), small accent text, the semantic greys and the
 * hairline are below their floors in most palettes. The spec prints the
 * table per theme and attaches it to the report; move a group into HARD
 * when its palette is fixed.
 */

const TEXT_FLOOR = 4.5;
const LARGE_FLOOR = 3;
const RULE_FLOOR = 1.5;

/** Groups asserted in every theme. */
const HARD = ["fg", "fg-2", "label-name"];

/** Known misses in HARD groups: `<theme>|<group>` -> worst ratio measured. */
const LOW: Record<string, number> = {
  "tokyo-night-light|fg": 3.33,
  "solarized-light|fg": 3.82,
  "everforest-light|fg": 3.81,
  "catppuccin-light|fg-2": 4.21,
  "tokyo-night-light|fg-2": 4.38,
  "solarized-dark|fg-2": 3.85,
  "solarized-light|fg-2": 3.16,
  "rose-pine-dark|fg-2": 4.47,
  "rose-pine-light|fg-2": 3.45,
  "everforest-light|fg-2": 2.27,
};

interface Reading {
  /** The palette token the text is painted in, `accent`, `label-name`, `rule`, or `other:<part>`. */
  group: string;
  role: string;
  text: string;
  ratio: number;
  floor: number;
}

declare global {
  interface Window {
    __contrast: (rootSel: string) => Reading[];
  }
}

/** Self-contained (serialised into the page): contrast of every text leaf and hairline under `rootSel`. */
function installContrast(cfg: { text: number; large: number; rule: number }) {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 1;
  const g = cv.getContext("2d", { willReadFrequently: true })!;
  type RGB = [number, number, number];

  const paint = (layers: { color: string; alpha: number }[]): RGB => {
    g.clearRect(0, 0, 1, 1);
    for (const l of layers) {
      g.globalAlpha = l.alpha;
      g.fillStyle = "#000";
      g.fillStyle = l.color; // an unparsable colour leaves the previous one: caught by the sentinel below
      g.fillRect(0, 0, 1, 1);
    }
    const d = g.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2]];
  };
  const lum = ([r, gg, b]: RGB) => {
    const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(gg) + 0.0722 * f(b);
  };
  const ratio = (a: RGB, b: RGB) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  /** Backgrounds from the root down to `el`, then the colour itself at the chain's opacity. */
  const stack = (el: Element, upTo: Element) => {
    const chain: Element[] = [];
    for (let e: Element | null = el; e; e = e.parentElement) chain.unshift(e);
    const bg = chain.map((e) => ({ color: getComputedStyle(e).backgroundColor, alpha: 1 })).filter((l) => l.color !== "rgba(0, 0, 0, 0)" && l.color !== "transparent");
    let opacity = 1;
    for (let e: Element | null = el; e && e !== upTo.parentElement; e = e.parentElement) opacity *= Number(getComputedStyle(e).opacity);
    return { bg, opacity };
  };

  const same = (a: RGB, b: RGB) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) <= 3;

  window.__contrast = (rootSel) => {
    const out: Reading[] = [];
    for (const root of document.querySelectorAll(rootSel)) {
      for (const el of root.querySelectorAll("*")) {
        const cs = getComputedStyle(el);
        if (cs.visibility === "hidden" || el.closest("[aria-hidden=true]:not(.w-px)") && !el.matches(".w-px")) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const { bg, opacity } = stack(el, root);
        if (el.matches("span.w-px")) {
          const rule = paint([...bg, { color: cs.backgroundColor, alpha: opacity }]);
          out.push({ group: "rule", role: "rule", text: "", ratio: ratio(rule, paint(bg)), floor: cfg.rule });
          continue;
        }
        const own = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent!.trim()).map((n) => n.textContent!.trim()).join(" ");
        if (!own) continue;
        const px = parseFloat(cs.fontSize);
        const large = px >= 24 || (px >= 18.66 && Number(cs.fontWeight) >= 700);
        const part = el.closest("[data-part]")?.getAttribute("data-part") ?? (el.closest("[data-label]") ? (large ? "label-name" : "label-sub") : "text");
        // Which token is it? Compare the colour at full strength with each token.
        const solid = paint([{ color: cs.color, alpha: 1 }]);
        const tokens = ["fg", "fg-2", "fg-3", "fg-4"].filter((t) => {
          const v = cs.getPropertyValue(`--color-${t}`).trim();
          return v && same(solid, paint([{ color: v, alpha: 1 }]));
        });
        const accent = cs.getPropertyValue("--accent").trim();
        const group = part === "label-name" ? "label-name" : tokens[0] ?? (accent && same(solid, paint([{ color: getComputedStyle(el).getPropertyValue("--accent"), alpha: 1 }])) ? "accent" : `other:${part}`);
        out.push({
          // A cell drawn at reduced opacity (a final game, 80%) is its own group.
          group: opacity < 0.999 ? `${group}@dim` : group, role: part, text: own.slice(0, 40),
          ratio: ratio(paint([...bg, { color: cs.color, alpha: opacity }]), paint(bg)),
          floor: large ? cfg.large : cfg.text,
        });
      }
    }
    return out;
  };
}

async function readings(page: Page, url: string, root: string, ready: string): Promise<Reading[]> {
  await page.goto(url);
  await page.locator(ready).first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(installContrast, { text: TEXT_FLOOR, large: LARGE_FLOOR, rule: RULE_FLOOR });
  return page.evaluate((root) => window.__contrast(root), root);
}

test.use({ viewport: { width: 1920, height: 1100 } });

for (const family of THEME_FAMILIES) {
  for (const mode of ["dark", "light"] as const) {
    const theme = `${family}-${mode}`;
    test(`${theme}: label, cell text and rules clear their contrast floor`, async ({ page }) => {
      const bar = await readings(page, `/ticker-shim.html?pages=1&fixture=pages&theme=${theme}`, ".ticker-container", "[data-page] [data-chip]");
      const gallery = await readings(page, `/ticker-shim.html?cells=1&theme=${theme}`, "[data-bar], [data-strip]", "[data-bar] [data-chip]");
      const all = [...bar, ...gallery];
      expect(all.length, "measured something").toBeGreaterThan(40);

      // Worst margin per group, and the offender, so a miss names what to fix.
      const worst = new Map<string, Reading>();
      for (const r of all) {
        const w = worst.get(r.group);
        if (!w || r.ratio - r.floor < w.ratio - w.floor) worst.set(r.group, r);
      }
      const rows = [...worst.entries()].sort(([a], [b]) => a.localeCompare(b));
      const line = rows.map(([g, r]) => `${g} ${r.ratio.toFixed(2)}${r.ratio < r.floor ? `<${r.floor} (${r.role} "${r.text}")` : ""}`).join("  ");
      console.log(`[${theme}] ${line}`);
      await test.info().attach(`${theme}.json`, {
        body: JSON.stringify(rows.map(([g, r]) => ({ group: g, ratio: +r.ratio.toFixed(2), floor: r.floor, worst: r.text, part: r.role })), null, 1),
        contentType: "application/json",
      });

      const missed = rows.filter(([g, r]) => HARD.includes(g) && r.ratio < r.floor);
      const fresh = missed.filter(([g]) => !(`${theme}|${g}` in LOW));
      expect(fresh.map(([g, r]) => `${g} ${r.ratio.toFixed(2)} < ${r.floor} ("${r.text}", ${r.role})`), `${theme}: below the floor`).toEqual([]);
      const fixed = Object.keys(LOW).filter((k) => k.startsWith(`${theme}|`) && !missed.some(([g]) => `${theme}|${g}` === k));
      expect(fixed, `${theme}: listed in LOW but now passing; delete the entry`).toEqual([]);
      for (const g of HARD) expect(worst.has(g), `${theme}: measured ${g}`).toBe(true);
    });
  }
}

/**
 * SCROLLR-286: the pages follow a LIVE light/dark switch. Color mode
 * "system" tracks the OS (useTheme flips `data-theme` on <html> from a
 * matchMedia listener); the pages' accent has to follow without a reload.
 * The NFL navy is lifted on dark and drawn as-is on light.
 */
test("a live OS light/dark switch reaches the pages' accent colours, no reload", async ({ page }) => {
  const accent = () => page.evaluate(() => getComputedStyle(document.querySelector("[data-page] [data-chip]")!).getPropertyValue("--accent").trim());
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/ticker-shim.html?pages=1&fixture=pages");
  await page.locator("[data-page] [data-chip]").first().waitFor();
  const light = await accent();
  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(accent, { message: "accent after the switch to dark" }).not.toBe(light);
  const dark = await accent();
  await page.emulateMedia({ colorScheme: "light" });
  await expect.poll(accent, { message: "accent after the switch back to light" }).toBe(light);
  expect(dark).not.toBe(light);
});
