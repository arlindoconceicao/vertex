#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXAMPLE_ANDROID_DIR="${ANDROID_EXAMPLE_DIR:-$ROOT_DIR/packages/react-native/example/android}"

if [ -x "$EXAMPLE_ANDROID_DIR/gradlew" ]; then
  GRADLE_CMD=("$EXAMPLE_ANDROID_DIR/gradlew")
elif [ -x "${SDKMAN_DIR:-$HOME/.sdkman}/candidates/gradle/9.5.1/bin/gradle" ]; then
  GRADLE_CMD=("${SDKMAN_DIR:-$HOME/.sdkman}/candidates/gradle/9.5.1/bin/gradle")
elif command -v gradle >/dev/null 2>&1; then
  GRADLE_CMD=(gradle)
elif [ -x "${SDKMAN_DIR:-$HOME/.sdkman}/candidates/gradle/current/bin/gradle" ]; then
  GRADLE_CMD=("${SDKMAN_DIR:-$HOME/.sdkman}/candidates/gradle/current/bin/gradle")
else
  cat >&2 <<EOF
warning: Gradle was not found for the Android example app at:
  $EXAMPLE_ANDROID_DIR

Skipping Gradle assemble and instrumented tests. Install Gradle or add a Gradle
wrapper there to run:
  gradle assembleDebug
  gradle assembleDebugAndroidTest
  gradle connectedDebugAndroidTest
EOF
  exit 0
fi

(
  cd "$EXAMPLE_ANDROID_DIR"
  "${GRADLE_CMD[@]}" assembleDebug assembleDebugAndroidTest
  if [ "${SKIP_CONNECTED_ANDROID_TESTS:-0}" = "1" ]; then
    echo "Skipping connectedDebugAndroidTest because SKIP_CONNECTED_ANDROID_TESTS=1"
  else
    "${GRADLE_CMD[@]}" connectedDebugAndroidTest
  fi
)

"$ROOT_DIR/scripts/check-mobile-android-artifacts.sh"
