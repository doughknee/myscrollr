# The film

`Film` (Root.tsx): 18.5s, 1920x1080, 30fps. One continuous shot of the bar,
built from the app's own page cells and fixtures. See the header of Film.tsx
for the beat grid; `audio/music.py` writes the bed to the same grid.

Setup once per clone (webpack resolves the app's `url("/fonts/…")` against
`promo/`, and the end card and desktop use assets kept elsewhere in the repo):

```sh
cd promo
cp -r ../desktop/public/fonts public/fonts && cp -r public/fonts fonts && cp -r public/fonts-archivo fonts-archivo
python3 audio/music.py
npx remotion render Film out/film-video.mp4 --codec=h264 --crf=17 --image-format=jpeg --pixel-format=yuv420p
ffmpeg -i out/film-video.mp4 -i audio/bed.wav -map 0:v -map 1:a -c:v copy -af loudnorm=I=-15:TP=-1.5:LRA=9 -c:a aac out/scrollr-film-1080p.mp4
```

`public/logos` are the api-sports crests for the eight teams on the NFL page,
captured once so a render needs no network. `public/shots` are two of the
marketing captures from `myscrollr.com/screenshot-sources/darkmode`.
