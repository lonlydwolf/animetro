#!/bin/sh
# Runs the Mac app against the files in web/ instead of its bundled copy:
# edit any HTML/CSS/JS, press Cmd+R in the app, see the change. Right-click > Inspect Element for dev tools.
# Rebuilds first only if the app or its Swift code changed.
set -e
cd "$(dirname "$0")/.."
[ -x build/Animetro.app/Contents/MacOS/Animetro ] && [ build/Animetro.app -nt macos/Animetro.swift ] || ./macos/build.sh
ANIMETRO_WEB="$PWD/web" exec build/Animetro.app/Contents/MacOS/Animetro
