/**
 * Short team names for the ticker's sports chip.
 *
 * The chip is content-sized, so a name is the one thing that decides how
 * wide it is. Anything up to SHORT_NAME_BUDGET renders untouched. Above it,
 * the name is shortened by rules -- deterministic, no lookup service, no
 * model -- and the whole real catalog is run through them in the test so
 * every league's short names are proven unique and under budget before any
 * of this ships.
 *
 * Why rules and not a table: as of Sep 2026 exactly 113 of the 2,022 names
 * the chip can render are over budget, 91 of them NCAA. NCAA short forms
 * are AP style -- "State" to "St.", "Southern" to "S.", drop "University"
 * -- which is a rule, not knowledge. The remainder are a couple of dozen
 * well-known clubs and circuits, listed explicitly below so each one is a
 * fact that can be read and checked rather than a heuristic that can be
 * wrong. A new team that arrives later goes through the same pipeline and
 * lands within budget one way or another; the fallback is an honest cut.
 *
 * Why not the API: api-sports only supplies a code for the football host.
 * It is empty for NCAA, MLB, NBA and NHL -- exactly where "NOR" is fourteen
 * different teams -- and a three-letter code is not a short name anyway.
 */

/** Longest name rendered as-is. Sized from the catalog: 93% fit whole. */
export const SHORT_NAME_BUDGET = 20;

// ── Explicit forms ────────────────────────────────────────────────
// Every entry is a name the rules below cannot shorten well: campuses
// joined with a dash, circuits named for people, clubs whose nickname is
// two words. Keyed on the exact catalog string.
const KNOWN: Record<string, string> = {
  // AFL
  "Greater Western Sydney Giants": "GWS Giants",
  "North Melbourne Kangaroos": "Kangaroos",
  // Champions League
  "Inter Club d'Escaldes": "Inter d'Escaldes",
  "Universitatea Craiova": "Univ. Craiova",
  // Formula 1 -- the "teams" are circuits and grands prix
  "Autodromo Nazionale Monza": "Monza",
  "Autódromo Hermanos Rodríguez": "Mexico City",
  "Autódromo José Carlos Pace": "Interlagos",
  "Circuit of The Americas": "COTA",
  "Las Vegas Strip Circuit": "Las Vegas Strip",
  "Losail International Circuit": "Losail",
  "Marina Bay Street Circuit": "Marina Bay",
  // NBA / NHL -- two-word nicknames the last-word rule would split
  "Portland Trail Blazers": "Trail Blazers",
  "Columbus Blue Jackets": "Blue Jackets",
  // Starligue
  "Cesson Rennes-Metropole": "Cesson Rennes",
  // NCAA -- dashed campuses and names where the rules produce nonsense
  "Penn State-New Kensington": "PSU New Kensington",
  "Penn State Brandywine": "PSU Brandywine",
  "Pittsburgh - Greensburg": "Pitt-Greensburg",
  "Miami (OH) - Middletown": "Miami-Middletown",
  "Vermont State - Johnson": "VT State-Johnson",
  "Colorado State-Pueblo": "CSU Pueblo",
  "Wisconsin-Platteville": "UW-Platteville",
  "Wisconsin-River Falls": "UW-River Falls",
  "The College of New Jersey": "TCNJ",
  "Colorado School of Mines": "Colorado Mines",
  "Sewanee Univ. of the South": "Sewanee",
  "St. Joseph's (Brooklyn)": "St. Joseph's (Bklyn)",
};

/** Leagues where "City Nickname" is the convention and the nickname identifies. */
const US_PRO = new Set(["MLB", "NBA", "NHL", "NFL", "MLS", "AFL"]);

/**
 * Institutional noise. The "X of" forms leave a space behind; the
 * trailing-word forms take their leading space with them, so a dashed
 * name like "Washington University-St. Louis" closes up cleanly.
 */
const STRIP: [RegExp, string][] = [
  [/\bUniversity of the\s+/i, ""],
  [/\bUniversity of\s+/i, ""],
  [/\bUniv\. of the\s+/i, ""],
  [/\bCollege of\s+/i, ""],
  [/\s+University\b/i, ""],
  [/\s+College\b/i, ""],
  [/\s+Univ\.\s*/i, " "],
];

