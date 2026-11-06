#!/bin/sh
# Builds Animetro.app (a native macOS window around the web app; no server needed).
# Needs Xcode or the Command Line Tools (`xcode-select --install`).
#   ./mac/build.sh             -> build/Animetro.app
#   ./mac/build.sh --install   -> also copies it to /Applications
set -e
cd "$(dirname "$0")/.."
APP=build/Animetro.app
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/web"
cp -R ./*.html favicon.svg css js "$APP/Contents/Resources/web/"
cp mac/Info.plist "$APP/Contents/"
cp mac/Animetro.icns "$APP/Contents/Resources/"
swiftc -O mac/Animetro.swift -o "$APP/Contents/MacOS/Animetro"
codesign --force --sign - "$APP" >/dev/null 2>&1   # ad-hoc signature so macOS will open a locally built app
echo "Built $APP"
if [ "$1" = "--install" ]; then
  rm -rf /Applications/Animetro.app
  cp -R "$APP" /Applications/
  echo "Installed /Applications/Animetro.app"
fi
