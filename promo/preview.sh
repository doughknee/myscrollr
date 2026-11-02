#!/bin/bash
# Fast proxy: ./preview.sh variants/song-B-synced.json [startSec-endSec]
# Half-res, light JPEG, optional second range. ~20-40s instead of ~3min.
CHROME=${CHROME:-/opt/pw-browsers/chromium-1243/chrome-linux64/chrome}
v=$1; range=$2; n=$(basename "$v" .json); n=${n%.props}
args=()
if [ -n "$range" ]; then a=${range%-*}; b=${range#*-}; args+=(--frames=$(( ${a%.*} * 30 ))-$(( ${b%.*} * 30 ))); fi
mkdir -p out/preview
npx remotion render Film "out/preview/$n.mp4" --props="$v" --scale=0.5 --codec=h264 --crf=24 --image-format=jpeg --jpeg-quality=70 --pixel-format=yuv420p "${args[@]}" --browser-executable="$CHROME" --log=error 2>&1 | grep -v '^\s*$' | tail -2
ls -la "out/preview/$n.mp4"