/** AP-style word abbreviations, applied left to right, one at a time. */
const ABBREV: [RegExp, string][] = [
  [/\bNorthwestern\b/, "NW"],
  [/\bNortheastern\b/, "NE"],
  [/\bSouthwestern\b/, "SW"],
  [/\bSoutheastern\b/, "SE"],
  [/\bNorthwest\b/, "NW"],
  [/\bNortheast\b/, "NE"],
  [/\bSouthwest\b/, "SW"],
  [/\bSoutheast\b/, "SE"],
  [/\bNorthern\b/, "N."],
  [/\bSouthern\b/, "S."],
  [/\bEastern\b/, "E."],
  [/\bWestern\b/, "W."],
  [/\bCentral\b/, "C."],
  [/\bNorth\b/, "N."],
  [/\bSouth\b/, "S."],
  [/\bEast\b/, "E."],
  [/\bWest\b/, "W."],
  [/\bInternational\b/, "Intl."],
  [/\bMississippi\b/, "Miss."],
  [/\bTennessee\b/, "Tenn."],
  [/\bConnecticut\b/, "Conn."],
  [/\bPennsylvania\b/, "Penn."],
  [/\bLouisiana\b/, "La."],
  [/\bOklahoma\b/, "Okla."],
  [/\bWashington\b/, "Wash."],
  [/\bCalifornia\b/, "Cal."],
  [/\bMinnesota\b/, "Minn."],
  [/\bMissouri\b/, "Mo."],
  [/\bMassachusetts\b/, "Mass."],
  [/\bChristian\b/, "Chr."],
  [/\bTechnology\b/, "Tech"],
  [/\bInstitute\b/, "Inst."],
  [/\bMount\b/, "Mt."],
  [/\bFort\b/, "Ft."],
  [/\bSaint\b/, "St."],
  [/\bState\b/, "St."],
  [/\bGrand Prix\b/, "GP"],
];

/** Club suffixes that carry no identity once space is tight. */
const CLUB_SUFFIX = /\s+(FC|SC|CF|AFC|BC|HC)$/;

const tidy = (s: string) => s.replace(/\s+/g, " ").trim();

/** Drop words from the end until it fits. Never below one word. */
function dropTrailing(s: string): string {
  const words = s.split(" ");
  while (words.length > 1 && words.join(" ").length > SHORT_NAME_BUDGET) words.pop();
  return words.join(" ");
}

/** Drop words from the front until it fits. Never below one word. */
function dropLeading(s: string): string {
  const words = s.split(" ");
  while (words.length > 1 && words.join(" ").length > SHORT_NAME_BUDGET) words.shift();
  return words.join(" ");
}

/**
 * The institution behind a name, with the institutional words removed --
 * so "West Virginia" and "West Virginia University" key the same. The
 * catalog carries some schools under both spellings; those are one team,
 * and rendering them alike is right. Exported for the uniqueness test.
 */
export function institutionKey(name: string): string {
  let s = tidy(name);
  for (const [re, to] of STRIP) s = tidy(s.replace(re, to));
  return s.toLowerCase();
}

/**
 * The name the chip renders. Identity to `name` whenever it already fits.
 */
export function teamShortName(league: string, name: string): string {
  const full = name.trim();
  if (full.length <= SHORT_NAME_BUDGET) return full;

  const known = KNOWN[full];
  if (known) return known;

  let s = tidy(full);

  if (league === "UFC") {
    // A fighter is their surname. Drop given names from the front.
    return dropLeading(s);
  }

  if (league === "Formula 1") {
    s = tidy(
      s.replace(/\bGrand Prix\b/, "GP").replace(/\b(Aut[oó]dromo|Circuit|International|Street)\b/g, ""),
    );
    return s.length <= SHORT_NAME_BUDGET ? s : dropTrailing(s);
  }

  if (US_PRO.has(league)) {
    // "City Nickname": the nickname is the half people say, and the last
    // word is the nickname for every club on the books today. Two-word
    // nicknames that would split are in KNOWN above.
    s = tidy(s.replace(CLUB_SUFFIX, ""));
    if (s.length <= SHORT_NAME_BUDGET) return s;
    const words = s.split(" ");
    return words[words.length - 1];
  }

  // Everything else -- NCAA above all -- is an institution. Shed the
  // institutional words, then abbreviate AP-style until it fits, then
  // give up words from the end.
  s = tidy(s.replace(CLUB_SUFFIX, ""));
  for (const [re, to] of STRIP) {
    if (s.length <= SHORT_NAME_BUDGET) break;
    s = tidy(s.replace(re, to));
  }
  for (const [re, to] of ABBREV) {
    if (s.length <= SHORT_NAME_BUDGET) break;
    s = tidy(s.replace(re, to));
  }
  if (s.length <= SHORT_NAME_BUDGET) return s;

  // Keep a state qualifier -- "(KY)" -- as the disambiguator it is, and
  // drop words in front of it instead.
  const paren = s.match(/\s*\([^)]*\)\s*$/);
  if (paren) {
    const head = dropTrailing(s.slice(0, paren.index).trim());
    const withParen = `${head} ${paren[0].trim()}`;
    return withParen.length <= SHORT_NAME_BUDGET ? withParen : head;
  }
  return dropTrailing(s);
}
