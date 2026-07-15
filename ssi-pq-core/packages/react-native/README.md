# @ssi-pq/react-native

React Native package for SSI-PQ mobile wallets, credentials and post-quantum PDF signing.

For the full Android/iOS consumption manual, see:

```text
../../MANUAL_LIB_MOBILE_ANDROID_IOS.md
```

For the full function reference, see:

```text
../../MANUAL_FUNCOES_LIB_MOBILE.md
```

## Android build

The Android package uses:

- React Native `>=0.86.0`;
- Android `minSdkVersion 24`, `compileSdkVersion 36`;
- Android NDK `27.1.12297006`;
- Rust targets `aarch64-linux-android` and `x86_64-linux-android`;
- UniFFI Kotlin bindings generated from `crates/ssi-pq-mobile-ffi`;
- JNA for Kotlin-to-Rust FFI loading.

Install the Android SDK/NDK and expose one of:

```bash
export ANDROID_HOME="$HOME/Android/Sdk"
export ANDROID_NDK_HOME="$ANDROID_HOME/ndk/27.1.12297006"
```

Then run from the repository root:

```bash
scripts/build-mobile-android.sh
```

Expected native outputs:

```text
android/src/main/jniLibs/arm64-v8a/libssi_pq_mobile_ffi.so
android/src/main/jniLibs/x86_64/libssi_pq_mobile_ffi.so
```

The script also regenerates UniFFI Kotlin bindings under:

```text
android/src/main/java/uniffi/ssi_pq_mobile_ffi/ssi_pq_mobile_ffi.kt
```

## Runtime model

The TurboModule methods return `Promise` and run wallet/PDF/crypto work on a background executor. Wallet state is stored under the app private `noBackupFilesDir` and private keys are not returned by the public wallet API.

## iOS build

The iOS package uses:

- iOS minimum `15.1`;
- Rust targets `aarch64-apple-ios`, `aarch64-apple-ios-sim`, `x86_64-apple-ios`;
- UniFFI Swift bindings generated from `crates/ssi-pq-mobile-ffi`;
- `SsiPqMobile.xcframework` with static Rust libraries for device and simulator.

Run from the repository root on macOS with Xcode installed:

```bash
scripts/build-mobile-ios.sh
```

Expected output:

```text
ios/Frameworks/SsiPqMobile.xcframework
ios/Sources/Generated/ssi_pq_mobile_ffi.swift
ios/Sources/Generated/ssi_pq_mobile_ffiFFI.h
ios/Sources/Generated/ssi_pq_mobile_ffiFFI.modulemap
```

Then run `pod install` in the React Native example app. Wallet state is stored in Application Support and marked as excluded from iCloud backup.

## Publishing

See the repository-level `PUBLICACAO_VERSIONAMENTO.md` before publishing. The
short release gate is:

```bash
npm run ci:react-native
npm run security:audit
npm run vectors:verify:node
npm run vectors:verify:wasm
scripts/build-mobile-android.sh
scripts/check-mobile-android-artifacts.sh
```

On macOS, also build and validate the iOS XCFramework:

```bash
scripts/build-mobile-ios.sh
REQUIRE_XCFRAMEWORK=1 scripts/check-mobile-ios-artifacts.sh
```

Then run:

```bash
npm pack --dry-run
npm publish --access public
```
