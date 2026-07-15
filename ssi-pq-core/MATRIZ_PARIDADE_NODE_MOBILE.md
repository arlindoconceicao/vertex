# Matriz de paridade Node.js / React Native Mobile

Data-base: 2026-06-29

Auditoria de codigo: 2026-07-14

Esta matriz congela a superficie publica atual do addon Node (`npm/ssi_pq_core.node`)
e define o contrato alvo para a biblioteca mobile React Native. A lista de exports
foi copiada da matriz Node/WASM em `MATRIZ_PARIDADE_NODE_WASM.md`.

O objetivo da paridade mobile e comportamental: Android/iOS devem gerar, assinar,
persistir, extrair, decapsular, cifrar/decifrar e verificar com os mesmos formatos
e invariantes publicos da lib Node.js. A API mobile nao precisa copiar literalmente
os parametros Node quando isso quebrar o modelo de seguranca mobile.

## Versoes minimas iniciais

| Item | Versao/valor fixado | Observacao |
|---|---:|---|
| React Native | `0.86` | Versao stable/latest em 2026-06-29. Usar Turbo Native Modules e Codegen. |
| Android `minSdkVersion` | `24` | Valor do template React Native `0.86.0`. |
| Android `compileSdkVersion` | `36` | Valor do template React Native `0.86.0`. |
| Android `targetSdkVersion` | `36` | Valor do template React Native `0.86.0`. |
| Android Build Tools | `36.0.0` | Valor recomendado pelo ambiente RN 0.86/template. |
| Android NDK | `27.1.12297006` | Valor do template React Native `0.86.0`. |
| Kotlin | `2.1.20` | Valor do template React Native `0.86.0`. |
| JDK | `17` | Recomendacao atual da documentacao React Native para Android. |
| iOS minimo | `15.1` | Valor inicial para o pacote; revisar contra `min_ios_version_supported` ao criar Podspec. |
| Xcode | versao mais recente estavel | Necessario para build iOS com native code e XCFramework. |
| Rust Android targets | `aarch64-linux-android`, `x86_64-linux-android` | `arm64-v8a` para aparelhos reais e `x86_64` para emulador. |
| Rust iOS targets | `aarch64-apple-ios`, `aarch64-apple-ios-sim`, `x86_64-apple-ios` | Device e simuladores Apple Silicon/Intel. |

Referencias externas verificadas:

- React Native versions: https://reactnative.dev/versions
- Turbo Native Modules: https://reactnative.dev/docs/turbo-native-modules-introduction
- Codegen: https://reactnative.dev/docs/the-new-architecture/what-is-codegen
- React Native environment setup: https://reactnative.dev/docs/set-up-your-environment
- React Native 0.86 template Android build: https://raw.githubusercontent.com/react-native-community/template/0.86.0/template/android/build.gradle

## Politica de APIs perigosas

- Private keys nunca retornam na API publica padrao React Native.
- Senhas, private keys, row keys, shared secrets e material de assinatura nao podem ser logados.
- APIs que recebem ou retornam private key explicita ficam em namespace tecnico/test-only, por exemplo `unsafe.*`, e nao aparecem no fluxo principal de produto.
- DID de produto deve ser criado por wallet: `walletCreateDid`, nao por `createDid` retornando `privateKeys`.
- Assinatura de produto deve usar wallet e DID/key id: `walletSignGenericPdf` ou `walletEmbedSignedCredentialInPdf`, nao `mldsaSign` com chave privada no JS.
- ML-KEM de produto deve usar `walletMlkemDecapsulate`; `mlkemDecapsulate` com chave privada explicita e tecnico/test-only.
- APIs de PDF para React Native devem preferir `inputUri`/`outputUri`; variantes em bytes existem para testes, arquivos pequenos e paridade.
- `canonicalJsonFile(path)` nao sera portado literalmente; mobile deve usar URI nativa ou ler texto e chamar `canonicalJson`.
- A API publica RN deve ser assincrona para wallet, PDF, storage e operacoes criptograficas pesadas. Biometria/KeyStore/Keychain ficam fora da baseline de paridade e podem entrar apenas como hardening opcional futuro.

