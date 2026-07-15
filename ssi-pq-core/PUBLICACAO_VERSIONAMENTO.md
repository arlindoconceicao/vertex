# Publicacao e Versionamento

Este documento define como versionar e publicar o pacote React Native SSI-PQ
mantendo paridade com as crates Rust, o addon Node e o WASM.

## Versao Unica do Projeto

A versao publica deve ser mantida sincronizada entre:

- `Cargo.toml` workspace version;
- `package.json` da raiz, quando a API Node mudar;
- `packages/react-native/package.json`;
- `packages/react-native/ios/SsiPqReactNative.podspec`, que le a versao do
  `package.json` do pacote RN.

Politica inicial:

- patch: correcoes internas sem mudar contrato publico;
- minor: novo export seguro, novo metodo RN, novo vetor ou novo alvo suportado;
- major: quebra de contrato de manifesto, wallet, PDF, DID ou API TypeScript.

## Artefatos que Entram no Pacote RN

O pacote `@ssi-pq/react-native` publica:

- `src/` com a API TypeScript segura;
- `src/node-compatible.ts` com facade de migracao;
- `android/` com Gradle, TurboModule, bindings Kotlin UniFFI e `.so`;
- `ios/` com Podspec, wrappers Swift/Objective-C++ e bindings Swift UniFFI;
- `example/` com fluxo minimo TypeScript e app Android instrumentado de teste.

Antes de publicar, gerar ou validar:

```sh
npm run ci:react-native
npm run security:audit
npm run vectors:verify:node
npm run vectors:verify:wasm
scripts/build-mobile-android.sh
scripts/check-mobile-android-artifacts.sh
```

No macOS com Xcode:

```sh
scripts/build-mobile-ios.sh
REQUIRE_XCFRAMEWORK=1 scripts/check-mobile-ios-artifacts.sh
pod lib lint packages/react-native/ios/SsiPqReactNative.podspec --allow-warnings --skip-tests
```

## Publicacao npm

Dry-run:

```sh
cd packages/react-native
npm pack --dry-run
```

Publicacao:

```sh
cd packages/react-native
npm publish --access public
```

O pacote deve conter as bibliotecas Android para:

- `arm64-v8a`;
- `x86_64`.

O pacote iOS deve conter `ios/Frameworks/SsiPqMobile.xcframework` quando a
publicacao mirar consumo iOS via CocoaPods.

## Tags Git

O podspec atual usa `tag: s.version.to_s`, portanto a tag exigida para publicar
via CocoaPods deve ser exatamente igual a versao do pacote, sem prefixo:

```text
0.1.0
```

Tags auxiliares por pacote podem ser usadas para organizacao interna, mas se
forem usadas como fonte CocoaPods o `podspec` tambem precisa ser alterado para
apontar para esse nome:

```text
react-native-v0.1.0
core-v0.1.0
```

## Compatibilidade

Uma versao mobile so deve ser marcada como compativel com a lib Node quando:

- `MATRIZ_PARIDADE_NODE_MOBILE.md` estiver atualizada;
- `test-vectors/node/manifest.json` verificar em Node e WASM;
- Android gerar `.so` para `arm64-v8a` e `x86_64`;
- iOS gerar `SsiPqMobile.xcframework` em macOS;
- a API publica RN nao retornar private keys;
- PDFs/credenciais gerados pela wallet mobile verificarem na lib Node.

## Observacao sobre Keystore/Keychain

A baseline mobile usa wallet cifrada pelo core, por senha/KDF, para preservar
paridade com Node e WASM. Keystore/Keychain/biometria podem ser publicados no
futuro como hardening opcional, sem alterar o contrato de wallet cifrada.
