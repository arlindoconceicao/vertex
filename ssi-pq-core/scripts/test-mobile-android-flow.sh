#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXAMPLE_ANDROID_DIR="$ROOT_DIR/packages/react-native/example/android"

"$ROOT_DIR/scripts/build-mobile-android.sh"

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
error: Gradle was not found.

Install Gradle or add a Gradle wrapper under:
  $EXAMPLE_ANDROID_DIR
EOF
  exit 1
fi

(
  cd "$EXAMPLE_ANDROID_DIR"
  "${GRADLE_CMD[@]}" assembleDebug assembleDebugAndroidTest connectedDebugAndroidTest
)
