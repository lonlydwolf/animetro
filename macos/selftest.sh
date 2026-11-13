#!/bin/sh
# Smoke test for the built app: launches it in self-test mode, which loads the home page, runs its checks and
# prints one line of JSON, then quits. Fails unless every check passed (see the self-test in Animetro.swift):
#   ready     the home page booted ("ok")       header     the shared header rendered
#   stored    localStorage works                 secure     the page is a secure context
#   clipboard the clipboard API is there         native     the Save-image bridge is there
#   api       AniList answers a query            card       an AniList picture draws on a share card
# api and card need the internet (AniList); the app does too, so they are not optional.
# Usage: ./macos/selftest.sh [path/to/Animetro.app]   (default: build/Animetro.app)
set -e
cd "$(dirname "$0")/.."
APP="${1:-build/Animetro.app}"
OUT=$(mktemp)
JSON=$(mktemp)
trap 'rm -f "$OUT" "$JSON"' EXIT
ANIMETRO_SELFTEST=1 "$APP/Contents/MacOS/Animetro" > "$OUT" 2>/dev/null &
PID=$!
i=0 # the checks take up to about 50 seconds when AniList is slow; give up after 90
while kill -0 "$PID" 2>/dev/null && [ "$i" -lt 180 ]; do sleep 0.5; i=$((i + 1)); done
kill "$PID" 2>/dev/null && wait "$PID" 2>/dev/null || true # a hung app is stopped, and says nothing about it
grep '^{' "$OUT" | tail -1 > "$JSON" || true
printf 'self-test: %s\n' "$(cat "$JSON")"
[ -s "$JSON" ] || { echo "self-test: FAIL (the app printed no report)"; exit 1; }

# plutil (built into macOS) reads JSON; a missing key or a non-JSON report prints nothing
get() { plutil -extract "$1" raw -o - "$JSON" 2>/dev/null || true; }
kind() { plutil -type "$1" "$JSON" 2>/dev/null || true; }
failed=""
[ "$(kind ready)" = "string" ] && [ "$(get ready)" = "ok" ] || failed="$failed ready=$(get ready)"
for check in header stored secure clipboard native api card; do # each must be the JSON value true, not "true" or 1
  [ "$(kind "$check")" = "bool" ] && [ "$(get "$check")" = "true" ] || failed="$failed $check"
done
if [ -n "$failed" ]; then
  echo "self-test: FAIL:$failed"
  exit 1
fi
echo "self-test: all checks passed"
