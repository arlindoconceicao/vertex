# Plano para biblioteca mobile React Native compatível com a lib Node.js

Data-base: 2026-06-29

## Objetivo

Criar uma biblioteca mobile para Android e iOS consumível por React Native, mantendo compatibilidade comportamental com a biblioteca Node.js atual (`@ssi-pq/core`) e reutilizando o mesmo núcleo Rust (`ssi-pq-core`) para criptografia pós-quântica, DID, credenciais, PDF, wallet e validações.

A compatibilidade desejada é:

- mesmos formatos públicos de DID Document, credencial assinada, manifesto PDF, assinaturas ML-DSA, encapsulamento ML-KEM, AES-GCM, hashes e canonicalização;
- mesmos invariantes de segurança já exercitados nos testes Node/WASM;
- APIs React Native ergonômicas e assíncronas;
- chaves privadas protegidas no armazenamento nativo, sem exportação normal para JavaScript;
- empacotamento Android/iOS pronto para app React Native e para publicação como pacote npm.

## Referências do projeto

- `ARQUITETURA_MULTIPLATAFORMA.md`: define core Rust único, adaptadores por plataforma, UniFFI para mobile e TurboModule para React Native.
- `MATRIZ_PARIDADE_NODE_WASM.md`: congela a superfície Node/WASM atual e deve servir como base para a matriz Node/Mobile.
- `crates/ssi-pq-core`: núcleo portável.
- `crates/ssi-pq-node`: addon Node N-API atual.
- `crates/ssi-pq-wasm`: adapter WASM com facade Node-compatible.
- `crates/ssi-pq-mobile-ffi`: adapter UniFFI inicial para Android/iOS.

## Referências externas

- React Native Turbo Native Modules: https://reactnative.dev/docs/turbo-native-modules-introduction
- React Native Codegen: https://reactnative.dev/docs/the-new-architecture/what-is-codegen
- UniFFI: https://mozilla.github.io/uniffi-rs/latest/

## Estado atual verificado

O projeto já possui a separação principal em workspace:

```text
crates/
  ssi-pq-core/
  ssi-pq-node/
  ssi-pq-wasm/
  ssi-pq-mobile-ffi/
packages/
  web/
  wasm-node/
```

Validações realizadas:

- `cargo test --workspace`: passou.
- `npm test`: passou para a suíte Node.
- `npm run test:wasm`: passou para a suíte WASM/paridade.
- `cargo build -p ssi-pq-mobile-ffi --release`: passou para Linux host, gerando `.so` e `.a`.

Estado atual implementado:

- `ssi-pq-core` possui `wallet-core`, sem SQLite, e `wallet_storage` sobre a trait `Storage`.
- `ssi-pq-node` continua usando SQLCipher/arquivo, adequado para Node.
- `ssi-pq-wasm` já prova uma estratégia de paridade por facade.
- `ssi-pq-mobile-ffi` usa UniFFI com `uniffi::setup_scaffolding!()`.
- `ssi-pq-mobile-ffi` ativa `wallet-core`.
- scripts Android/iOS geram bindings UniFFI Kotlin/Swift.
- `packages/react-native` existe com TurboModule Android/iOS, API TypeScript segura e facade `node-compatible.ts`.
- `test-vectors/` existe com vetores Node e verificadores Node/WASM.
- CI Android/iOS existe; Android roda em Linux e iOS roda em macOS.

Lacunas atuais do mobile/app exemplo:

- `packages/react-native/example` ainda é exemplo TypeScript minimo; ainda não há projetos nativos `example/android` e `example/ios`.
- O `SsiPqMobile.xcframework` precisa ser gerado em macOS/Xcode antes de publicação iOS.
- Testes instrumentados Android/iOS e vetores gerados nativamente por Android/iOS ainda dependem dos apps exemplo nativos.

## Decisões de arquitetura

### 1. Não usar o addon N-API no React Native

O addon `.node` é para runtime Node.js. React Native roda JavaScript em Hermes ou JavaScriptCore e deve chamar código nativo por Turbo Native Modules. O caminho mobile será:

```text
TypeScript React Native
  -> TurboModule gerado por Codegen
  -> Kotlin/Swift fino
  -> bindings UniFFI gerados
  -> ssi-pq-mobile-ffi
  -> ssi-pq-core
```

### 2. Manter duas camadas de API

Camada pública de produto:

- wallet por `walletName`/`did`;
- assinatura por `inputUri`/`outputUri`;
- operações pesadas retornam `Promise`;
- nenhuma chave privada retorna ao JavaScript;
- erros normalizados.