## Estado verificado no codigo

A auditoria de 2026-07-14 comparou:

- exports Node em `crates/ssi-pq-node/src/lib.rs`;
- metodos UniFFI em `crates/ssi-pq-mobile-ffi/src/lib.rs`;
- especificacao TurboModule em `packages/react-native/src/NativeSsiPq.ts`;
- facade publica segura em `packages/react-native/src/index.ts`;
- facade de migracao em `packages/react-native/src/node-compatible.ts`;
- wrapper Android em `packages/react-native/android/src/main/java/com/ssipq/reactnative/NativeSsiPqModule.kt`;
- ponte iOS em `packages/react-native/ios/Sources/SsiPqReactNative.swift` e
  `packages/react-native/ios/Sources/SsiPqReactNativeBridge.mm`;
- pacote CocoaPods em `packages/react-native/ios/SsiPqReactNative.podspec`.

Resultado:

- o addon Node expoe 41 funcoes publicas;
- o UniFFI mobile cobre os 41 recursos portaveis do Node, exceto `canonicalJsonFile` literal, que e intencionalmente substituido por leitura mobile/URI/texto;
- a API React Native segura expoe apenas o subconjunto de produto que nao passa private key pelo JavaScript;
- `src/index.ts` tambem expoe aliases de conveniencia de produto como
  `issueCredential`, `signPdf`, `verifyCredentialPdf` e `verifyGenericPdf`;
- algumas funcoes tecnicas existem no UniFFI e nos bindings Kotlin/Swift gerados, mas nao estao no TurboModule nem em `src/index.ts`;
- `src/node-compatible.ts` contem aliases de migracao, mas varios aliases `unsafe` apenas lancam erro com alternativa segura; eles nao executam a operacao tecnica.

## Status

- `OK UniFFI, pendente RN`: o crate `ssi-pq-mobile-ffi` ja expoe a capacidade, mas ainda falta pacote React Native/TypeScript.
- `OK UniFFI/RN`: capacidade exposta no UniFFI, TurboModule e TypeScript seguro atual.
- `OK UniFFI/RN, formato RN diferente`: capacidade exposta no RN atual, mas o retorno mobile e mais estruturado do que o retorno booleano/Buffer equivalente do Node.
- `OK UniFFI, nao exposto RN atual`: capacidade existe para camada tecnica/bindings Kotlin/Swift gerados, mas nao esta no TurboModule nem na API TypeScript atual.
- `OK UniFFI, alternativa segura RN`: capacidade tecnica existe no UniFFI, mas a API RN atual oferece um fluxo seguro equivalente por wallet/URI; aliases `unsafe` da facade de migracao apenas lancam erro.
- `Pendente UniFFI/RN`: a capacidade existe no core, mas ainda precisa ser exportada no UniFFI e no TurboModule.
- `Pendente API segura`: a capacidade existe, mas o contrato mobile deve ser ajustado para nao expor segredo ao JS.
- `N/A literal, alternativa mobile`: a API Node depende de path/filesystem de forma inadequada para mobile; sera substituida por URI/texto.
- `Test-only/unsafe`: export permitido apenas para paridade, testes e migracao controlada. No estado atual, isso significa UniFFI/bindings tecnicos, nao API RN publica.

## Matriz principal: exports do Node

