#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IOS_PACKAGE_DIR="$ROOT_DIR/packages/react-native/ios"
GENERATED_DIR="$IOS_PACKAGE_DIR/Sources/Generated"
XCFRAMEWORK_DIR="$IOS_PACKAGE_DIR/Frameworks/SsiPqMobile.xcframework"
REQUIRE_XCFRAMEWORK="${REQUIRE_XCFRAMEWORK:-0}"

if [ ! -s "$GENERATED_DIR/ssi_pq_mobile_ffi.swift" ]; then
  echo "error: missing generated Swift bindings" >&2
  exit 1
fi

if [ ! -s "$GENERATED_DIR/ssi_pq_mobile_ffiFFI.h" ]; then
  echo "error: missing generated UniFFI header" >&2
  exit 1
fi

if [ "$REQUIRE_XCFRAMEWORK" = "1" ]; then
  if [ ! -d "$XCFRAMEWORK_DIR" ]; then
    echo "error: missing $XCFRAMEWORK_DIR" >&2
    exit 1
  fi

  if command -v xcodebuild >/dev/null 2>&1; then
    xcodebuild -list -xcframework "$XCFRAMEWORK_DIR" >/dev/null || true
  fi
else
  if [ ! -d "$XCFRAMEWORK_DIR" ]; then
    echo "warning: XCFramework not present; run scripts/build-mobile-ios.sh on macOS to create it" >&2
  fi
fi

echo "iOS mobile artifact checks passed"
