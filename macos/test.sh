#!/bin/sh
# Unit tests for the Mac app's Swift code, no network needed: builds Animetro.swift with macos/tests/main.swift
# (ANIMETRO_TESTS leaves out the app's launch) and runs it. Today that covers the __image route's size and type limits.
# Usage: ./macos/test.sh
set -e
cd "$(dirname "$0")/.."
mkdir -p build
swiftc -D ANIMETRO_TESTS macos/Animetro.swift macos/tests/main.swift -o build/animetro-tests
build/animetro-tests