| Nome Node | Nome UniFFI alvo | Nome TypeScript RN alvo | Status | Decisao de seguranca | Teste obrigatorio |
|---|---|---|---|---|---|
| `aes256GcmDecrypt` | `aes256_gcm_decrypt` | nenhum no RN atual | OK UniFFI, nao exposto RN atual | Tecnico/test-only quando a chave vier do JS; produto deve preferir wallet/storage nativo. | Vetor AES-GCM Node -> UniFFI mobile e mobile -> Node com AAD e adulteracao de tag/ciphertext. |
| `aes256GcmEncrypt` | `aes256_gcm_encrypt` | nenhum no RN atual | OK UniFFI, nao exposto RN atual | Tecnico/test-only quando a chave vier do JS; nao logar key/nonce/tag. | Vetor AES-GCM com tamanho de chave invalido, roundtrip e AAD divergente. |
| `base64urlDecode` | `base64url_decode` | `base64urlDecodeToBase64` | OK UniFFI/RN | Seguro publico; validar erro para input invalido. | Paridade byte a byte com Node para padding ausente e caracteres invalidos. |
| `base64urlEncode` | `base64url_encode` | `base64urlEncode` | OK UniFFI/RN | Seguro publico. | Paridade com Node para bytes vazios, binarios e UTF-8. |
| `canonicalJson` | `canonical_json` | `canonicalJson` | OK UniFFI/RN | Seguro publico. | Casos RFC/JCS, ordenacao de chaves, arrays e rejeicao de propriedades duplicadas. |
| `canonicalJsonFile` | nenhum literal | `canonicalJsonFile` na facade node-compatible lanca erro; sem `canonicalJsonFromUri` atual | N/A literal, alternativa mobile | Nao aceitar path Node cru como contrato principal; usar URI nativa ou texto e chamar `canonicalJson`. | Ler JSON via URI/texto no app exemplo e comparar com `canonicalJson` Node. |
| `canonicalJsonHashBase64url` | `canonical_json_hash_base64url` | `canonicalJsonHashBase64url` | OK UniFFI/RN | Seguro publico. | Hash igual para JSON com chaves em ordem diferente; erro para JSON invalido. |
| `createDid` | `create_did_json` | `createDid` seguro cria DID via wallet; `unsafe.createDid` lanca erro | OK UniFFI, alternativa segura RN | Test-only/unsafe porque retorna private keys; produto deve usar `walletCreateDid`/`createDid` seguro. | DID criado por wallet RN verifica no Node; garantir que API publica padrao nao exporta private keys. |
| `createSchemaFromAttributes` | `create_schema_from_attributes` | `createSchemaFromAttributes` | OK UniFFI/RN | Seguro publico. | Schema aninhado RN igual ao Node em hash e estrutura logica. |
| `didFingerprintMatchesKeys` | `verify_did_document` | `verifyDidDocument`; node-compatible alias `didFingerprintMatchesKeys` retorna o resultado completo | OK UniFFI/RN, formato RN diferente | Seguro publico; RN retorna JSON de verificacao, nao booleano Node puro. | DID valido retorna `fingerprintMatchesKeys: true`; DID com key material adulterado retorna false nesse campo. |
| `didVerify` | `verify_did_document` | `verifyDidDocument`; node-compatible alias `didVerify` retorna o resultado completo | OK UniFFI/RN, formato RN diferente | Seguro publico; RN retorna JSON de verificacao, nao booleano Node puro. | DID Node verifica no RN e DID RN verifica no Node. |
| `embedSignedCredentialInPdf` | `embed_signed_credential_in_pdf` | `embedSignedCredentialInPdf` seguro usa wallet + URI; `unsafe.embedSignedCredentialInPdf` lanca erro | OK UniFFI, alternativa segura RN | Test-only/unsafe se receber private key no JS; produto deve usar wallet + URI. | PDF gerado por wallet RN verifica no Node; teste de troca de credential/manifest falha. |
| `extractCredentialManifestFromPdf` | `extract_credential_manifest_from_pdf` | nenhum no RN atual | OK UniFFI, nao exposto RN atual | Seguro publico possivel; ainda nao esta no TurboModule/API TS. | Extrair manifesto de PDF Node/mobile via UniFFI e comparar campos canonicos. |
| `extractGenericSignatureManifestFromPdf` | `extract_generic_signature_manifest_from_pdf` | nenhum no RN atual | OK UniFFI, nao exposto RN atual | Seguro publico possivel; ainda nao esta no TurboModule/API TS. | PDF generico assinado no Node tem manifesto extraido via UniFFI mobile. |
| `issueCredentialFromSchema` | `issue_credential_from_schema_json` | `issueCredentialFromSchema` seguro usa wallet; `unsafe.issueCredentialFromSchema` lanca erro | OK UniFFI, alternativa segura RN | Test-only/unsafe se receber private key no JS; produto deve usar `walletIssueCredentialFromSchema`. | Credencial emitida por wallet RN verifica no Node; API publica nao retorna nem recebe private key. |
| `issuerIdentifierBase64` | `issuer_identifier_base64` | nenhum no RN atual | OK UniFFI, nao exposto RN atual | Seguro publico, mas ainda nao esta no TurboModule/API TS. | Identificador igual no Node/UniFFI mobile para DID Document com chaves validas. |
| `mldsaGenerateKeypair` | `mldsa_generate_keypair` | `unsafe.mldsaGenerateKeypair` lanca erro | OK UniFFI, alternativa segura RN | Test-only/unsafe porque retorna private key; produto usa wallet. | Keypair UniFFI mobile assina/verifica no Node; API publica RN deve continuar sem private key. |
| `mldsaSign` | `mldsa_sign` | `unsafe.mldsaSign` lanca erro | OK UniFFI, alternativa segura RN | Test-only/unsafe porque recebe private key. Produto usa wallet. | Assinatura UniFFI mobile verifica no Node; contexto alterado falha. |
| `mldsaVerify` | `mldsa_verify` | nenhum no RN atual | OK UniFFI, nao exposto RN atual | Seguro publico; nao envolve private key, mas ainda nao esta no TurboModule/API TS. | Assinatura Node verifica via UniFFI mobile; mensagem/contexto adulterado falha. |
| `mlkemDecapsulate` | `mlkem_decapsulate` | `unsafe.mlkemDecapsulate` lanca erro | OK UniFFI, alternativa segura RN | Test-only/unsafe porque recebe private key; produto usa `walletMlkemDecapsulate`. | Ciphertext Node decapsula via UniFFI mobile; ciphertext adulterado falha. |
| `mlkemEncapsulate` | `mlkem_encapsulate` | nenhum no RN atual | OK UniFFI, nao exposto RN atual | Seguro publico; usa chave publica, mas ainda nao esta no TurboModule/API TS. | Encapsulamento UniFFI mobile decapsula no Node e vice-versa. |
| `mlkemGenerateKeypair` | `mlkem_generate_keypair` | `unsafe.mlkemGenerateKeypair` lanca erro | OK UniFFI, alternativa segura RN | Test-only/unsafe porque retorna private key; produto usa wallet. | Keypair UniFFI mobile interoperavel com Node; API publica RN deve continuar sem private key. |
| `schemaHashBase64` | `schema_hash_base64` | nenhum no RN atual | OK UniFFI, nao exposto RN atual | Seguro publico, mas ainda nao esta no TurboModule/API TS. | Hash igual para schema Node/UniFFI mobile e erro para schema invalido. |
| `secureRandomKey` | `secure_random_key` | nenhum no RN atual | OK UniFFI, nao exposto RN atual | Tecnico/test-only; nao usar como API de gestao de segredo de produto. | Tamanho correto, erro para zero, duas chamadas produzem valores diferentes. |
| `sha3_256Base64url` | `sha3_256_base64url` | `sha3_256Base64url` | OK UniFFI/RN | Seguro publico. | Vetores conhecidos e paridade com Node para bytes arbitrarios. |
| `sha3_256Hex` | `sha3_256_hex` | `sha3_256Hex` | OK UniFFI/RN | Seguro publico. | Vetor SHA3-256 vazio e bytes arbitrarios. |
| `signedCredentialToPdf` | `signed_credential_to_pdf` | nenhum no RN atual | OK UniFFI, nao exposto RN atual | Seguro publico para renderizacao; ainda nao esta no TurboModule/API TS. | PDF gerado via UniFFI mobile verifica manifesto e visual no Node. |
| `supportedProfiles` | `supported_profiles` | `supportedProfiles` | OK UniFFI/RN | Seguro publico; pode ser sincrono se o TurboModule suportar com baixo risco. | Lista igual ao Node: ML-DSA-44/65/87 e ML-KEM-512/768/1024. |
| `verifySignedCredential` | `verify_signed_credential` | `verifySignedCredential` | OK UniFFI/RN | Seguro publico. | Credencial Node/RN valida; Merkle root/proof adulterados falham. |
| `verifySignedCredentialPdf` | `verify_signed_credential_pdf_file`; `verify_signed_credential_pdf` tecnico por bytes | `verifySignedCredentialPdf` | OK UniFFI/RN | Seguro publico; API TypeScript segura recebe URI/arquivo. Variante por bytes existe no UniFFI tecnico. | PDF credencial Node verifica no RN; byte tamper falha. |
| `verifySignedGenericPdf` | `verify_signed_generic_pdf_file`; `verify_signed_generic_pdf` tecnico por bytes | `verifySignedGenericPdf` | OK UniFFI/RN | Seguro publico; API TypeScript segura recebe URI/arquivo. Variante por bytes existe no UniFFI tecnico. | PDF generico Node verifica no RN; manifesto/base hash adulterado falha. |
| `walletChangePassword` | `wallet_change_password_json` | `walletChangePassword` | OK UniFFI/RN | API publica segura; nunca retorna row key/private key; exige storage nativo. | Senha antiga deixa de abrir; senha nova preserva DID e assinatura. |
| `walletCreate` | `wallet_create_json` | `walletCreate` | OK UniFFI/RN | API publica segura; usar `walletName`, nao path SQLCipher. | Criar wallet RN, abrir RN, Node nao precisa ler storage bruto mas deve verificar artefatos produzidos. |
| `walletCreateDid` | `wallet_create_did_json` | `walletCreateDid` | OK UniFFI/RN | API publica preferida para DID; nao retorna private keys. | DID criado por wallet RN verifica no Node; inspecionar retorno sem private keys. |
| `walletEmbedSignedCredentialInPdf` | `wallet_embed_signed_credential_in_pdf_file` e `wallet_embed_signed_credential_in_pdf_bytes` | `walletEmbedSignedCredentialInPdf` | OK UniFFI/RN | API publica segura; assina com chave da wallet; preferir URI. | PDF credencial RN verifica no Node; ataques de swap/tamper falham. |
| `walletGetDidDocument` | `wallet_get_did_document_json` | `walletGetDidDocument` | OK UniFFI/RN | Seguro publico; retorna apenas DID Document. | DID Document retornado verifica no RN e Node. |
| `walletIssueCredentialFromSchema` | `wallet_issue_credential_from_schema_json` | `walletIssueCredentialFromSchema` | OK UniFFI/RN | API publica segura; assina com chave da wallet sem private key no JS. | Credencial emitida no RN verifica no Node e WASM. |
| `walletListDids` | `wallet_list_dids_json` | `walletListDids` | OK UniFFI/RN | Seguro publico; metadados sem segredos. | Lista ordenada por createdAt/did e sem material privado. |
| `walletMlkemDecapsulate` | `wallet_mlkem_decapsulate` | `walletMlkemDecapsulate` | OK UniFFI/RN | API publica controlada; retorna shared secret ao JS somente se fluxo exigir, preferir uso interno para decriptacao. | Ciphertext Node decapsula via wallet RN; segredo igual e nao logado. |
| `walletOpen` | `wallet_open_json` | `walletOpen` | OK UniFFI/RN | API publica segura; erro generico para senha invalida/corrupcao. | Senha correta abre; senha incorreta falha sem vazar detalhe sensivel. |
| `walletSignGenericPdf` | `wallet_sign_generic_pdf_file` e `wallet_sign_generic_pdf_bytes` | `walletSignGenericPdf` | OK UniFFI/RN | API publica segura; preferir URI; chave ML-DSA nao sai da wallet. | PDF generico RN verifica no Node; byte tamper e manifesto adulterado falham. |

