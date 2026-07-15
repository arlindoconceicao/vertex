#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXAMPLE_IOS_DIR="${IOS_EXAMPLE_DIR:-$ROOT_DIR/packages/react-native/example/ios}"
SCHEME="${IOS_EXAMPLE_SCHEME:-SsiPqExample}"
DESTINATION="${IOS_DESTINATION:-platform=iOS Simulator,name=iPhone 16}"

if [ ! -f "$EXAMPLE_IOS_DIR/Podfile" ]; then
  cat >&2 <<EOF
warning: iOS example app was not found at:
  $EXAMPLE_IOS_DIR

Skipping pod install and simulator build. Once the React Native example app is
added, this script will run pod install and xcodebuild for scheme $SCHEME.
EOF
  exit 0
fi

(
  cd "$EXAMPLE_IOS_DIR"
  pod install
  xcodebuild \
    -workspace "$SCHEME.xcworkspace" \
    -scheme "$SCHEME" \
    -configuration Debug \
    -destination "$DESTINATION" \
    build test
)
