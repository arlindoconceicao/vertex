#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CRATE_NAME="ssi-pq-mobile-ffi"
LIB_NAME="libssi_pq_mobile_ffi.a"
IOS_PACKAGE_DIR="$ROOT_DIR/packages/react-native/ios"
GENERATED_DIR="$IOS_PACKAGE_DIR/Sources/Generated"
FRAMEWORKS_DIR="$IOS_PACKAGE_DIR/Frameworks"
XCFRAMEWORK_DIR="$FRAMEWORKS_DIR/SsiPqMobile.xcframework"
BUILD_DIR="$ROOT_DIR/target/mobile-ios"
HEADERS_DIR="$BUILD_DIR/headers"
SIM_UNIVERSAL_DIR="$BUILD_DIR/simulator-universal"
BINDGEN_DIR="${CARGO_TARGET_DIR:-$ROOT_DIR/target}/uniffi-bindgen-cli"
HOST_LIBRARY="$ROOT_DIR/target/release/libssi_pq_mobile_ffi.so"
IOS_DEPLOYMENT_TARGET="${IOS_DEPLOYMENT_TARGET:-15.1}"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "error: required command not found: $1" >&2
    exit 1
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

rustup target add aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios

mkdir -p "$GENERATED_DIR" "$FRAMEWORKS_DIR" "$HEADERS_DIR" "$SIM_UNIVERSAL_DIR"

echo "==> Building host library for UniFFI Swift binding generation"
cargo build -p "$CRATE_NAME" --release

echo "==> Generating UniFFI Swift bindings into $GENERATED_DIR"
ensure_uniffi_bindgen_cli
cargo run --manifest-path "$BINDGEN_DIR/Cargo.toml" --offline -- generate \
  --library "$HOST_LIBRARY" \
  --crate ssi_pq_mobile_ffi \
  --language swift \
  --out-dir "$GENERATED_DIR"

cp "$GENERATED_DIR/ssi_pq_mobile_ffiFFI.h" "$HEADERS_DIR/ssi_pq_mobile_ffiFFI.h"
cp "$GENERATED_DIR/ssi_pq_mobile_ffiFFI.modulemap" "$HEADERS_DIR/module.modulemap"

if [ "$(uname -s)" != "Darwin" ]; then
  cat <<EOF
Swift bindings generated, but SsiPqMobile.xcframework requires macOS/Xcode.

Run this script on macOS with Xcode installed to build:
  $XCFRAMEWORK_DIR
EOF
  exit 0
fi

require_command xcrun
require_command xcodebuild
require_command lipo

IPHONEOS_SDKROOT="$(xcrun --sdk iphoneos --show-sdk-path)"
SIMULATOR_SDKROOT="$(xcrun --sdk iphonesimulator --show-sdk-path)"
CLANG="$(xcrun -f clang)"

export CARGO_TARGET_AARCH64_APPLE_IOS_LINKER="$CLANG"
export CARGO_TARGET_AARCH64_APPLE_IOS_SIM_LINKER="$CLANG"
export CARGO_TARGET_X86_64_APPLE_IOS_LINKER="$CLANG"

export CARGO_TARGET_AARCH64_APPLE_IOS_RUSTFLAGS="-C link-arg=-isysroot -C link-arg=$IPHONEOS_SDKROOT -C link-arg=-miphoneos-version-min=$IOS_DEPLOYMENT_TARGET"
export CARGO_TARGET_AARCH64_APPLE_IOS_SIM_RUSTFLAGS="-C link-arg=-isysroot -C link-arg=$SIMULATOR_SDKROOT -C link-arg=-mios-simulator-version-min=$IOS_DEPLOYMENT_TARGET"
export CARGO_TARGET_X86_64_APPLE_IOS_RUSTFLAGS="-C link-arg=-isysroot -C link-arg=$SIMULATOR_SDKROOT -C link-arg=-mios-simulator-version-min=$IOS_DEPLOYMENT_TARGET"

echo "==> Building iOS static libraries"
cargo build -p "$CRATE_NAME" --release --target aarch64-apple-ios
cargo build -p "$CRATE_NAME" --release --target aarch64-apple-ios-sim
cargo build -p "$CRATE_NAME" --release --target x86_64-apple-ios

DEVICE_LIB="$ROOT_DIR/target/aarch64-apple-ios/release/$LIB_NAME"
SIM_ARM64_LIB="$ROOT_DIR/target/aarch64-apple-ios-sim/release/$LIB_NAME"
SIM_X86_64_LIB="$ROOT_DIR/target/x86_64-apple-ios/release/$LIB_NAME"
SIM_UNIVERSAL_LIB="$SIM_UNIVERSAL_DIR/$LIB_NAME"

echo "==> Creating universal simulator static library"
lipo -create "$SIM_ARM64_LIB" "$SIM_X86_64_LIB" -output "$SIM_UNIVERSAL_LIB"

echo "==> Creating SsiPqMobile.xcframework"
rm -rf "$XCFRAMEWORK_DIR"
xcodebuild -create-xcframework \
  -library "$DEVICE_LIB" \
  -headers "$HEADERS_DIR" \
  -library "$SIM_UNIVERSAL_LIB" \
  -headers "$HEADERS_DIR" \
  -output "$XCFRAMEWORK_DIR"

xcodebuild -list -xcframework "$XCFRAMEWORK_DIR" >/dev/null || true

echo "iOS mobile artifacts generated under $IOS_PACKAGE_DIR"