Camada de compatibilidade/paridade:

- funções de helpers, hash, encoding, ML-DSA, ML-KEM, AES-GCM, DID, schema, credencial e PDF com semântica equivalente à Node/WASM;
- útil para migração, testes e interoperabilidade;
- APIs que exportam private key devem ser marcadas como `unsafe`, `test-only` ou ficar fora da API pública padrão.

### 3. Wallet mobile baseada em `wallet_storage`

Node usa SQLCipher em arquivo. Mobile deve usar `wallet_storage` do core com backend nativo:

- Android: armazenamento privado do app para estado cifrado pelo core, mantendo paridade com Node/WASM;
- iOS: armazenamento privado do app para estado cifrado pelo core, mantendo paridade com Node/WASM;
- o core continua assinando ML-DSA via `libcrux`, preservando compatibilidade.

Decisão atual: Keystore/Keychain/biometria não fazem parte do critério de aceite
da wallet RN inicial. Eles podem entrar depois como hardening opcional local,
sem alterar o formato da wallet cifrada nem o contrato de interoperabilidade.

### 4. PDFs grandes por URI

Para React Native, APIs de PDF devem preferir URI/arquivo:

```ts
signGenericPdf({
  walletName,
  did,
  inputUri,
  outputUri,
  options,
}): Promise<SignPdfResult>
```

Funções com `Uint8Array`/bytes podem existir para arquivos pequenos, testes e camada técnica, mas não devem ser o caminho principal do app.

### 5. Hardware ML-DSA é POC separado

Android Keystore e Secure Enclave podem proteger segredos de wallet, mas não devem substituir a assinatura ML-DSA do protocolo por ECDSA/P-256. Qualquer assinatura ML-DSA direta em hardware deve ser uma POC condicionada a vetores de interoperabilidade.

## Estrutura alvo

```text
crates/
  ssi-pq-core/
  ssi-pq-node/
  ssi-pq-wasm/
  ssi-pq-mobile-ffi/
packages/
  react-native/
    package.json
    src/
      index.ts
      node-compatible.ts
      NativeSsiPq.ts
      types.ts
    android/
      build.gradle
      src/main/AndroidManifest.xml
      src/main/java/com/ssipq/reactnative/
      src/main/jniLibs/
    ios/
      SsiPqReactNative.podspec
      Sources/
      Frameworks/
    example/
test-vectors/
  foundation/
  pq/
  did/
  credential/
  pdf/
scripts/
  build-mobile-android.sh
  build-mobile-ios.sh
  generate-mobile-bindings.sh
```

## Matriz de compatibilidade Node -> React Native

| Grupo | Exports Node | Estratégia mobile |
| --- | --- | --- |
| Foundation | `supportedProfiles`, `canonicalJson`, `canonicalJsonHashBase64url`, `sha3_256Base64url`, `sha3_256Hex` | Expor em UniFFI e em TypeScript com mesmos nomes ou aliases Node-compatible. |
| Encoding | `base64urlEncode`, `base64urlDecode` | Expor para paridade e testes. |
| AES-GCM | `aes256GcmEncrypt`, `aes256GcmDecrypt` | Expor para paridade; avaliar se entra na API pública de produto. |
| ML-DSA | `mldsaGenerateKeypair`, `mldsaSign`, `mldsaVerify` | Expor como API técnica; evitar uso normal com private key no JS. |
| ML-KEM | `mlkemGenerateKeypair`, `mlkemEncapsulate`, `mlkemDecapsulate` | Expor como API técnica; wallet deve usar `walletMlkemDecapsulate`. |
| DID | `createDid`, `didVerify`, `didFingerprintMatchesKeys`, `issuerIdentifierBase64` | Verificação pública; criação com private keys deve ser técnica/test-only. Produto cria DID via wallet. |
| Schema | `createSchemaFromAttributes`, `schemaHashBase64` | Expor com JSON textual/objetos TS. |
| Credential | `issueCredentialFromSchema`, `verifySignedCredential` | Verificação pública; emissão de produto deve usar wallet sem private key no JS. |
| PDF credencial | `signedCredentialToPdf`, `embedSignedCredentialInPdf`, `extractCredentialManifestFromPdf`, `verifySignedCredentialPdf` | Expor bytes para paridade e URI para produto. |
| PDF genérico | `extractGenericSignatureManifestFromPdf`, `verifySignedGenericPdf` | Expor bytes e URI. |
| Wallet | `walletCreate`, `walletOpen`, `walletChangePassword`, `walletCreateDid`, `walletListDids`, `walletGetDidDocument`, `walletIssueCredentialFromSchema`, `walletEmbedSignedCredentialInPdf`, `walletSignGenericPdf`, `walletMlkemDecapsulate` | Expor com `walletName`/storage nativo, não `path`; todos assíncronos no RN. |
| Node-only | `canonicalJsonFile` | Não portar literalmente. Em mobile usar leitura nativa por URI ou JS lendo texto e chamando `canonicalJson`. |

