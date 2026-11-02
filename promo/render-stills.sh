#!/bin/bash
# usage: ./render-stills.sh 30 50 100
CHROME=/opt/pw-browsers/chromium-1243/chrome-linux64/chrome
for f in "$@"; do npx remotion still Film out/stills/f$(printf %03d $f).png --frame=$f --props=${PROPS:-out/B.props.json} --browser-executable=$CHROME --log=error 2>&1 | grep -v '^\s*$' | tail -5; done
