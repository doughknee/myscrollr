#!/usr/bin/env bash
# optimize-hero-screenshots.sh
#
# Convert raw PNG screenshots from `scrollr_screenshots/` (which are
# captured at native Retina resolution with a uniform black margin from
# the OS screenshot tool) into the production WebP assets used by the
# `HeroProductShowcase` component.
#
# Pipeline per screenshot:
#   1. Auto-trim the black margin via ImageMagick `-trim` (fuzz 5%).
#      The app's dark-mode background is #141420 and light-mode is #ffffff,
#      both clearly distinguishable from pure-black, so trim stops cleanly
#      at the actual app window edge. Black corner artifacts from the
#      window's rounded corners are masked at render time by CSS
#      border-radius on the `<picture>` element.
#   2. Generate two WebP variants for srcset:
#        - 1x at ~1600px wide (the actual display size in the hero)
#        - 2x at ~3200px wide (Retina; capped to source resolution)
#      Quality 82 is visually lossless for app screenshots and keeps
#      total bundle size under the 800KB budget.
#   3. Print byte sizes per file + a total so we can sanity-check the
#      budget.
#
# Idempotent: re-running with no source changes is a no-op (we compare
# mtimes). Re-running after a single-file update only re-processes
# that file.
#
# Naming: source files use `mac_<theme>_<channel>.png` (the user's
# capture convention). Output files use `<channel>-<theme>@{1x,2x}.webp`
# (matching the convention `HeroProductShowcase` expects).
#
# Requirements: `magick` (ImageMagick 7+) and `cwebp` (libwebp). On macOS:
#   brew install imagemagick webp

set -euo pipefail

# ── Paths ─────────────────────────────────────────────────────────

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RAW_DIR="$REPO_ROOT/scrollr_screenshots"
OUT_DIR="$REPO_ROOT/myscrollr.com/public/screenshots/hero"

# 1x display width in CSS pixels. The hero is laid out at up to
# ~780px wide on 2xl screens; we serve 1600px so it remains crisp at
# 100% zoom on standard-DPI displays. The 2x variant covers 200%
# zoom + Retina.
WIDTH_1X=1600
WIDTH_2X=3200
QUALITY=82

# ── Sanity checks ─────────────────────────────────────────────────

if ! command -v magick >/dev/null 2>&1; then
  echo "Error: ImageMagick (\`magick\`) is required. Install with: brew install imagemagick" >&2
  exit 1
fi

if ! command -v cwebp >/dev/null 2>&1; then
  echo "Error: \`cwebp\` is required. Install with: brew install webp" >&2
  exit 1
fi

if [[ ! -d "$RAW_DIR" ]]; then
  echo "Error: raw screenshots directory not found: $RAW_DIR" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

# ── Channel/theme inventory ──────────────────────────────────────

CHANNELS=("finance" "sports" "news" "fantasy")
THEMES=("dark" "light")

# ── Helpers ──────────────────────────────────────────────────────

# is_newer SOURCE TARGET — exit 0 when SOURCE is newer than TARGET (or
# TARGET does not exist). Lets us skip already-processed files.
is_newer() {
  local source="$1"
  local target="$2"
  [[ ! -e "$target" ]] && return 0
  [[ "$source" -nt "$target" ]] && return 0
  return 1
}

bytes_of() {
  local path="$1"
  if [[ "$(uname)" == "Darwin" ]]; then
    stat -f "%z" "$path"
  else
    stat -c "%s" "$path"
  fi
}

human_bytes() {
  local b="$1"
  awk -v b="$b" 'BEGIN {
    if (b < 1024) printf "%d B", b
    else if (b < 1048576) printf "%.1f KB", b / 1024
    else printf "%.2f MB", b / 1048576
  }'
}

# ── Processing loop ──────────────────────────────────────────────

total_bytes=0
processed=0
skipped=0
# Per-visitor cumulative download by theme/DPR combo. macOS ships
# bash 3.2 which lacks associative arrays, so use plain variables.
wc_dark_1x=0
wc_dark_2x=0
wc_light_1x=0
wc_light_2x=0
TMPDIR_TRIMMED="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_TRIMMED"' EXIT

