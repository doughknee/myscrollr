/**
 * The sports chip's width contract.
 *
 * The chip is content-sized: as wide as the fixture needs, no wider. That
 * is only safe if nothing changes width while the chip is on screen, so
 * every slot that CAN change -- the score, the clock, the record row --
 * holds its widest plausible width from first render. The widths are per
 * league, sized to the widest thing that league can actually produce: an
 * MLB division has five teams, so rank never needs a fourth character; an
 * NCAA record never runs past "12-1"; a points total is three digits.
 *
 * Names, crests and the league code are fixed for the life of the fixture
 * and are the width that is allowed to vary, once.
 */
import type { TeamStanding } from "../types";

export interface ChipReservation {
  /** Characters reserved for a score. Three for sports that reach 100. */
  score: number;
  /** Characters reserved for the status text, beside its always-present dot. */
  status: number;
  /** "10th" needs four; a division of five never does. */
  rank: number;
  /** "100-62" is seven; "30-10-10" is eight; "12-1" is four. */
  record: number;
  /** "−201" is four; a points total "100" is three. */
  metric: number;
  /** Draws are part of the record (soccer), not an oddity (NFL ties). */
  draws: boolean;
  /** What the third number is: point/run differential, or table points. */
  metricKind: "diff" | "pts";
  /** Its unit label. */
  unit: string;
}

const DEFAULT: ChipReservation = {
  score: 2, status: 7, rank: 4, record: 8, metric: 4, draws: false, metricKind: "diff", unit: "PD",
};

const SOCCER: ChipReservation = {
  score: 2, status: 7, rank: 4, record: 8, metric: 3, draws: true, metricKind: "pts", unit: "PTS",
};

const BY_LEAGUE: Record<string, ChipReservation> = {
  MLB: { ...DEFAULT, rank: 3, record: 7, unit: "RD" },
  NFL: { ...DEFAULT, rank: 3, record: 6 },
  NBA: { ...DEFAULT, score: 3, record: 5 },
  NHL: { ...DEFAULT, rank: 3, record: 7, metric: 3, metricKind: "pts", unit: "PTS" },
  "NCAA Football": { ...DEFAULT, record: 4 },
  "NCAA Basketball": { ...DEFAULT, score: 3, record: 5 },
  AFL: { ...DEFAULT, score: 3, record: 6 },
  "La Liga": SOCCER,
  "Premier League": SOCCER,
  "Champions League": SOCCER,
  "FIFA World Cup": SOCCER,
  MLS: SOCCER,
};

export function reservationFor(league: string): ChipReservation {
  return BY_LEAGUE[league] ?? DEFAULT;
}

/** 1 → "1st", 11 → "11th", 22 → "22nd". */
export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

/** "27-5-6" for a draws league, "82-56" otherwise, with ties or OTL appended only when present. */
export function recordText(s: TeamStanding, r: ChipReservation): string {
  if (r.draws) return `${s.wins}-${s.draws}-${s.losses}`;
  let t = `${s.wins}-${s.losses}`;
  if (s.draws > 0) t += `-${s.draws}`;
  if (s.otl > 0) t += `-${s.otl}`;
  return t;
}

export interface MetricText {
  text: string;
  tone: "pos" | "neg" | "zero";
}

/**
 * The third number: run/point differential for US leagues, table points for
 * the rest. Falls through to whichever the row actually carries, so an NHL
 * row with points and no differential still says something.
 */
export function metricText(s: TeamStanding, r: ChipReservation): MetricText | null {
  const hasDiff = s.points_for !== 0 || s.points_against !== 0;
  const hasPts = s.points !== 0;
  const kind = r.metricKind === "diff" ? (hasDiff ? "diff" : hasPts ? "pts" : null) : hasPts ? "pts" : hasDiff ? "diff" : null;
  if (kind === "diff") {
    const d = s.points_for - s.points_against;
    return { text: d > 0 ? `+${d}` : d < 0 ? `−${-d}` : "0", tone: d > 0 ? "pos" : d < 0 ? "neg" : "zero" };
  }
  if (kind === "pts") {
    return { text: String(s.points), tone: s.points > 0 ? "pos" : "zero" };
  }
  return null;
}
