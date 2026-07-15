# Manual da Lib Mobile Android/iOS

Este manual descreve como consumir a lib mobile SSI-PQ em aplicativos React
Native Android/iOS. A missão deste pacote não é criar o app final, mas entregar
uma biblioteca pronta para ser integrada, com paridade operacional com a lib
Node.js e com a lib WASM.

Pacote:

```text
packages/react-native
```

Nome npm:

```text
@ssi-pq/react-native
```

## Modelo de Uso

A lib mobile expõe uma API React Native segura em TypeScript. O app consumidor
chama funções assíncronas que delegam wallet, criptografia e PDF para código
nativo Android/iOS.

Princípios:

- wallet cifrada pelo core, por senha/KDF, mantendo paridade com Node/WASM;
- private keys não retornam pela API pública React Native;
- assinatura e PDF rodam fora da thread de UI;
- PDFs grandes usam `inputUri`/`outputUri`, evitando trafegar arquivo inteiro em
  JavaScript;
- Android e iOS usam storage privado do app;
- APIs perigosas ficam omitidas da API segura ou isoladas na facade técnica.

## Estrutura Entregue

```text
packages/react-native/
  package.json
  react-native.config.js
  src/
    index.ts
    NativeSsiPq.ts
    node-compatible.ts
    types.ts
  android/
    build.gradle
    src/main/java/com/ssipq/reactnative/
    src/main/java/uniffi/ssi_pq_mobile_ffi/
    src/main/jniLibs/arm64-v8a/libssi_pq_mobile_ffi.so
    src/main/jniLibs/x86_64/libssi_pq_mobile_ffi.so
  ios/
    SsiPqReactNative.podspec
    Sources/
    Frameworks/
  example/
    android/
      app/src/androidTest/java/com/ssipq/mobiletest/
        SsiPqAndroidWalletPdfFlowTest.kt
        SsiPqAndroidNestedLabelsEncryptedPdfFlowTest.kt
```

## Requisitos

React Native:

```text
>=0.86.0
```

Android:

```text
minSdkVersion 24
compileSdkVersion 36
NDK 27.1.12297006
ABIs: arm64-v8a, x86_64
Android SDK Platform 36
Gradle 9.5.1 para o app instrumentado de teste
```

Observação sobre Gradle: o projeto Android instrumentado foi validado com
Gradle `9.5.1`. O Gradle `9.6.1` pode falhar com o Android Gradle Plugin usado
no app de teste por causa da remoção de APIs internas do Gradle. Os scripts
preferem automaticamente:

```text
$HOME/.sdkman/candidates/gradle/9.5.1/bin/gradle
```

quando essa versão estiver instalada.

iOS:

```text
iOS 15.1+
Xcode em macOS para gerar XCFramework
targets Rust: aarch64-apple-ios, aarch64-apple-ios-sim, x86_64-apple-ios
```

Rust targets Android:

```sh
rustup target add aarch64-linux-android x86_64-linux-android
```

Rust targets iOS:

```sh
rustup target add aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios
```

## Build Android da Lib

Configure SDK/NDK:

```sh
export ANDROID_HOME="$HOME/Android/Sdk"
export ANDROID_NDK_HOME="$ANDROID_HOME/ndk/27.1.12297006"
```

Gere `.so` e bindings Kotlin UniFFI:

```sh
scripts/build-mobile-android.sh
```

Saídas esperadas:

```text
packages/react-native/android/src/main/jniLibs/arm64-v8a/libssi_pq_mobile_ffi.so
packages/react-native/android/src/main/jniLibs/x86_64/libssi_pq_mobile_ffi.so
packages/react-native/android/src/main/java/uniffi/ssi_pq_mobile_ffi/ssi_pq_mobile_ffi.kt
```

Valide:

```sh
scripts/check-mobile-android-artifacts.sh
```

O app consumidor não precisa chamar Rust diretamente. Ele consome o pacote RN,
e o autolinking registra `SsiPqPackage`.

## Teste Instrumentado Android da Lib

O repositório inclui um app Android mínimo de teste em:

```text
packages/react-native/example/android
```