## Exports tecnicos mobile sem equivalente Node direto

Estes nomes podem existir porque o mobile precisa de operacoes nativas que nao fazem
sentido como export Node puro.

| Nome mobile | Camada | Motivo |
|---|---|---|
| `issueCredential` | `src/index.ts` alias | Alias de conveniencia atual para `issueCredentialFromSchema`. |
| `signPdf` | `src/index.ts` alias | Alias de conveniencia atual para `signGenericPdf`. |
| `verifyCredentialPdf` | `src/index.ts` alias | Alias de conveniencia atual para `verifySignedCredentialPdf`. |
| `verifyGenericPdf` | `src/index.ts` alias | Alias de conveniencia atual para `verifySignedGenericPdf`. |
| `verifySignedCredentialPdfFromUri` | `src/node-compatible.ts` alias | Alias atual para `verifySignedCredentialPdf`; evita copiar PDF grande entre JS e nativo. |
| `verifySignedGenericPdfFromUri` | `src/node-compatible.ts` alias | Alias atual para `verifySignedGenericPdf`; evita copiar PDF grande entre JS e nativo. |
| `verifySignedCredentialPdfFile` | `src/node-compatible.ts` alias | Alias Node-compatible atual para `verifySignedCredentialPdf`; recebe URI/arquivo no RN. |
| `verifySignedGenericPdfFile` | `src/node-compatible.ts` alias | Alias Node-compatible atual para `verifySignedGenericPdf`; recebe URI/arquivo no RN. |
| `walletSignGenericPdfFromUri` | `src/node-compatible.ts` alias | Alias atual para `walletSignGenericPdf`; API principal de assinatura PDF no produto. |
| `walletEmbedSignedCredentialInPdfFromUri` | `src/node-compatible.ts` alias | Alias atual para `walletEmbedSignedCredentialInPdf`; API principal para PDF de credencial no produto. |
| `mobile_storage_get`/`put`/`delete`/`list_prefix` | UniFFI tecnico | Utilitarios de storage usados por testes/manutencao nativa; nao expostos no TurboModule RN atual. |
| `wallet_embed_signed_credential_in_pdf_bytes` | UniFFI tecnico | Variante bytes usada por testes nativos; API RN publica usa URI/arquivo. |
| `wallet_sign_generic_pdf_bytes` | UniFFI tecnico | Variante bytes usada por testes nativos; API RN publica usa URI/arquivo. |

