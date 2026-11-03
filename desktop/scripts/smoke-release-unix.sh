#!/usr/bin/env bash
# CI only: launch the final packaged bytes, never the development executable.
set -euo pipefail
test "${GITHUB_ACTIONS:-}" = true
cd "$(dirname "$0")/.."
mkdir -p package-smoke
work=$(mktemp -d)
pid=''
mount=''
cleanup() {
  if [ -n "$pid" ]; then kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; fi
  if [ -n "$mount" ]; then hdiutil detach "$mount" >/dev/null || true; fi
}
trap cleanup EXIT
if [ "$(uname)" = Darwin ]; then
  dmg=$(find src-tauri/target/release/bundle/dmg -name '*.dmg' -print -quit)
  test -n "$dmg"
  mount="$work/mount"
  hdiutil attach "$dmg" -readonly -nobrowse -mountpoint "$mount"
  app=$(find "$mount" -maxdepth 1 -name '*.app' -print -quit)
  test -n "$app"
  ditto "$app" "$work/Scrollr.app"
  app="$work/Scrollr.app"
  codesign --verify --deep --strict "$app"
  spctl --assess --type execute --verbose=2 "$app"
  exe=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$app/Contents/Info.plist")
  "$app/Contents/MacOS/$exe" >package-smoke/launch.log 2>&1 &
  pid=$!
else
  image=$(find src-tauri/target/release/bundle/appimage -name '*.AppImage' -print -quit)
  test -n "$image"
  image=$(realpath "$image")
  (cd "$work"; "$image" --appimage-extract >/dev/null)
  # XDG paths isolate test preferences from other CI tools.
  export XDG_CONFIG_HOME="$work/config" XDG_DATA_HOME="$work/data" XDG_CACHE_HOME="$work/cache"
  "$work/squashfs-root/AppRun" >package-smoke/launch.log 2>&1 &
  pid=$!
fi
# Catch startup crashes and delayed webview initialization failures.
for _ in {1..30}; do
  sleep 1
  kill -0 "$pid" 2>/dev/null || { cat package-smoke/launch.log; exit 1; }
done
if [ "$(uname)" != Darwin ]; then
  xdotool search --onlyvisible --name '^Scrollr' >package-smoke/windows.txt
  scrot package-smoke/desktop.png
fi
printf 'Packaged launch survived 30 seconds on %s; not a physical-display or updater-transport test.\n' "$(uname -sm)" | tee package-smoke/result.txt
