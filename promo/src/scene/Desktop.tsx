/**
 * The screen. A REAL one.
 *
 * This used to be a hand-built fake — CSS wallpaper gradients, an
 * invented spreadsheet, a drawn menu bar. It was a large amount of work
 * to produce something that still read as a mockup, and the site's own
 * homepage says "This is the app. Not a mockup." — so the film was
 * contradicting the pitch.
 *
 * public/desk.png is a frame lifted straight out of a screen recording
 * of Scrollr running on the owner's machine: real Windows 11, real
 * wallpaper, real taskbar, and the real Scrollr window open on the Yahoo
 * Fantasy dashboard. Everything the fake was trying to imply is simply
 * true here.
 *
 * WHAT THE COMPOSITION DOES WITH IT: the recording already has Scrollr's
 * ticker along the top edge, showing a frozen moment. The beat needs a
 * ticker whose score it can drive, so Beat1Hook covers that strip with
 * its own bar of real chips at the same position. Everything below the
 * strip — wallpaper, app window, taskbar — is the untouched photograph.
 *
 * Regenerate with:
 *   npx remotion ffmpeg -y -ss 3 -i <recording>.mp4 \
 *     -frames:v 1 -update 1 public/desk.png
 */
import { Img, OffthreadVideo, staticFile } from "remotion";

/**
 * Where the recording's own ticker strip ends. Beat1Hook's bar has to
 * cover at least this much or the real one peeks out beneath it.
 */
export const REAL_TICKER_BOTTOM = 82;

/**
 * `file` lets the composition cross-dissolve between views pulled from
 * the same recording — Overview, Matchup, Roster — so the back half
 * shows what the app actually does rather than holding on one shot.
 */
/**
 * A CLIP, not a still.
 *
 * The recording's own page transitions — tabs sliding, the ticker
 * preview repopulating as the dial changes — were being thrown away by
 * extracting single frames. Remotion renders video perfectly well; using
 * stills was a choice I made early and never revisited, not a limit of
 * the tool.
 *
 * `startFrom` is in frames of the SOURCE clip, so a section can pick its
 * own window without re-encoding.
 */
export function DesktopClip({
  file,
  startFrom = 0,
}: {
  file: string;
  startFrom?: number;
}) {
  return (
    <OffthreadVideo
      src={staticFile(file)}
      startFrom={startFrom}
      // The film controls its own timeline; the clip must not advance on
      // its own or loop back while a beat is holding on it.
      playbackRate={1}
      muted
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        objectFit: "cover",
      }}
    />
  );
}

export function Desktop({ file = "desk.png" }: { file?: string }) {
  return (
    <Img
      src={staticFile(file)}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        objectFit: "cover",
      }}
    />
  );
}
