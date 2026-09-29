// Resolves once the bundled fonts (public/fonts, @font-face in style.css) are
// decoded, so the first render measures with final metrics (SCROLLR-254).
// `document.fonts.ready` alone is not enough: a face is fetched lazily on
// first use, and before anything is on screen nothing has used it, so ready
// resolves at once. Ask for each face explicitly. The files are local, so this
// is milliseconds; the timeout only guards a webview that never answers, and
// never rejects, so a font problem costs a reflow, not a blank bar.
const FACES = [
  "400 12px \"IBM Plex Mono\"",
  "500 12px \"IBM Plex Mono\"",
  "600 12px \"IBM Plex Mono\"",
  "400 12px \"Plus Jakarta Sans\"",
];

export function fontsReady(timeoutMs = 1500): Promise<void> {
  if (!document.fonts) return Promise.resolve();
  const loaded = Promise.all(FACES.map((f) => document.fonts.load(f)));
  const timeout = new Promise<void>((r) => setTimeout(r, timeoutMs));
  return Promise.race([loaded, timeout]).then(
    () => undefined,
    () => undefined,
  );
}