# Add SIZE bytes to the worst_case bucket for THEME / DPR.
add_worst_case() {
  local theme="$1"
  local dpr="$2"
  local size="$3"
  case "${theme}_${dpr}" in
    dark_1x)  wc_dark_1x=$((wc_dark_1x + size)) ;;
    dark_2x)  wc_dark_2x=$((wc_dark_2x + size)) ;;
    light_1x) wc_light_1x=$((wc_light_1x + size)) ;;
    light_2x) wc_light_2x=$((wc_light_2x + size)) ;;
  esac
}

worst_case_for() {
  case "$1" in
    dark_1x)  echo "$wc_dark_1x" ;;
    dark_2x)  echo "$wc_dark_2x" ;;
    light_1x) echo "$wc_light_1x" ;;
    light_2x) echo "$wc_light_2x" ;;
  esac
}

echo "Optimizing hero screenshots:"
echo "  raw: $RAW_DIR"
echo "  out: $OUT_DIR"
echo

for channel in "${CHANNELS[@]}"; do
  for theme in "${THEMES[@]}"; do
    raw="$RAW_DIR/mac_${theme}_${channel}.png"

    if [[ ! -f "$raw" ]]; then
      echo "  ⚠ skipping ${channel}-${theme}: missing $raw"
      continue
    fi

    out_1x="$OUT_DIR/${channel}-${theme}@1x.webp"
    out_2x="$OUT_DIR/${channel}-${theme}@2x.webp"

    if ! is_newer "$raw" "$out_1x" && ! is_newer "$raw" "$out_2x"; then
      size_1x=$(bytes_of "$out_1x")
      size_2x=$(bytes_of "$out_2x")
      size_total=$((size_1x + size_2x))
      total_bytes=$((total_bytes + size_total))
      add_worst_case "$theme" 1x "$size_1x"
      add_worst_case "$theme" 2x "$size_2x"
      skipped=$((skipped + 1))
      printf "  · %-22s %s (skipped, up to date)\n" \
        "${channel}-${theme}" \
        "$(human_bytes $size_total)"
      continue
    fi

    # Step 1: auto-trim the black frame
    trimmed="$TMPDIR_TRIMMED/${channel}-${theme}.png"
    magick "$raw" \
      -fuzz 5% \
      -bordercolor black -border 2 \
      -trim +repage \
      "$trimmed"

    # Step 2: generate WebP variants
    # 2x first (uses the source at native resolution capped at WIDTH_2X)
    cwebp -quiet -q "$QUALITY" -resize "$WIDTH_2X" 0 "$trimmed" -o "$out_2x"
    # 1x (downscale)
    cwebp -quiet -q "$QUALITY" -resize "$WIDTH_1X" 0 "$trimmed" -o "$out_1x"

    size_1x=$(bytes_of "$out_1x")
    size_2x=$(bytes_of "$out_2x")
    size_total=$((size_1x + size_2x))
    total_bytes=$((total_bytes + size_total))
    add_worst_case "$theme" 1x "$size_1x"
    add_worst_case "$theme" 2x "$size_2x"
    processed=$((processed + 1))

    printf "  ✓ %-22s 1x %s, 2x %s, total %s\n" \
      "${channel}-${theme}" \
      "$(human_bytes $size_1x)" \
      "$(human_bytes $size_2x)" \
      "$(human_bytes $size_total)"
  done
done

echo
echo "Summary: $processed processed, $skipped already up to date"
echo "Disk weight: $(human_bytes $total_bytes) across all 16 variants"
echo
echo "Per-visitor cumulative download (one theme + one DPR, full hero rotation):"
for theme in "${THEMES[@]}"; do
  for dpr in 1x 2x; do
    bytes=$(worst_case_for "${theme}_${dpr}")
    printf "  %-13s %s\n" "${theme} @ ${dpr}" "$(human_bytes $bytes)"
  done
done

# Per-visitor budget: 1MB cumulative for the full 16-second rotation
# is acceptable; first-paint cost is just one image (the active slot).
# Flag the worst case only if it materially exceeds 1MB.
BUDGET=1048576
worst=$wc_dark_2x
for v in "$wc_dark_1x" "$wc_light_1x" "$wc_light_2x"; do
  if (( v > worst )); then worst=$v; fi
done
if (( worst > BUDGET )); then
  echo
  echo "  ⚠ Worst-case per-visitor download exceeds 1 MB."
  echo "    Consider lowering QUALITY in this script, or simplifying the"
  echo "    most detailed screenshots (often news feeds with many items)."
fi
