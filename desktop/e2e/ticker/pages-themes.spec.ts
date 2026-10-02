import { test, expect, type Page } from "@playwright/test";
import { THEME_FAMILIES } from "../../src/preferences";
import { parkMouse } from "./pages";

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
 * bar, plus the label's tint where it sits on the label, a close game's
 * tint, and the element's own opacity (`@dim`). Layers are composited by a
 * 1x1 canvas, so any CSS colour the palette uses (oklch, color-mix) is
 * resolved by the browser itself. Text is grouped by the palette token it is
 * painted in (fg, fg-2, fg-3, fg-4, up, down, live) or as the widget's
 * colour (`accent`: `--accent` or its text form `--accent-ink`), because
 * that is where a fix goes: a cell picks a token, a palette defines it.
 *
 * Floors (WCAG): text 4.5:1; large text (>= 24 px, or >= 18.66 px bold) 3:1;
 * the hairline between columns 1.5:1 (it separates, it does not carry
 * information).
 *
 * ASSERTED in every theme, every reading (SCROLLR-287 emptied the table of
 * known misses): fg, fg-2 and fg-3 text, finals, the up/down change and the
 * live clock at 4.5; the label's name at 3; small text in the widget's
 * colour at 4.5; every hairline at 1.5. SCROLLR-290 adds the weather alert
 * (the amber `warning` text on the edge, 4.5; the shim's `weather=alert` is
 * one alerted city, alone so the slot never rotates away) and the empty bar's EMPTY label (3, it is large). A theme that misses fails and names
 * the group, the ratio and the text, so the fix lands in the palette token
 * or the cell rule that painted it.
 */

const TEXT_FLOOR = 4.5;
const LARGE_FLOOR = 3;
const RULE_FLOOR = 1.5;

/** Groups every theme must have measured, so a pass is never vacuous. */
const MEASURED = ["fg", "fg-2", "fg-3", "label-name", "accent", "rule", "warning", "empty-label", "pill"];
/** Parts every theme must have measured: the up/down change, the game clock (live, in the live colour) and the band's chip count (SCROLLR-303). */
const PARTS = ["change", "status", "chip"];

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
        // The band's lit pill fills in the ink over its pill (SCROLLR-303): a graphic, 3:1 against what is behind it.
        if (el.matches("[data-band] [data-lit] > span")) {
          const { bg } = stack(el.parentElement!, root);
          out.push({ group: "pill", role: "pill", text: el.closest("[data-label]")?.getAttribute("data-label") ?? "", ratio: ratio(paint([...bg, { color: cs.backgroundColor, alpha: 1 }]), paint(bg)), floor: cfg.large });
          continue;
        }
        if (cs.visibility === "hidden" || el.closest("[aria-hidden=true]:not(.w-px)") && !el.matches(".w-px")) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const { bg, opacity } = stack(el, root);
        if (el.matches("span.w-px")) {
          const rule = paint([...bg, { color: cs.backgroundColor, alpha: opacity }]);
          // Name the rule by where it is, so a miss says which widget's colour.
          const where = el.closest("[data-widget], [data-bar], [data-strip]");
          const text = where ? [...where.attributes].filter((a) => /^data-(widget|bar|strip)$/.test(a.name)).map((a) => a.value).join("") : "";
          out.push({ group: "rule", role: el.closest("[data-part]")?.getAttribute("data-part") ?? "rule", text, ratio: ratio(rule, paint(bg)), floor: cfg.rule });
          continue;
        }
        const own = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent!.trim()).map((n) => n.textContent!.trim()).join(" ");
        // A weather icon is a coloured emoji picture: the OS paints it, the CSS colour is not what you see.
        if (!own || /^\p{Emoji_Presentation}+$/u.test(own)) continue;
        const px = parseFloat(cs.fontSize);
        const large = px >= 24 || (px >= 18.66 && Number(cs.fontWeight) >= 700);
        const part = el.closest("[data-part]")?.getAttribute("data-part") ?? (el.closest("[data-label]") ? (large ? "label-name" : "label-sub") : "text");
        // Which token is it? Compare the colour at full strength with each token.
        const solid = paint([{ color: cs.color, alpha: 1 }]);
        const is = (prop: string) => {
          const v = cs.getPropertyValue(prop).trim();
          return !!v && same(solid, paint([{ color: v, alpha: 1 }]));
        };
        const token = ["fg", "fg-2", "fg-3", "fg-4", "up", "down", "live", "warning"].find((t) => is(`--color-${t}`));
        const group = part === "label-name" ? "label-name" : token ?? (is("--accent") || is("--accent-ink") ? "accent" : `other:${part}`);
        out.push({
          // Text drawn at reduced opacity is its own group.
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
  // The pointer off the bar: a hovered band shows its keypad and the chip steps aside (SCROLLR-303).
  await parkMouse(page);
  await page.goto(url);
  await parkMouse(page);
  await page.locator(ready).first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  // Colours are measured at rest: a theme applied after first paint transitions, and a mid-fade reading is not the palette's.
  await page.waitForTimeout(100);
  await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a instanceof CSSTransition).map((a) => a.finished.catch(() => {}))));
  await page.evaluate(installContrast, { text: TEXT_FLOOR, large: LARGE_FLOOR, rule: RULE_FLOOR });
  return page.evaluate((root) => window.__contrast(root), root);
}