Esse app não é o produto final. Ele existe para provar que a lib Android está
linkada em um APK real e consegue executar, dentro de emulador/aparelho, um
fluxo real usando os bindings Kotlin UniFFI e os `.so` empacotados pelo app.

### Fluxo Básico Android

O fluxo básico valida:

- criar wallet cifrada;
- criar DID dentro da wallet;
- exportar DID Document público;
- criar schema;
- emitir e verificar credencial JSON assinada;
- gerar PDF de credencial, assinar e verificar;
- assinar e verificar PDF genérico.

Com um emulador ou aparelho conectado:

```sh
scripts/test-mobile-android-flow.sh
```

Ou manualmente:

```sh
scripts/build-mobile-android.sh
cd packages/react-native/example/android
gradle assembleDebug assembleDebugAndroidTest connectedDebugAndroidTest
```

O teste principal fica em:

```text
packages/react-native/example/android/app/src/androidTest/java/com/ssipq/mobiletest/SsiPqAndroidWalletPdfFlowTest.kt
```

### Fluxo Android Equivalente ao Teste Node Nested Labels

O teste Android equivalente ao arquivo Node:

```text
test-node/core/wallet-pdf-mlkem-nested-schema-labels-flow.test.js
```

fica em:

```text
packages/react-native/example/android/app/src/androidTest/java/com/ssipq/mobiletest/SsiPqAndroidNestedLabelsEncryptedPdfFlowTest.kt
```

Esse teste cobre:

- wallet/DID do remetente;
- wallet/DID do destinatário;
- schema aninhado;
- credencial JSON assinada;
- labels visuais em português do Brasil no PDF;
- validação dos textos renderizados no PDF;
- assinatura do PDF de credencial;
- encapsulamento ML-KEM para o destinatário;
- cifragem AES-256-GCM do PDF;
- descapsulamento pela wallet do destinatário;
- decifragem do PDF;
- verificação do PDF decifrado;
- extração do manifesto;
- comparação dos `attribute_disclosures` esperados.

Com um emulador ou aparelho conectado:

```sh
scripts/test-mobile-android-nested-labels-flow.sh
```

Resultado esperado:

```text
> Task :app:connectedDebugAndroidTest
Starting 1 tests on Pixel_6_API_35(AVD) - 15

Finished 1 tests on Pixel_6_API_35(AVD) - 15

BUILD SUCCESSFUL
```

### Comandos Para Subir o Emulador e Rodar o Teste

Liste os AVDs disponíveis:

```sh
emulator -list-avds
```

Inicie o AVD usado nos testes:

```sh
emulator -avd Pixel_6_API_35
```

Ou, para rodar sem janela:

```sh
emulator -avd Pixel_6_API_35 -no-window -no-audio -no-snapshot -gpu swiftshader_indirect
```

Em outro terminal, confirme que o emulador apareceu:

```sh
adb devices
```

Aguarde o boot terminar:

```sh
adb shell getprop sys.boot_completed
```

Quando o comando retornar `1`, rode o teste equivalente ao Node:

```sh
scripts/test-mobile-android-nested-labels-flow.sh
```

Para encerrar o emulador:

```sh
adb emu kill
```

### O Que o Script Nested Labels Faz

O script:

```text
scripts/test-mobile-android-nested-labels-flow.sh
```

executa as etapas abaixo:

1. recompila a lib mobile Android;
2. regenera os bindings Kotlin UniFFI;
3. gera os `.so` para `arm64-v8a` e `x86_64`;
4. compila o APK de teste;
5. instala o app de teste no emulador/aparelho;
6. executa somente a classe:

```text
com.ssipq.mobiletest.SsiPqAndroidNestedLabelsEncryptedPdfFlowTest
```

Também é possível trocar a classe via variável de ambiente:

```sh
ANDROID_TEST_CLASS=com.ssipq.mobiletest.SsiPqAndroidNestedLabelsEncryptedPdfFlowTest \
  scripts/test-mobile-android-nested-labels-flow.sh
```

## Build iOS da Lib

Em macOS com Xcode:

```sh
scripts/build-mobile-ios.sh
```

Saídas esperadas:

```text
packages/react-native/ios/Frameworks/SsiPqMobile.xcframework
packages/react-native/ios/Sources/Generated/ssi_pq_mobile_ffi.swift
packages/react-native/ios/Sources/Generated/ssi_pq_mobile_ffiFFI.h
packages/react-native/ios/Sources/Generated/ssi_pq_mobile_ffiFFI.modulemap
```

Valide:

```sh
REQUIRE_XCFRAMEWORK=1 scripts/check-mobile-ios-artifacts.sh
```

O pacote CocoaPods é definido por:

```text
packages/react-native/ios/SsiPqReactNative.podspec
```

No app consumidor iOS, rode `pod install` após instalar o pacote npm.

## Instalação no App Consumidor

Quando publicado:

```sh
npm install @ssi-pq/react-native
```

ou:

```sh
yarn add @ssi-pq/react-native
```

Durante desenvolvimento local:

```json
{
  "dependencies": {
    "@ssi-pq/react-native": "file:../caminho/para/ssi-pq-core/packages/react-native"
  }
}
```

React Native usa autolinking via:

```text
packages/react-native/react-native.config.js
```

Android aponta para:

```text
packages/react-native/android
```

iOS aponta para:

```text
packages/react-native/ios/SsiPqReactNative.podspec
```

## API Segura TypeScript

Importe do pacote principal:

```ts
import {
  createWallet,
  openWallet,
  changeWalletPassword,
  createDid,
  listDids,
  getDidDocument,
  createSchemaFromAttributes,
  issueCredentialFromSchema,
  embedSignedCredentialInPdf,
  signGenericPdf,
  verifySignedCredential,
  verifySignedCredentialPdf,
  verifySignedGenericPdf,
  mlkemDecapsulate,
  supportedProfiles,
} from '@ssi-pq/react-native';
```

### Wallet

```ts
await createWallet('issuer-wallet', 'senha forte', {
  createdAt: new Date().toISOString(),
});

const info = await openWallet('issuer-wallet', 'senha forte');

const changed = await changeWalletPassword(
  'issuer-wallet',
  'senha forte',
  'nova senha forte',
);
```

### DID na Wallet

```ts
const did = await createDid('issuer-wallet', 'senha forte', {
  label: 'Emissor mobile',
  mldsa: 'ML-DSA-65',
  mlkem: 'ML-KEM-768',
  createdAt: new Date().toISOString(),
});

const didDocument = await getDidDocument('issuer-wallet', 'senha forte', did.did);
```

O retorno de `createDid` não contém `privateKeys`.

### Schema e Credencial

```ts
const attributes = {
  name: 'Ana Silva',
  course: 'Post-Quantum Credentials',
  level: 'mobile',
};

const schema = await createSchemaFromAttributes(attributes, {
  version: '1',
  createdAt: new Date().toISOString(),
});

const signedCredential = await issueCredentialFromSchema(
  'issuer-wallet',
  'senha forte',
  did.did,
  schema,
  attributes,
  {
    credentialId: 'cred-mobile-001',
    issuedAt: new Date().toISOString(),
    visiblePaths: ['name', 'course'],
    credentialVersion: 'v2',
  },
);
```

A assinatura da credencial usa a chave ML-DSA dentro da wallet cifrada.

### PDF de Credencial

Use URIs reais acessíveis pelo app:

```ts
const result = await embedSignedCredentialInPdf({
  walletName: 'issuer-wallet',
  password: 'senha forte',
  did: did.did,
  inputUri: inputPdfUri,
  outputUri: outputPdfUri,
  signedCredential,
  options: {
    createdAt: new Date().toISOString(),
  },
});

const verification = await verifySignedCredentialPdf(outputPdfUri, didDocument);
```

### PDF Genérico

```ts
const result = await signGenericPdf({
  walletName: 'issuer-wallet',
  password: 'senha forte',
  did: did.did,
  inputUri: inputPdfUri,
  outputUri: outputPdfUri,
  options: {
    createdAt: new Date().toISOString(),
    visualSignature: {
      mode: 'visible',
      placement: 'firstPageFooter',
      text: 'Assinado com SSI-PQ',
    },
  },
});

const verification = await verifySignedGenericPdf(outputPdfUri, didDocument);
```

### ML-KEM pela Wallet

```ts
const sharedSecret = await mlkemDecapsulate(
  'issuer-wallet',
  'senha forte',
  did.did,
  ciphertextBase64url,
);
```

