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
import { Img, staticFile } from "remotion";

/**
 * Where the recording's own ticker strip ends. Beat1Hook's bar has to
 * cover at least this much or the real one peeks out beneath it.
 */
export const REAL_TICKER_BOTTOM = 86;

export function Desktop() {
  return (
    <Img
      src={staticFile("desk.png")}
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
