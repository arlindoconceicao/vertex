#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CRATE_NAME="ssi-pq-mobile-ffi"
LIB_NAME="libssi_pq_mobile_ffi.so"
ANDROID_PACKAGE_DIR="$ROOT_DIR/packages/react-native/android"
JNI_LIBS_DIR="$ANDROID_PACKAGE_DIR/src/main/jniLibs"
KOTLIN_OUT_DIR="$ANDROID_PACKAGE_DIR/src/main/java"
BINDGEN_DIR="${CARGO_TARGET_DIR:-$ROOT_DIR/target}/uniffi-bindgen-cli"
HOST_LIBRARY="$ROOT_DIR/target/release/$LIB_NAME"
ANDROID_NDK_VERSION="${ANDROID_NDK_VERSION:-27.1.12297006}"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "error: required command not found: $1" >&2
    exit 1
  fi
}

detect_ndk() {
  if [ -n "${ANDROID_NDK_HOME:-}" ] && [ -d "$ANDROID_NDK_HOME" ]; then
    echo "$ANDROID_NDK_HOME"
    return
  fi

  if [ -n "${ANDROID_NDK_ROOT:-}" ] && [ -d "$ANDROID_NDK_ROOT" ]; then
    echo "$ANDROID_NDK_ROOT"
    return
  fi

  local sdk_root="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}"
  if [ -n "$sdk_root" ] && [ -d "$sdk_root/ndk/$ANDROID_NDK_VERSION" ]; then
    echo "$sdk_root/ndk/$ANDROID_NDK_VERSION"
    return
  fi

  if [ -n "$sdk_root" ] && [ -d "$sdk_root/ndk" ]; then
    find "$sdk_root/ndk" -mindepth 1 -maxdepth 1 -type d | sort -V | tail -n 1
    return
  fi
}

ensure_uniffi_bindgen_cli() {
  if [ -f "$BINDGEN_DIR/Cargo.toml" ]; then
    return
  fi

  mkdir -p "$BINDGEN_DIR/src"
  cat >"$BINDGEN_DIR/Cargo.toml" <<'TOML'
[package]
name = "ssi-pq-uniffi-bindgen-cli"
version = "0.1.0"
edition = "2024"

[dependencies]
uniffi = { version = "0.29", features = ["cli"] }
TOML

  cat >"$BINDGEN_DIR/src/main.rs" <<'RS'
fn main() {
    uniffi::uniffi_bindgen_main();
}
RS
}

require_command cargo
require_command rustup
require_command cargo-ndk

rustup target add aarch64-linux-android x86_64-linux-android

NDK_DIR="$(detect_ndk || true)"
if [ -z "$NDK_DIR" ]; then
  cat >&2 <<EOF
error: Android NDK not found.

Install Android SDK/NDK $ANDROID_NDK_VERSION and export one of:
  ANDROID_NDK_HOME=/path/to/Android/Sdk/ndk/$ANDROID_NDK_VERSION
  ANDROID_NDK_ROOT=/path/to/Android/Sdk/ndk/$ANDROID_NDK_VERSION
  ANDROID_HOME=/path/to/Android/Sdk
  ANDROID_SDK_ROOT=/path/to/Android/Sdk

With sdkmanager:
  sdkmanager "ndk;$ANDROID_NDK_VERSION" "platforms;android-36" "build-tools;36.0.0"
EOF
  exit 1
fi
export ANDROID_NDK_HOME="$NDK_DIR"

mkdir -p "$JNI_LIBS_DIR" "$KOTLIN_OUT_DIR"

echo "==> Building host library for UniFFI Kotlin binding generation"
cargo build -p "$CRATE_NAME" --release

echo "==> Generating UniFFI Kotlin bindings into $KOTLIN_OUT_DIR"
ensure_uniffi_bindgen_cli
cargo run --manifest-path "$BINDGEN_DIR/Cargo.toml" --offline -- generate \
  --library "$HOST_LIBRARY" \
  --crate ssi_pq_mobile_ffi \
  --language kotlin \
  --out-dir "$KOTLIN_OUT_DIR"

echo "==> Building Android native libraries with cargo-ndk"
cargo ndk \
  -t arm64-v8a \
  -t x86_64 \
  -o "$JNI_LIBS_DIR" \
  build -p "$CRATE_NAME" --release

for abi in arm64-v8a x86_64; do
  artifact="$JNI_LIBS_DIR/$abi/$LIB_NAME"
  if [ ! -f "$artifact" ]; then
    echo "error: missing native library: $artifact" >&2
    exit 1
  fi
  file "$artifact" || true
done

echo "Android mobile artifacts generated under $ANDROID_PACKAGE_DIR"