Use este retorno com cuidado: shared secret não deve ser logado, enviado para
analytics nem persistido em JS.

## Facade Node-Compatible

Para migração de código Node, existe:

```ts
import * as ssiPqNodeCompat from '@ssi-pq/react-native/node-compatible';
```

Ela fornece aliases com nomes próximos da lib Node. APIs que seriam perigosas
no mobile, como keygen com retorno de private key ou assinatura recebendo private
key em JS, ficam em `unsafe` e lançam erro orientando o caminho seguro.

## Diferenças Importantes em Relação ao Node

Node:

- usa caminhos de arquivo e SQLCipher wallet;
- algumas APIs de teste retornam private keys;
- PDFs podem trafegar como `Buffer`.

React Native:

- usa `walletName` em vez de path SQLCipher;
- usa wallet cifrada pelo core em storage privado do app;
- não retorna private key na API pública;
- APIs de PDF preferem `inputUri`/`outputUri`;
- métodos retornam `Promise`;
- Android/iOS executam trabalho pesado fora da thread de UI.

## Segurança

Baseline:

- wallet cifrada pelo core, por senha/KDF;
- storage privado por app;
- private keys internas a wallet;
- erro de senha inválida sem detalhes de corrupção;
- temporários Android de `content://` removidos em `finally`;
- iOS usa Application Support excluído de backup;
- buffers sensíveis no core usam `zeroize` onde possível.

Keystore/Keychain/biometria:

- não fazem parte da baseline para manter paridade com Node/WASM;
- podem ser adicionados futuramente como hardening opcional;
- não devem substituir a assinatura ML-DSA do protocolo.

Auditoria:

```sh
npm run security:audit
```

## Interoperabilidade com Node/WASM

Vetores ficam em:

```text
test-vectors/
```

Verificação Node:

```sh
npm run vectors:verify:node
```

Verificação WASM:

```sh
npm run vectors:verify:wasm
```

O objetivo de consumo mobile é:

- PDF assinado no mobile verifica na lib Node;
- PDF assinado no Node verifica no mobile;
- credencial emitida no mobile verifica em Node/WASM;
- DID Document mobile verifica em Node/WASM;
- adulterações de PDF, manifesto e credencial continuam falhando.

## Checklist para Publicar a Lib

Antes de publicar:

```sh
cargo test --workspace
npm test
npm run test:wasm
npm run ci:react-native
npm run security:audit
npm run vectors:verify:node
npm run vectors:verify:wasm
scripts/build-mobile-android.sh
scripts/check-mobile-android-artifacts.sh
scripts/test-mobile-android-flow.sh
scripts/test-mobile-android-nested-labels-flow.sh
```

No macOS:

```sh
scripts/build-mobile-ios.sh
REQUIRE_XCFRAMEWORK=1 scripts/check-mobile-ios-artifacts.sh
pod lib lint packages/react-native/ios/SsiPqReactNative.podspec --allow-warnings --skip-tests
```

Empacotamento:

```sh
cd packages/react-native
npm pack --dry-run
```

Publicação:

```sh
npm publish --access public
```

Ver detalhes em:

```text
PUBLICACAO_VERSIONAMENTO.md
```

## O Que a Lib Não Entrega

Este pacote não entrega:

- aplicativo Android final;
- aplicativo iOS final;
- telas, navegação ou UX;
- seletores de arquivo/PDF;
- política de backup/sync do produto;
- backend de distribuição de DID Document;
- app iOS exemplo completo com Xcode;
- app Android de produto com UI final.

O repositório entrega um app Android mínimo de teste instrumentado com Gradle,
mas ele existe para validar a biblioteca, não para servir como aplicação final.

O app consumidor deve fornecer esses elementos e chamar a API da lib.

## Arquivos de Referência

- `MANUAL_FUNCOES_LIB_MOBILE.md`
- `packages/react-native/README.md`
- `packages/react-native/example/minimal-flow.ts`
- `MATRIZ_PARIDADE_NODE_MOBILE.md`
- `SEGURANCA_REVISAO_FASE_8.md`
- `PUBLICACAO_VERSIONAMENTO.md`
- `test-vectors/README.md`