test.use({ viewport: { width: 1920, height: 1100 } });

for (const family of THEME_FAMILIES) {
  for (const mode of ["dark", "light"] as const) {
    const theme = `${family}-${mode}`;
    test(`${theme}: label, cell text and rules clear their contrast floor`, async ({ page }) => {
      // The edge zone carries a weather alert (the shim's `weather=alert` city, alone so the slot holds still), in the warning colour.
      let bar = await readings(page, `/ticker-shim.html?pages=1&fixture=pages&utils=clock,weather&weather=alert&theme=${theme}`, ".ticker-container", "[data-page] [data-chip]");
      // The edge slot can be a beat behind the page's cells (slower on CI): read again until the alert is in.
      for (let i = 0; i < 20 && !bar.some((r) => r.group === "warning"); i++) {
        await page.waitForTimeout(250);
        bar = await page.evaluate((root) => window.__contrast(root), ".ticker-container");
      }
      // SCROLLR-290: the empty bar's label (nothing installed, and everything off).
      const empty = [
        ...(await readings(page, `/ticker-shim.html?pages=1&fixture=empty&utils=&theme=${theme}`, "[data-label=empty]", "[data-label=empty]")),
        ...(await readings(page, `/ticker-shim.html?pages=1&fixture=off&utils=&theme=${theme}`, "[data-label=empty]", "[data-label=empty]")),
      ].map((r) => (r.group === "label-name" ? { ...r, group: "empty-label" } : r));
      const gallery = await readings(page, `/ticker-shim.html?cells=1&theme=${theme}`, "[data-bar], [data-strip]", "[data-bar] [data-chip]");
      const all = [...bar, ...gallery, ...empty];
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

      const missed = rows.filter(([, r]) => r.ratio < r.floor);
      expect(missed.map(([g, r]) => `${g} ${r.ratio.toFixed(2)} < ${r.floor} ("${r.text}", ${r.role})`), `${theme}: below the floor`).toEqual([]);
      for (const g of MEASURED) expect(worst.has(g), `${theme}: measured ${g}`).toBe(true);
      for (const p of PARTS) expect(all.some((r) => r.role === p), `${theme}: measured ${p}`).toBe(true);
      expect(all.some((r) => r.text === "FINAL"), `${theme}: measured a final game`).toBe(true);
    });
  }
}

/**
 * SCROLLR-312: the GitHub page in every palette, github.board.json's four
 * repos on one page (1920), each cell's two lines (canvas C4 · D): the name,
 * the status in every tone (red failed, the ink running, fg-2 all green), the
 * tag, what needs you, who, and the band's count. Every reading at its floor
 * against what is really behind it.
 */
for (const family of THEME_FAMILIES) {
  for (const mode of ["dark", "light"] as const) {
    const theme = `${family}-${mode}`;
    test(`${theme}: the github page's two lines and band chip clear 4.5:1`, async ({ page }) => {
      const all = await readings(page, `/ticker-shim.html?pages=1&fixture=github&utils=&theme=${theme}`, ".ticker-container", "[data-page] [data-chip]");
      const tones = await page.locator("[data-page] [data-part=status]").evaluateAll((els) => els.map((e) => e.getAttribute("data-tone")));
      expect(["red", "accent", "dim"].filter((k) => !tones.includes(k)), `${theme}: every status tone drawn`).toEqual([]);
      expect(await page.locator("[data-page] [data-chip]").count(), `${theme}: four repos on one page`).toBe(4);
      for (const role of ["title", "status", "tag", "what", "who", "chip"]) expect(all.some((r) => r.role === role), `${theme}: measured ${role}`).toBe(true);
      const missed = all.filter((r) => r.ratio < r.floor);
      const key = (r: (typeof all)[number]) => `${r.role}@${r.floor}`;
      console.log(`[${theme} github] worst ${[...new Set(all.map(key))].map((k) => `${k} ${Math.min(...all.filter((r) => key(r) === k).map((r) => r.ratio)).toFixed(2)}`).join("  ")}`);
      expect(missed.map((r) => `${r.role} ${r.ratio.toFixed(2)} < ${r.floor} ("${r.text}", ${r.group})`), `${theme}: below the floor`).toEqual([]);
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
