#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
JNI_LIBS_DIR="$ROOT_DIR/packages/react-native/android/src/main/jniLibs"
LIB_NAME="libssi_pq_mobile_ffi.so"

check_so() {
  local abi="$1"
  local artifact="$JNI_LIBS_DIR/$abi/$LIB_NAME"

  if [ ! -s "$artifact" ]; then
    echo "error: missing Android native library: $artifact" >&2
    exit 1
  fi

  echo "found $artifact"
  file "$artifact" || true

  if command -v readelf >/dev/null 2>&1; then
    readelf -h "$artifact" >/dev/null
  fi
}

check_archive() {
  local archive="$1"
  local expected_arm64="lib/arm64-v8a/$LIB_NAME"
  local expected_x86_64="lib/x86_64/$LIB_NAME"

  if [ ! -f "$archive" ]; then
    return
  fi

  echo "checking native libraries inside $archive"
  if ! unzip -l "$archive" | grep -q "$expected_arm64"; then
    echo "error: $archive does not contain $expected_arm64" >&2
    exit 1
  fi
  if ! unzip -l "$archive" | grep -q "$expected_x86_64"; then
    echo "error: $archive does not contain $expected_x86_64" >&2
    exit 1
  fi
}

check_so arm64-v8a
check_so x86_64

while IFS= read -r archive; do
  check_archive "$archive"
done < <(find "$ROOT_DIR/packages/react-native/android/build/outputs" -type f \( -name '*.aar' -o -name '*.apk' \) 2>/dev/null || true)

echo "Android native artifact checks passed"