## Fase 0: congelar contrato de paridade mobile

1. Criar `MATRIZ_PARIDADE_NODE_MOBILE.md`.
2. Copiar a lista de exports de `MATRIZ_PARIDADE_NODE_WASM.md`.
3. Para cada export, definir:
   - nome Node;
   - nome UniFFI;
   - nome TypeScript RN;
   - status;
   - decisão de segurança;
   - teste obrigatório.
4. Definir a versão mínima inicial:
   - React Native: fixar versão de referência do pacote;
   - Android: `minSdk`, `compileSdk`, NDK;
   - iOS: versão mínima de iOS;
   - Rust targets.
5. Definir política de APIs perigosas:
   - private keys nunca retornam na API pública padrão;
   - helpers de chave explícita entram em namespace técnico ou teste.

Critério de aceite:

- matriz revisada e com todos os exports Node classificados.

## Fase 1: completar `ssi-pq-mobile-ffi`

1. Ativar `wallet-core` no `crates/ssi-pq-mobile-ffi/Cargo.toml`:

```toml
ssi-pq-core = { path = "../ssi-pq-core", default-features = false, features = ["wallet-core"] }
```

2. Adicionar exports UniFFI para helpers puros:
   - `base64url_encode`;
   - `base64url_decode`;
   - `sha3_256_base64url`;
   - `sha3_256_hex`;
   - `canonical_json_hash_base64url`;
   - `secure_random_key`;
   - `schema_hash_base64`;
   - `issuer_identifier_base64`.

3. Adicionar exports UniFFI para primitivas PQ:
   - `mldsa_generate_keypair`;
   - `mldsa_sign`;
   - `mldsa_verify`;
   - `mlkem_generate_keypair`;
   - `mlkem_encapsulate`;
   - `mlkem_decapsulate`;
   - `aes256_gcm_encrypt`;
   - `aes256_gcm_decrypt`.

4. Adicionar exports UniFFI para DID/credencial/PDF sem wallet:
   - `create_did_json`;
   - `issue_credential_from_schema_json`;
   - `embed_signed_credential_in_pdf`;
   - `extract_generic_signature_manifest_from_pdf`;
   - `verify_signed_generic_pdf`.

5. Adicionar records UniFFI para resultados binários frequentes:
   - `KeyPair`;
   - `MlkemEncapsulation`;
   - `Aes256GcmEncryption`;
   - `FileOperationResult`;
   - `WalletInfo`;
   - `WalletDidSummary`.

6. Melhorar erros:
   - separar `InvalidInput`, `Crypto`, `Wallet`, `Pdf`, `Storage`, `Io`, `Unavailable`;
   - preservar mensagem do core;
   - mapear para exceções Kotlin/Swift e para erro JS normalizado.

Critério de aceite:

- `cargo test -p ssi-pq-mobile-ffi`;
- `cargo build -p ssi-pq-mobile-ffi --release`;
- bindings Kotlin/Swift geram sem erro.

## Fase 2: storage mobile e wallet segura

1. Criar uma abstração UniFFI ou Rust interna para storage mobile:
   - `MobileStorage.get(key)`;
   - `MobileStorage.put(key, bytes)`;
   - `MobileStorage.delete(key)`;
   - `MobileStorage.listPrefix(prefix)` se necessário para manutenção/export.

2. Implementar Android:
   - diretório privado do app para estado cifrado;
   - wallet cifrada pelo core, por senha/KDF, para manter paridade com Node/WASM;
   - Android Keystore/biometria apenas como hardening opcional futuro;
   - limpeza de memória temporária quando possível.

3. Implementar iOS:
   - arquivos privados do app para estado cifrado;
   - wallet cifrada pelo core, por senha/KDF, para manter paridade com Node/WASM;
   - Keychain/`SecAccessControl`/biometria apenas como hardening opcional futuro;
   - avaliar Secure Enclave somente como POC ML-DSA futura, sem substituir a wallet cifrada.

