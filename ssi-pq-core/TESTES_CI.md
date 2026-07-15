# Fase 7: Testes e CI

Este documento descreve o pipeline minimo para manter a paridade entre Node,
WASM, mobile FFI e o pacote React Native.

## Linux

Comandos cobertos pelo job `linux` em `.github/workflows/ci.yml`:

```sh
cargo test --workspace
npm test
npm run test:wasm
npm run vectors:generate:node
npm run vectors:verify:node
npm run vectors:verify:wasm
npm run security:audit
npm run ci:react-native
```

O job tambem executa `npm pack --dry-run` em `packages/react-native` para
garantir que o pacote pode ser empacotado.

O script local `npm run ci:linux` cobre o subconjunto Rust/Node/WASM/vetores e
auditoria de seguranca. No workflow, os checks React Native e o `npm pack`
rodam em passos separados depois desse subconjunto.

## Mobile FFI

O job `mobile-ffi-android` executa:

```sh
cargo build -p ssi-pq-mobile-ffi --release
scripts/build-mobile-android.sh
scripts/lint-mobile-wrappers.sh kotlin
scripts/check-mobile-android-artifacts.sh
scripts/ci-android-gradle.sh
```

Esse fluxo gera bindings Kotlin UniFFI e cria as bibliotecas nativas:

- `packages/react-native/android/src/main/jniLibs/arm64-v8a/libssi_pq_mobile_ffi.so`
- `packages/react-native/android/src/main/jniLibs/x86_64/libssi_pq_mobile_ffi.so`

O lint mobile cobre os wrappers React Native manuais. Os bindings UniFFI
gerados sao validados por geracao/compilacao, porque nomes de arquivo, pacote e
metodos seguem o contrato do gerador.

## Android

O job `mobile-ffi-android` instala NDK `27.1.12297006`, compila `arm64-v8a` e
`x86_64` via `cargo-ndk` e valida a presenca das `.so`.

O app instrumentado minimo fica em `packages/react-native/example/android` e
executa um fluxo real em emulador/aparelho:

- wallet cifrada;
- DID publico;
- schema;
- credencial JSON assinada/verificada;
- PDF de credencial assinado/verificado;
- PDF generico assinado/verificado.

O mesmo app tambem cobre o equivalente Android de
`test-node/core/wallet-pdf-mlkem-nested-schema-labels-flow.test.js`, incluindo
schema aninhado, labels em portugues, PDF de credencial cifrado com ML-KEM e
decifragem/verificacao pelo destinatario.

Com emulador/aparelho conectado:

```sh
scripts/test-mobile-android-flow.sh
```

Para rodar apenas o fluxo Android de labels aninhados:

```sh
scripts/test-mobile-android-nested-labels-flow.sh
```

Ou:

```sh
cd packages/react-native/example/android
gradle assembleDebug assembleDebugAndroidTest connectedDebugAndroidTest
```

`scripts/ci-android-gradle.sh` usa `example/android/gradlew` quando existir ou
`gradle` do sistema. Se nenhum Gradle estiver disponivel, registra aviso e nao
falha o job. O teste conectado pode ser pulado nesse script com
`SKIP_CONNECTED_ANDROID_TESTS=1`.

## iOS

O job `ios` roda em `macos-15` e executa:

```sh
scripts/build-mobile-ios.sh
scripts/lint-mobile-wrappers.sh swift
scripts/check-mobile-ios-artifacts.sh
pod lib lint packages/react-native/ios/SsiPqReactNative.podspec --allow-warnings --skip-tests
scripts/ci-ios-example.sh
```

O script iOS gera bindings Swift UniFFI, staticlibs para device/simulador e
`packages/react-native/ios/Frameworks/SsiPqMobile.xcframework`.

O script `scripts/ci-ios-example.sh` esta preparado para rodar `pod install` e
`xcodebuild build test` quando `packages/react-native/example/ios` existir.

## Interoperabilidade

Os vetores ficam em `test-vectors/`.

Comandos atuais:

```sh
npm run vectors:generate:node
npm run vectors:verify:node
npm run vectors:verify:wasm
```

Os proximos geradores/verificadores devem seguir o mesmo formato de manifesto:

- `test-vectors/android/manifest.json`
- `test-vectors/ios/manifest.json`

Critério de aceite final da fase 7:

- Node gera vetores que Android, iOS e WASM verificam.
- Android gera vetores que Node, WASM e iOS verificam.
- iOS gera vetores que Node, WASM e Android verificam.
- Android e iOS executam os fluxos wallet/PDF fora da thread de UI nos apps de
  exemplo instrumentados.