Nomes antes planejados, mas nao implementados no TypeScript RN atual:

- `canonicalJsonFromUri`;
- `deleteWalletStorage`;
- `exportWalletStorageSnapshot`;
- `importWalletStorageSnapshot`;
- `isHardwareProtectionAvailable`.

## Politica de nomes TypeScript

A API principal de produto deve exportar funcoes no topo do pacote:

```ts
import {
  issueCredential,
  signPdf,
  verifyCredentialPdf,
  verifyGenericPdf,
  walletCreate,
  walletCreateDid,
  walletSignGenericPdf,
  verifySignedGenericPdf,
} from '@ssi-pq/react-native';
```

APIs perigosas ou de compatibilidade explicita devem ficar isoladas:

```ts
import { unsafe } from '@ssi-pq/react-native';
```

O arquivo `src/node-compatible.ts` pode oferecer aliases Node-like para testes e
migracao, mas deve documentar as diferencas mobile:

- `path` Node vira `walletName` ou URI;
- metodos de wallet sao sempre `Promise`;
- funcoes unsafe da facade atual lancam erro e indicam a alternativa segura;
- `canonicalJsonFile` vira leitura textual/URI feita pelo app seguida de `canonicalJson`.

## Criterio de aceite da Fase 0

Esta fase e considerada concluida quando:

1. Todos os 41 exports Node de `MATRIZ_PARIDADE_NODE_WASM.md` aparecem na matriz acima.
2. Cada export possui nome Node, nome UniFFI alvo, nome TypeScript RN alvo, status, decisao de seguranca e teste obrigatorio.
3. Versoes minimas iniciais foram fixadas para React Native, Android, iOS e Rust targets.
4. A politica de APIs perigosas esta documentada.
5. A unica API `N/A literal` e `canonicalJsonFile`, com alternativa mobile definida.

Veredito da Fase 0: **contrato alvo de paridade Node/Mobile congelado para implementacao inicial**.

Observacao da auditoria de 2026-07-14: o contrato alvo esta coberto pelo UniFFI
mobile para os recursos portaveis, mas a API React Native publica atual ainda
expoe apenas o subconjunto seguro de produto. Para transformar todos os itens
tecnicos em API RN, ainda seria necessario adiciona-los ao TurboModule,
`src/NativeSsiPq.ts`, wrappers Android/iOS e `src/index.ts` ou
`src/node-compatible.ts`.