4. Expor wallet no UniFFI:
   - `wallet_create_json(wallet_name, password, options_json)`;
   - `wallet_open_json(wallet_name, password)`;
   - `wallet_change_password_json(wallet_name, old_password, new_password)`;
   - `wallet_create_did_json(wallet_name, password, options_json)`;
   - `wallet_list_dids_json(wallet_name, password)`;
   - `wallet_get_did_document_json(wallet_name, password, did)`;
   - `wallet_issue_credential_from_schema_json(...)`;
   - `wallet_embed_signed_credential_in_pdf_bytes(...)`;
   - `wallet_sign_generic_pdf_bytes(...)`;
   - `wallet_mlkem_decapsulate(...)`.

5. Criar variantes por URI:
   - `wallet_embed_signed_credential_in_pdf_file(...)`;
   - `wallet_sign_generic_pdf_file(...)`;
   - `verify_signed_credential_pdf_file(...)`;
   - `verify_signed_generic_pdf_file(...)`.

Critério de aceite:

- o fluxo wallet -> DID -> credencial -> PDF -> verificação funciona em Android e iOS sem exportar private key para JS;
- PDF assinado no mobile verifica no Node;
- PDF assinado no Node verifica no mobile.

## Fase 3: build Android

1. Instalar targets Rust:

```bash
rustup target add aarch64-linux-android x86_64-linux-android
```

2. Definir NDK e `cargo-ndk`.
3. Criar script `scripts/build-mobile-android.sh`.
4. Gerar `.so` para:
   - `arm64-v8a`;
   - `x86_64`.
5. Copiar artefatos para:

```text
packages/react-native/android/src/main/jniLibs/arm64-v8a/libssi_pq_mobile_ffi.so
packages/react-native/android/src/main/jniLibs/x86_64/libssi_pq_mobile_ffi.so
```

6. Gerar bindings Kotlin UniFFI para `packages/react-native/android/src/main/java/...`.
7. Criar `build.gradle` do pacote RN.
8. Criar `NativeSsiPqModule.kt` implementando a interface gerada pelo Codegen.
9. Criar `SsiPqPackage.kt` para registro/autolinking.
10. Verificar o AAR/APK final para confirmar presença das bibliotecas nativas.

Critério de aceite:

- app exemplo Android compila;
- módulo carrega em Hermes;
- chamadas básicas funcionam em aparelho/emulador;
- fluxo wallet/PDF roda fora da thread de UI.

## Fase 4: build iOS

1. Instalar targets Rust:

```bash
rustup target add aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios
```

2. Criar script `scripts/build-mobile-ios.sh`.
3. Compilar `staticlib` para device e simuladores.
4. Gerar bindings Swift UniFFI.
5. Criar headers/modulemap quando necessário.
6. Gerar `SsiPqMobile.xcframework`.
7. Criar `packages/react-native/ios/SsiPqReactNative.podspec`.
8. Criar wrapper Swift do TurboModule.
9. Criar cola Objective-C++ apenas se necessária para compatibilidade com Codegen.
10. Rodar `pod install` no app exemplo.

Critério de aceite:

- app exemplo iOS compila no simulador;
- build de device gera sem erro;
- módulo carrega no RN;
- fluxo wallet/PDF executa com arquivos reais.

## Fase 5: pacote React Native

1. Criar `packages/react-native/package.json`.
2. Definir `codegenConfig`:

```json
{
  "codegenConfig": {
    "name": "SsiPqSpec",
    "type": "modules",
    "jsSrcsDir": "src",
    "android": {
      "javaPackageName": "com.ssipq.reactnative"
    }
  }
}
```

3. Criar spec TypeScript `src/NativeSsiPq.ts`:
   - importar `TurboModule`;
   - usar `TurboModuleRegistry.getEnforcing`;
   - declarar métodos assíncronos como `Promise<T>`.

4. Criar `src/index.ts` com API segura:
   - `supportedProfiles`;
   - `createWallet`;
   - `openWallet`;
   - `createDid`;
   - `listDids`;
   - `getDidDocument`;
   - `issueCredentialFromSchema`;
   - `signGenericPdf`;
   - `embedSignedCredentialInPdf`;
   - `verifySignedCredentialPdf`;
   - `verifySignedGenericPdf`;
   - `mlkemDecapsulate`.

5. Criar `src/node-compatible.ts`:
   - aliases com nomes Node;
   - diferenças documentadas;
   - funções inseguras isoladas ou omitidas.

6. Criar `src/types.ts`:
   - tipos de opções;
   - resultados;
   - erros;
   - enumerações de perfil.

