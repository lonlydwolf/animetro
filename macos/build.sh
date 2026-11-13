#!/bin/sh
# Builds Animetro.app: a native macOS window around the web app (no server needed).
# Needs Xcode or the Command Line Tools (`xcode-select --install`).
#   ./macos/build.sh               -> build/Animetro.app (runs on Apple Silicon and Intel)
#   ./macos/build.sh --install     -> also copies it to /Applications
#   VERSION=1.2.0 ./macos/build.sh -> stamps that version into the app (the release workflow passes the tag)
set -e
cd "$(dirname "$0")/.."
APP=build/Animetro.app
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/web"
cp -R web/. "$APP/Contents/Resources/web/"
cp macos/Info.plist "$APP/Contents/"
cp macos/Animetro.icns "$APP/Contents/Resources/"
if [ -n "$VERSION" ]; then
  plutil -replace CFBundleShortVersionString -string "$VERSION" "$APP/Contents/Info.plist"
  plutil -replace CFBundleVersion -string "$VERSION" "$APP/Contents/Info.plist"
fi
# one binary for both Mac chips
for arch in arm64 x86_64; do
  swiftc -O -parse-as-library -target "$arch-apple-macos13" macos/Animetro.swift -o "build/Animetro-$arch"
done
lipo -create build/Animetro-arm64 build/Animetro-x86_64 -output "$APP/Contents/MacOS/Animetro"
rm build/Animetro-arm64 build/Animetro-x86_64
codesign --force --sign - "$APP" >/dev/null 2>&1   # ad-hoc signature so macOS will open a locally built app
echo "Built $APP"
if [ "$1" = "--install" ]; then
  rm -rf /Applications/Animetro.app
  cp -R "$APP" /Applications/
  echo "Installed /Applications/Animetro.app"
fi
