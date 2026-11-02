/**
 * The story: what the film's set pieces are played on. A story is a JSON
 * file (variants/story-*.json); the default is story-B. A new story is a
 * new file plus a cue sheet, with no change to the film.
 *
 * The set pieces, in order, and what they take from the story:
 *   1. the opener on widgets[0] with its title (and the score, if the cue
 *      sheet has one and the widget is sports);
 *   2. one swap per widget after it, each with the dwell → arm → hit
 *      grammar, each (except the last, the landing) with its title;
 *   3. the pull-out to the desktop (`desk`), the hop (`hop`), the push-in
 *      with the catalog chips (`pick`, `chips`) flying into the band;
 *   4. the landing on the last widget (`landing`), then the palettes
 *      (`palettes`, `themes`) recolouring the frame;
 *   5. the end card (`end`).
 */
import catalog from "../../../desktop/src/catalog.snapshot.json";
import storyB from "../../variants/story-B.json";

export interface StoryTitle {
  /** The mono label over the headline, e.g. "sec 01 / markets". */
  label: string;
  /** The label's edge-segment colour; the widget's own colour when unset. */
  hex?: string;
  line1?: string;
  line2?: string;
  sub?: string;
}

export interface StoryWidget {
  /** The app's tab id, e.g. "sports_nfl"; the colour comes from the catalog. */
  tab: string;
  /** The band's code, e.g. "NFL". */
  code: string;
  kind: "sports" | "finance" | "news" | "github";
  /** The band's chip: what is happening now. */
  chip: { kind: "live" | "open" | "fresh" | "needs"; count?: number } | null;
  pages: number;
  /** The title over this widget's dwell. The landing widget has none. */
  title?: StoryTitle;
}

export interface Story {
  widgets: StoryWidget[];
  desk: StoryTitle;
  hop: StoryTitle;
  pick: StoryTitle;
  /** "Watch the bar / change." — the label and colour come from `pick` until the first palette flip. */
  landing: Pick<StoryTitle, "line1" | "line2">;
  /** From the first flip: its label, and `sub` followed by " · <palette>". */
  palettes: StoryTitle;
  /** Catalog ids of the chips that fly into the band, in landing order. */
  chips: string[];
  /** Palettes, in flip order; the last one is the end card's. */
  themes: string[];
  end: { tagline: string; line1: string; line2: string; button: string; tag?: string; url: string };
}

/** A widget as the bar draws it: the story's entry plus the catalog's colour. */
export interface FilmWidget extends StoryWidget { hex?: string }
export interface Chip { id: string; name: string; hex: string }

/** The resolved story: colours looked up, chips expanded. */
export interface Played extends Story { widgets: FilmWidget[]; flyers: Chip[] }

/**
 * Straight from the bundled catalog snapshot: `catalogItemById` needs the
 * widget renderers registered, and this project stubs those registries.
 */
const cat = (id: string) => (catalog as { widgets: { id: string; name: string; color: string }[] }).widgets.find((w) => w.id === id);

export function play(story: Story): Played {
  return {
    ...story,
    widgets: story.widgets.map((w) => ({ ...w, hex: cat(w.tab)?.color })),
    flyers: story.chips.map((id) => cat(id)).filter((x): x is NonNullable<typeof x> => Boolean(x)).map((w) => ({ id: w.id, name: w.name, hex: w.color })),
  };
}

export const STORY: Story = storyB as Story;
export const DEFAULT = play(STORY);