7. Criar testes TypeScript para serialização de inputs/outputs.
8. Criar exemplo mínimo:
   - criar wallet;
   - criar DID;
   - emitir credencial;
   - assinar PDF;
   - verificar PDF.

Critério de aceite:

- pacote instala via `yarn/npm`;
- autolinking funciona;
- TypeScript compila;
- app exemplo roda Android/iOS.

## Fase 6: vetores de interoperabilidade

Criar `test-vectors/` com:

- canonicalização JSON;
- SHA3/base64url;
- ML-DSA assinar/verificar;
- ML-KEM encapsular/decapsular;
- AES-GCM cifrar/decifrar;
- DID Document válido e adulterado;
- credencial assinada válida e adulterada;
- PDF de credencial válido e adulterado;
- PDF genérico válido e adulterado;
- fluxo wallet com DID, credencial e PDF.

Cada vetor deve ter:

- entrada;
- saída esperada;
- hash de arquivos grandes;
- plataforma geradora;
- plataformas que devem verificar.

Critério de aceite:

- Node gera vetores que Android/iOS verificam;
- Android gera vetores que Node/WASM/iOS verificam;
- iOS gera vetores que Node/WASM/Android verificam.

## Fase 7: testes e CI

Pipeline mínimo:

1. Linux:
   - `cargo test --workspace`;
   - `npm test`;
   - `npm run test:wasm`.

2. Mobile FFI:
   - `cargo build -p ssi-pq-mobile-ffi --release`;
   - gerar bindings Kotlin/Swift;
   - lint ou compile dos wrappers.

3. Android:
   - build `arm64-v8a`;
   - build `x86_64`;
   - Gradle build;
   - testes instrumentados no emulador;
   - verificar presença de `.so` no APK/AAR.

4. iOS:
   - build device;
   - build simulator;
   - gerar XCFramework;
   - `pod lib lint` ou build do app exemplo;
   - testes no simulador.

5. Interoperabilidade:
   - rodar vetores compartilhados em Node;
   - rodar vetores compartilhados em Android;
   - rodar vetores compartilhados em iOS;
   - rodar vetores WASM quando aplicável.

## Fase 8: segurança e revisão

Checklist obrigatório:

- private key não aparece em retorno da API pública RN;
- senha, private key e shared secret não são logados;
- operações de assinatura e PDF não rodam na thread de UI;
- buffers sensíveis usam `zeroize` onde possível;
- estado da wallet é cifrado;
- wallet mobile usa o mesmo modelo de wallet cifrada do core para manter paridade Node/WASM;
- Keystore/Keychain é hardening opcional futuro, não critério de aceite inicial;
- erro de senha inválida não vaza detalhes de corrupção;
- arquivos temporários são removidos ou ficam no diretório privado;
- APIs `unsafe` são claramente separadas;
- os documentos gerados continuam verificáveis pela lib Node.

## Ordem de execução recomendada

1. Criar `MATRIZ_PARIDADE_NODE_MOBILE.md`.
2. Expandir `ssi-pq-mobile-ffi` com helpers puros e primitivas PQ.
3. Ativar `wallet-core` no mobile.
4. Expor wallet storage em UniFFI.
5. Criar scripts de geração UniFFI Kotlin/Swift.
6. Criar build Android com `.so` e bindings Kotlin.
7. Criar build iOS com `XCFramework` e bindings Swift.
8. Criar pacote `packages/react-native`.
9. Implementar TurboModule Android.
10. Implementar TurboModule iOS.
11. Criar API TypeScript segura.
12. Criar facade `node-compatible.ts`.
13. Criar app exemplo.
14. Criar `test-vectors/`.
15. Adicionar CI Android/iOS.
16. Rodar testes cruzados Node/WASM/Android/iOS.
17. Documentar publicação e versionamento.

## Definition of Done

A biblioteca mobile será considerada compatível com a lib Node.js quando:

- todas as APIs Node portáveis tiverem equivalente mobile direto, facade ou justificativa documentada;
- fluxos principais passarem em Node, WASM, Android e iOS;
- PDFs assinados em qualquer plataforma forem verificados pelas demais;
- credenciais assinadas em qualquer plataforma forem verificadas pelas demais;
- wallet mobile assinar sem exportar private key para JavaScript;
- pacote React Native instalar por npm/yarn e autolinking;
- Android gerar AAR/APK com `arm64-v8a` e `x86_64`;
- iOS gerar `XCFramework` consumível por CocoaPods;
- testes de adulteração continuarem falhando corretamente;
- documentação de uso e segurança estiver publicada junto ao pacote.
