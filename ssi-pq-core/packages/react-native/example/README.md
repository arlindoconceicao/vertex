# SSI-PQ React Native Example

This folder contains a minimal flow that can be copied into a React Native app.

The example expects two real file URIs:

- `inputPdfUri`: an existing PDF available to the app.
- `outputPdfUri`: the destination where the signed PDF will be written.

The flow:

1. Creates or opens a wallet.
2. Creates a DID inside the wallet.
3. Creates a schema from attributes.
4. Issues a signed credential without exporting private keys to JavaScript.
5. Embeds and signs the credential in a PDF.
6. Verifies the signed PDF.

For Android, run `scripts/build-mobile-android.sh` before building the app.
For iOS, run `scripts/build-mobile-ios.sh` on macOS and then `pod install`.

## Android instrumented parity flow

The `android/` folder contains a minimal Android test app that links the generated
UniFFI Kotlin bindings and native `.so` files directly. It runs the mobile version
of the wallet/PDF flow on an emulator or device:

1. Creates an encrypted wallet.
2. Creates a DID without exporting private keys.
3. Exports the public DID Document.
4. Creates a schema.
5. Issues and verifies a signed JSON credential.
6. Generates and signs a credential PDF.
7. Signs and verifies a generic PDF.

Run it with:

```sh
scripts/test-mobile-android-flow.sh
```

The Android equivalent of
`test-node/core/wallet-pdf-mlkem-nested-schema-labels-flow.test.js` has a
dedicated runner:

```sh
scripts/test-mobile-android-nested-labels-flow.sh
```

It targets the instrumented class:

```text
com.ssipq.mobiletest.SsiPqAndroidNestedLabelsEncryptedPdfFlowTest
```

Or manually:

```sh
scripts/build-mobile-android.sh
cd packages/react-native/example/android
gradle assembleDebug assembleDebugAndroidTest connectedDebugAndroidTest
```
