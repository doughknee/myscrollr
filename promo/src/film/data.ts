/**
 * The film's data: the app's own dev fixtures, so every score, price and
 * headline on screen is a shape the real cells already render in tests.
 * What the film says and in what order is the story (story.ts).
 * Team crests come from the same CDN the app uses, captured once into
 * public/logos so a render needs no network.
 */
import { staticFile } from "remotion";
import type { Game, RssItem, Trade, GitHubChipData } from "../../../desktop/src/types";
import type { GitHubBoardRepo } from "../../../desktop/src/api/client";
import { repoChip } from "../../../desktop/src/widgets/github/types";
import pages from "../../../desktop/src/dev/__fixtures__/dashboard.pages.json";
import gh from "../../../desktop/src/dev/__fixtures__/github.board.json";

export const NOW = Date.parse(pages._captured_at);
const data = pages.data as unknown as { sports: Game[]; finance: Trade[]; rss: RssItem[] };

const localLogo = (url: string) => staticFile(`logos/${url.split("/").pop()}`);
const byId = (id: number) => {
  const g = data.sports.find((x) => Number(x.id) === id)!;
  return { ...g, home_team_logo: localLogo(g.home_team_logo), away_team_logo: localLogo(g.away_team_logo) };
};

/** Page 1 of NFL as the app ranks it: your team first, then the live games by kickoff. */
export const NFL: Game[] = [byId(11015197), byId(11015203), byId(11015196), byId(11015201)];
export const FAVOURITE = "Chicago Bears";

/** The Bears, 20-24 with 2:14 left, score. That is the film's one event. */
export function nflAt(scored: boolean): Game[] {
  if (!scored) return NFL;
  const [bears, ...rest] = NFL;
  return [{ ...bears, home_team_score: "27", short_detail: "Q4 2:07" }, ...rest];
}

export const STOCKS: Trade[] = ["AAPL", "NVDA", "TSLA", "MSFT"].map((s) => data.finance.find((t) => t.symbol === s)!);
export const BBC: RssItem[] = data.rss.filter((r) => r.source_name.startsWith("BBC"));

const repos = gh.repos as unknown as GitHubBoardRepo[];
export const GITHUB: GitHubChipData[] = [0, 1, 3].map((i) => repoChip(repos[i], gh.config[i] as never, false, Date.parse(gh._captured_at)));
