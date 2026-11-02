# The film

`Film` (Root.tsx): one continuous shot of the bar, built from the app's own
page cells and fixtures, 1920x1080 at 30fps. Length comes from the cue sheet.

## Cutting it to a track

1. Put the track in `public/song/` (ignored by git).
2. Measure the window you want:
   `python3 audio/analyze.py public/song/track.wav 46.994 27 variants/features-B.json`
   prints every onset in film seconds (strength, kick/snare/hat share) and
   writes the per-frame envelopes the film breathes with.
3. Write the cue sheet in `variants/song-<name>.json` (see `song-B-synced.json`):
   every key is a second of film time, placed on an onset from step 2.
4. `node mkprops.mjs variants/song-B-synced.json variants/features-B.json out/B.props.json`
5. Preview: `./preview.sh out/B.props.json 14-22` (half-res, that range, ~30s).
   Full: `npx remotion render Film out/B.mp4 --props=out/B.props.json --codec=h264 --crf=17 --image-format=jpeg --pixel-format=yuv420p`

Audio is mixed in the render (`<Audio>` with a fade); no mux step.

## Setup once per clone

```sh
cd promo
cp -r ../desktop/public/fonts public/fonts && cp -r public/fonts fonts && cp -r public/fonts-archivo fonts-archivo
```

`public/logos` are the api-sports crests for the eight teams on the NFL page,
captured once so a render needs no network. `public/shots` are two of the
marketing captures from `myscrollr.com/screenshot-sources`.

## The other cuts

- `FilmPortrait` (1080x1920): same cue sheet and track, the camera closer and the titles stacked. `npx remotion render FilmPortrait out/B-9x16.mp4 --props=out/B.props.json ...`
- `HeroLoop` (1920x640, 10.86s, silent, seamless): NFL with the score, the swap to stocks, the swap back on the last frame. For the site's hero: `npx remotion render HeroLoop out/hero-loop.mp4 ...`, then `ffmpeg -i out/hero-loop.mp4 -c:v libvpx-vp9 -b:v 0 -crf 30 -an out/hero-loop.webm` and a poster from frame 60.
