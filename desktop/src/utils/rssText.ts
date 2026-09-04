/**
 * Text helpers for the headline chip.
 *
 * Feed descriptions arrive with HTML entities (Engadget writes `&#39;`,
 * Guardian writes `&rsquo;`) and occasionally tags. The chip renders them
 * as text, so they must be decoded, not escaped twice.
 */

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“",
  mdash: "—", ndash: "–", hellip: "…", middot: "·",
};

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => NAMED[n.toLowerCase()] ?? m);
}

/** A description as one line of plain text: tags out, entities decoded, whitespace collapsed. */
export function plainText(s: string | null | undefined): string {
  if (!s) return "";
  return decodeEntities(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

/**
 * The source as it appears in the chip's tab: uppercase, without a leading
 * "The", and if still longer than twelve characters, its first word --
 * "The Hollywood Reporter" is a 130px tab at 10px, "HOLLYWOOD" is not.
 */
export function sourceTab(name: string | null | undefined): string {
  const n = (name ?? "").trim().replace(/^the\s+/i, "");
  if (!n) return "";
  const up = n.toUpperCase();
  return up.length <= 12 ? up : up.split(/\s+/)[0];
}
