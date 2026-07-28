#!/bin/sh
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
MEDIA_ROOT="${MEDIA_ROOT:-"$ROOT/../配音比賽官網"}"
OUTPUT="$ROOT/firebase-public"
STAGING="$(mktemp -d "${TMPDIR:-/tmp}/sggs-firebase.XXXXXX")"

cleanup() {
  find "$STAGING" -depth -delete
}
trap cleanup EXIT HUP INT TERM

for file in \
  index.html \
  portal.html \
  config.js \
  qa.js \
  qa.css \
  platform-bridge.js \
  platform-bridge.css \
  portal.js \
  portal.css \
  radar-chart.js \
  robots.txt
do
  test -f "$ROOT/$file"
  cp -p "$ROOT/$file" "$STAGING/$file"
done

mkdir -p "$STAGING/data" "$STAGING/assets" "$STAGING/media" "$OUTPUT"
cp -p "$ROOT"/data/*.json "$STAGING/data/"
cp -p "$MEDIA_ROOT"/assets/*.jpg "$STAGING/assets/"
cp -p "$MEDIA_ROOT"/media/*.mp4 "$STAGING/media/"
rsync -a --delete "$STAGING/" "$OUTPUT/"

printf 'Firebase public directory ready: %s\n' "$OUTPUT"
