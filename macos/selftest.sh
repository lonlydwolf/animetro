#!/bin/sh
# Smoke test for the built app: launches it in self-test mode, which loads the home page, checks storage
# and prints a JSON report, then quits. Fails unless the home page finished loading and storage works.
# Usage: ./macos/selftest.sh [path/to/Animetro.app]   (default: build/Animetro.app)
set -e
cd "$(dirname "$0")/.."
APP="${1:-build/Animetro.app}"
OUT=$(mktemp)
ANIMETRO_SELFTEST=1 "$APP/Contents/MacOS/Animetro" > "$OUT" 2>/dev/null &
PID=$!
i=0
while kill -0 "$PID" 2>/dev/null && [ "$i" -lt 60 ]; do sleep 0.5; i=$((i + 1)); done
kill "$PID" 2>/dev/null || true
REPORT=$(grep '^{' "$OUT" | tail -1)
rm -f "$OUT"
echo "self-test: ${REPORT:-no report}"
echo "$REPORT" | grep -q '"ready":"ok"' && echo "$REPORT" | grep -q '"stored":true'
