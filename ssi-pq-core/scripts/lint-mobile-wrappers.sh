#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${1:-all}"
REQUIRE_LINTERS="${REQUIRE_MOBILE_LINTERS:-0}"

run_ktlint() {
  local kotlin_root="$ROOT_DIR/packages/react-native/android/src/main/java/com/ssipq/reactnative"
  if ! command -v ktlint >/dev/null 2>&1; then
    if [ "$REQUIRE_LINTERS" = "1" ]; then
      echo "error: ktlint is required but was not found" >&2
      exit 1
    fi
    echo "warning: ktlint not found; skipping Kotlin lint" >&2
    return
  fi

  if [ -d "$kotlin_root" ]; then
    ktlint "$kotlin_root/**/*.kt"
  fi
}

run_swift_format() {
  local swift_root="$ROOT_DIR/packages/react-native/ios/Sources"
  if ! command -v swift-format >/dev/null 2>&1; then
    if [ "$REQUIRE_LINTERS" = "1" ]; then
      echo "error: swift-format is required but was not found" >&2
      exit 1
    fi
    echo "warning: swift-format not found; skipping Swift lint" >&2
    return
  fi

  if [ -d "$swift_root" ]; then
    find "$swift_root" \
      -path "$swift_root/Generated" -prune \
      -o -name '*.swift' -print0 \
      | xargs -0 swift-format lint
  fi
}

case "$MODE" in
  all)
    run_ktlint
    run_swift_format
    ;;
  kotlin)
    run_ktlint
    ;;
  swift)
    run_swift_format
    ;;
  *)
    echo "usage: $0 [all|kotlin|swift]" >&2
    exit 1
    ;;
esac

echo "Mobile wrapper lint checks passed"
