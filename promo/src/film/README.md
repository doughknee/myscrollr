# The film

`Film` (Root.tsx): one continuous shot of the bar, built from the app's own
page cells and fixtures, 1920x1080 at 30fps. Length comes from the cue sheet.

## What is where

- **The story** (`variants/story-<name>.json`, type in `film/story.ts`): which
  widgets in what order, what every title says, which catalog chips fly in,
  which palettes flip, what the end card says. A new feature to cover or a
  new angle is a new story file; the film does not change.
- **The cue sheet** (`variants/song-<name>.json`): when every set piece
  happens, in seconds of film time, named for the set pieces (`SWAPS`, one
  per widget after the first; `SCORE`; `PULL_OUT`; `HOP`; `CHIPS`;
  `LANDING_TITLE`; `THEMES`; `END`…), so the same sheet plays any story with
  the same number of swaps. A new song is a new cue sheet. The first cut's
  widget-named keys (`TO_STOCKS`, `TO_GITHUB`, `GITHUB_TITLE`, `TD`) are
  still accepted, which is what the cue marker page writes.
- **The set pieces** (`film/Film.tsx`, `film/Bar.tsx`): the opener and the
  score, the swap grammar (dwell → arm → hit), the pull-out, the hop, the
  push-in and the chip flight, the landing, the palettes, the end card, the
  camera and the pace curve. These are the film's craft; change them to
  change how every story plays.
- **The data** (`film/data.ts`): the app's fixtures the cells render.

The story's set pieces run in a fixed order: widgets[0] with its title (and
the score if the sheet has one), one swap per further widget with its title,
the pull-out to the desktop, the hop, the push-in with the chips, the last
swap as the landing, the palettes, the end card. A widget's `title` is
optional; the landing widget never gets one (the landing title is the
story's `landing`).

## Cutting it to a track

1. Put the track in `public/song/` (ignored by git).
2. Measure the window you want:
   `python3 audio/analyze.py public/song/track.wav 46.994 27 variants/features-B.json`
   prints every onset in film seconds (strength, kick/snare/hat share) and
   writes the per-frame envelopes the film breathes with.
3. Write the cue sheet in `variants/song-<name>.json` (see `song-B-synced.json`):
   every key is a second of film time, placed on an onset from step 2. Its
   `story` key names the story file next to it (`story-B.json` when unset).
4. `node mkprops.mjs variants/song-B-synced.json variants/features-B.json out/B.props.json`
   inlines the story and the features into one props file.
5. Preview: `./preview.sh out/B.props.json 14-22` (half-res, that range, ~30s).
   Full: `npx remotion render Film out/B.mp4 --props=out/B.props.json --codec=h264 --crf=17 --image-format=jpeg --pixel-format=yuv420p`

Audio is mixed in the render (`<Audio>` with a fade); no mux step.

## Changing the film without changing the picture

Render a few stills before (`./render-stills.sh 30 164 404 630 790`), make
the change, render the same frames again and diff them (`PIL.ImageChops.
difference(...).getbbox()` is `None` for an identical frame). The story
refactor was checked this way on 21 frames.

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
