/**
 * Render the same chips once per dark theme, for splicing into a
 * montage.
 *
 * Ten files, identical in every respect except the palette — same
 * leagues, same scores, same play landing on the same frame — so a cut
 * between any two reads as the skin changing and nothing else.
 *
 *   npm run render:themes              # all ten
 *   node scripts/render-themes.mjs nord-dark dracula-dark
 *
 * The theme list is read out of `src/promo-chips/themes.ts` by regex
 * rather than imported. Importing a .ts from a plain .mjs needs
 * --experimental-strip-types, which is a bad thing to hide inside an
 * npm script; duplicating the list here would be worse. This keeps one
 * source of truth and no build step.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";

const themesSrc = readFileSync("src/promo-chips/themes.ts", "utf8");
const DARK_THEMES = [
  ...themesSrc
    .slice(themesSrc.indexOf("DARK_THEMES"))
    .matchAll(/"([a-z-]+-dark)"/g),
].map((m) => m[1]);

if (DARK_THEMES.length === 0) {
  console.error("Could not read any themes from src/promo-chips/themes.ts");
  process.exit(1);
}

/**
 * Guard: every `[data-theme="*-dark"]` the app defines must be in the
 * list. Add a theme to the product and this fails loudly instead of
 * quietly shipping a montage that is missing one.
 *
 * `scrollr-dark` is deliberately exempt — it has no block of its own
 * because it IS the `@theme` default.
 */
const css = readFileSync("../desktop/src/style.css", "utf8");
const inCss = new Set(
  [...css.matchAll(/\[data-theme="([a-z-]+-dark)"\]/g)].map((m) => m[1]),
);
const missing = [...inCss].filter((t) => !DARK_THEMES.includes(t));
if (missing.length) {
  console.error(
    `These dark themes exist in the app but not in themes.ts:\n  ${missing.join("\n  ")}`,
  );
  process.exit(1);
}

const OUT = "out/themes";
const TMP = "out/.theme-props.json";

const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const themes = only.length
  ? DARK_THEMES.filter((t) => only.includes(t))
  : DARK_THEMES;

if (themes.length === 0) {
  console.error(`No theme matched. Known:\n  ${DARK_THEMES.join("\n  ")}`);
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });

themes.forEach((theme, i) => {
  console.log(`\n[${i + 1}/${themes.length}] ${theme}`);
  writeFileSync(TMP, JSON.stringify({ theme }));
  execFileSync(
    "npx",
    [
      "remotion",
      "render",
      "ThemeRail",
      `${OUT}/${theme}.mov`,
      "--codec=prores",
      "--prores-profile=4444",
      `--props=${TMP}`,
    ],
    { stdio: "inherit", shell: true },
  );
});

rmSync(TMP, { force: true });
console.log(`\nDone — ${themes.length} clips in ${OUT}/`);
