#!/bin/bash
# Render every variants/song-*.json to out/variants/<name>.mp4 (video + the track, in one pass).
CHROME=${CHROME:-/opt/pw-browsers/chromium-1243/chrome-linux64/chrome}
mkdir -p out/variants
for v in variants/song-*.json; do
  n=$(basename "$v" .json); n=${n#song-}
  npx remotion render Film "out/variants/$n.mp4" --props="$v" --codec=h264 --crf=17 --image-format=jpeg --jpeg-quality=92 --pixel-format=yuv420p --browser-executable="$CHROME" --log=error 2>&1 | grep -v '^\s*$' | tail -2
  ls -la "out/variants/$n.mp4"
done
