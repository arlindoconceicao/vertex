# Matriz de paridade Node.js / WebAssembly

Data-base: 2026-06-26

Auditoria de codigo: 2026-07-14

Esta matriz congela a superficie publica atual do addon Node (`npm/ssi_pq_core.node`)
e compara cada export com o pacote WASM gerado (`packages/wasm-node/pkg/ssi_pq_wasm.js`).
O objetivo e evitar paridade acidental: cada API do Node deve ter um equivalente
WASM direto, um mapeamento em facade JS, ou uma justificativa para nao existir no browser.

## Resumo

- Exports Node: 41
- Exports WASM: 45
- Exports com mesmo nome nos dois pacotes: 18
- Fluxo principal wallet -> DID -> credencial -> PDF -> ML-KEM/AES -> verificacao: equivalente e testado nos dois.
- Paridade de API publica via facade: concluida para todos os exports compativeis com browser; `canonicalJsonFile` permanece N/A browser.
- Testes de paridade por grupo: concluidos para foundation, primitivas PQ, schema/credencial, wallet/PDF e PDF generico.

## Estado verificado no codigo

A auditoria de 2026-07-14 comparou:

- exports Node em `crates/ssi-pq-node/src/lib.rs`;
- exports WASM em `crates/ssi-pq-wasm/src/lib.rs`;
- facade Node-compatible em `packages/web/ssi-pq-node-compatible.mjs`;
- wallet persistente browser-like em `packages/web/ssi-pq-indexeddb-wallet.mjs`;
- testes em `test-wasm/*.test.js`.

Resultado estatico:

- exports Node: 41;
- exports WASM: 45;
- exports com mesmo nome nos dois pacotes: 18;
- todos os exports Node aparecem diretamente no WASM, na facade
  Node-compatible, ou como excecao documentada (`canonicalJsonFile`).

Resultado executado:

```sh
npm run test:wasm
```

Contagem estatica em 2026-07-14: a suite `test-wasm` contem **24 testes**.
A execucao completa de `npm run test:wasm` nao foi refeita nesta auditoria
documental.

## Como compilar a biblioteca WASM

Pre-requisitos:

- Rust com o target `wasm32-unknown-unknown`;
- `wasm-pack` instalado;
- dependencias npm instaladas na raiz do projeto.

Instale o target Rust, se ainda nao existir:

```sh
rustup target add wasm32-unknown-unknown
```

Para compilar o pacote WASM para uso em navegador/bundler web:

```sh
npm run build:wasm
```

Esse comando executa:

```sh
wasm-pack build crates/ssi-pq-wasm --target web --release --out-dir ../../packages/web/pkg
```

Saida esperada:

```text
packages/web/pkg/
```

Para compilar o WASM no formato usado pelos testes Node.js:

```sh
npm run build:wasm:test
```

Esse comando executa:

```sh
wasm-pack build crates/ssi-pq-wasm --target nodejs --release --out-dir ../../packages/wasm-node/pkg
```

Saida esperada:

```text
packages/wasm-node/pkg/
```

Para compilar e rodar a suite de paridade WASM:

```sh
npm run test:wasm
```

Esse comando compila o addon Node, compila o WASM para `nodejs` e executa os
testes em `test-wasm/*.test.js`.

## Criterios

Status:

- `OK direto`: o WASM ja expoe a mesma funcao com o mesmo nome.
- `OK via WASM`: a capacidade existe no WASM, mas com nome/formato diferente.
- `OK via facade`: a capacidade existe por meio da facade JS Node-compatible sobre o WASM.
- `Pendente`: ainda nao existe equivalente WASM suficiente.
- `N/A browser`: nao faz sentido como API browser porque depende de filesystem/local path nativo.

Decisao:

- `ja coberto`: nao precisa de acao.
- `exportar em Rust`: adicionar export no adapter WASM, normalmente chamando o mesmo core Rust usado pelo Node.
- `criar facade JS`: criar uma camada JS com nomes/formatos compativeis com o Node sobre exports WASM existentes.
- `nao aplicavel no browser`: documentar a diferenca e nao portar como API browser.

Facade Node-compatible atual: `packages/web/ssi-pq-node-compatible.mjs`.

## Pontos de atencao da compatibilidade

1. `canonicalJsonFile` e Node-only.

   A API Node recebe um path local e le arquivo pelo filesystem do Node. No
   browser, o app deve ler `File`/`Blob`/texto e chamar `canonicalJson`. Nao ha
   equivalente literal no WASM.

2. A paridade Node-like depende da facade JS.

   Os exports WASM tecnicos usam nomes e contratos como `createDidJson`,
   `signedCredentialToPdfBytes` e `webWalletCreateJson`. Para consumir com nomes
   e defaults parecidos com Node, usar `packages/web/ssi-pq-node-compatible.mjs`.
   Chamar os exports WASM diretos exige serializar JSON manualmente e informar
   campos obrigatorios como `createdAt`/`issuedAt` em algumas APIs.

3. Wallet nao e intercambiavel em bytes.

   Node usa SQLCipher em arquivo local. WASM usa `wallet_storage` com snapshot
   cifrado salvo por IndexedDB/OPFS ou por um `walletStore` fornecido pelo app.
   DIDs, credenciais, PDFs, assinaturas, hashes e segredos decapsulados devem
   interoperar; o arquivo `.db` Node e o snapshot WASM nao sao o mesmo artefato.

4. Metodos de wallet na facade WASM sao assincronos.

   No Node, as funcoes de wallet sao sincronas. Na facade WASM elas retornam
   `Promise`, porque persistencia browser/IndexedDB e assincrona. Codigo
   migrado precisa usar `await`.

5. Tipos binarios mudam de `Buffer` para `Uint8Array`.

   Node retorna/recebe `Buffer`. WASM retorna/recebe `Uint8Array`. Em Node.js
   isso e facilmente convertivel; no browser, consumidores devem tratar bytes
   como `Uint8Array`/`ArrayBuffer`.

6. Persistencia de wallet precisa ser configurada no browser.

   `createNodeCompatibleCore` cria wallet persistente apenas quando existe
   IndexedDB disponivel ou quando o chamador passa `walletStore`. Em ambiente sem
   IndexedDB, as chamadas de wallet da facade falham com erro de persistencia nao
   configurada. Para testes Node-like, usar `createMemorySnapshotStore` ou outro
   `walletStore`.

7. Cuidado com chamadas concorrentes para a mesma wallet no browser.

   A camada persistente carrega snapshot antes da operacao e salva snapshot ao
   final das operacoes que alteram estado. O app deve evitar operacoes paralelas
   que modifiquem a mesma wallet sem uma fila/lock no nivel da aplicacao, para
   nao sobrescrever snapshots com estado antigo.

8. APIs tecnicas com private key existem no WASM.

   Assim como no Node, exports como `createDid`, `mldsaGenerateKeypair`,
   `mldsaSign`, `mlkemGenerateKeypair` e `mlkemDecapsulate` podem expor ou
   receber chave privada. Para fluxo de produto no browser, preferir wallet
   (`walletCreateDid`, `walletIssueCredentialFromSchema`,
   `walletSignGenericPdf`, `walletMlkemDecapsulate`) e uma analise propria de
   custodia.

## Matriz principal: exports do Node

| Export Node | Categoria | Equivalente WASM atual | Status | Decisao | Observacao |
|---|---|---|---|---|---|
| `aes256GcmDecrypt` | Crypto AES | `aes256GcmDecrypt` | OK direto | ja coberto | Mesmo comportamento com `Uint8Array`. |
| `aes256GcmEncrypt` | Crypto AES | `aes256GcmEncrypt` | OK direto | ja coberto | Retorna objeto JS com `ciphertext`, `nonce`, `authTag`. |
| `base64urlDecode` | Encoding | `base64urlDecode` | OK direto | ja coberto | Retorna `Uint8Array`. |
| `base64urlEncode` | Encoding | `base64urlEncode` | OK direto | ja coberto | Recebe `Uint8Array`. |
| `canonicalJson` | Foundation | `canonicalJson` | OK direto | ja coberto | Mesmo nome e resultado textual. |
| `canonicalJsonFile` | Foundation / FS | nenhum | N/A browser | nao aplicavel no browser | API Node recebe path local. Browser deve usar `File`/`Blob` + leitura JS e entao `canonicalJson`. |
| `canonicalJsonHashBase64url` | Hash | `canonicalJsonHashBase64url` | OK direto | ja coberto | Chama `hash::canonical_json_sha3_256` e `encoding::base64url_encode`. |
| `createDid` | DID | facade sobre `createDidJson` | OK via facade | ja coberto | Facade serializa options, preenche `createdAt` quando omitido e retorna objeto Node-like. |
| `createSchemaFromAttributes` | Schema | facade sobre `createSchemaFromAttributesJson` | OK via facade | ja coberto | Facade serializa atributos/options, preenche `createdAt` quando omitido e retorna objeto. |
| `didFingerprintMatchesKeys` | DID | facade sobre `verifyDidDocumentJson` | OK via facade | ja coberto | Facade retorna `fingerprintMatchesKeys`. |
| `didVerify` | DID | facade sobre `verifyDidDocumentJson` | OK via facade | ja coberto | Facade retorna `valid`. |
| `embedSignedCredentialInPdf` | PDF credencial | facade sobre `embedSignedCredentialInPdfBytes` | OK via facade | ja coberto | Facade aceita objetos Node-like, preenche `createdAt` quando omitido e retorna `Uint8Array`. |
| `extractCredentialManifestFromPdf` | PDF credencial | facade sobre `extractCredentialManifestFromPdfBytes` | OK via facade | ja coberto | Facade parseia JSON para objeto. |
| `extractGenericSignatureManifestFromPdf` | PDF generico | facade sobre `extractGenericSignatureManifestFromPdfBytes` | OK via facade | ja coberto | Facade parseia o manifesto generico para objeto JS. |
| `issueCredentialFromSchema` | Credencial | facade sobre `issueCredentialFromSchemaJson` | OK via facade | ja coberto | Facade serializa schema/atributos/DID Document e preenche `issuedAt` quando omitido. |
| `issuerIdentifierBase64` | DID/hash | `issuerIdentifierBase64` | OK direto | ja coberto | Recebe DID Document como objeto JS e chama `did::issuer_identifier_base64`. |
| `mldsaGenerateKeypair` | ML-DSA | `mldsaGenerateKeypair` | OK direto | ja coberto | Retorna `{ profile, publicKey, privateKey }`. |
| `mldsaSign` | ML-DSA | `mldsaSign` | OK direto | ja coberto | Assina bytes com contexto textual. |
| `mldsaVerify` | ML-DSA | `mldsaVerify` | OK direto | ja coberto | Verifica bytes com contexto textual. |
| `mlkemDecapsulate` | ML-KEM | `mlkemDecapsulate` | OK direto | ja coberto | Decapsula usando chave privada explicita em base64url. |
| `mlkemEncapsulate` | ML-KEM | `mlkemEncapsulate` | OK direto | ja coberto | Mesmo nome; retorna objeto JS. |
| `mlkemGenerateKeypair` | ML-KEM | `mlkemGenerateKeypair` | OK direto | ja coberto | Retorna `{ profile, publicKey, privateKey }`. |
| `schemaHashBase64` | Schema/hash | `schemaHashBase64` | OK direto | ja coberto | Recebe schema como objeto JS e chama `schema::schema_hash_base64`. |
| `secureRandomKey` | Random | `secureRandomKey` | OK direto | ja coberto | Retorna `Uint8Array`; `getrandom` usa suporte JS no WASM. |
| `sha3_256Base64url` | Hash | `sha3_256Base64url` | OK direto | ja coberto | Chama `hash::sha3_256` + base64url. |
| `sha3_256Hex` | Hash | `sha3_256Hex` | OK direto | ja coberto | Chama `hash::sha3_256` + hex lowercase. |
| `signedCredentialToPdf` | PDF credencial | facade sobre `signedCredentialToPdfBytes` | OK via facade | ja coberto | Facade serializa credencial/options e retorna `Uint8Array`. |
| `supportedProfiles` | Foundation | `supportedProfiles` | OK direto | ja coberto | Mesmo nome. |
| `verifySignedCredential` | Credencial | facade sobre `verifySignedCredentialJson` | OK via facade | ja coberto | Facade retorna booleano `valid`. |
| `verifySignedCredentialPdf` | PDF credencial | facade sobre `verifySignedCredentialPdfJson` | OK via facade | ja coberto | Facade parseia JSON para objeto. |
| `verifySignedGenericPdf` | PDF generico | facade sobre `verifySignedGenericPdfJson` | OK via facade | ja coberto | Facade parseia o diagnostico de verificacao para objeto JS. |
| `walletChangePassword` | Wallet | facade async sobre `webWalletChangePasswordJson` | OK via facade | ja coberto | Paridade comportamental; browser usa walletName/storage, nao path SQLCipher. |
| `walletCreate` | Wallet | facade async sobre `webWalletCreateJson` | OK via facade | ja coberto | Paridade comportamental; backend browser e IndexedDB/OPFS, nao arquivo `.db`. |
| `walletCreateDid` | Wallet | facade async sobre `webWalletCreateDidJson` | OK via facade | ja coberto | Usa chave protegida no storage WASM; nao exporta private keys. |
| `walletEmbedSignedCredentialInPdf` | Wallet/PDF credencial | facade async sobre `webWalletEmbedSignedCredentialInPdfBytes` | OK via facade | ja coberto | Usa chave protegida no storage WASM. |
| `walletGetDidDocument` | Wallet | facade async sobre `webWalletGetDidDocumentJson` | OK via facade | ja coberto | Retorna DID Document como objeto. |
| `walletIssueCredentialFromSchema` | Wallet/credencial | facade async sobre `webWalletIssueCredentialFromSchemaJson` | OK via facade | ja coberto | Usa chave protegida no storage WASM. |
| `walletListDids` | Wallet | facade async sobre `webWalletListDidsJson` | OK via facade | ja coberto | Retorna lista parseada como objeto JS. |
| `walletMlkemDecapsulate` | Wallet/ML-KEM | facade async sobre `webWalletMlkemDecapsulate` | OK via facade | ja coberto | Ja usado pelo fluxo WASM-only. |
| `walletOpen` | Wallet | facade async sobre `webWalletOpenJson` | OK via facade | ja coberto | Paridade comportamental; backend browser nao e SQLCipher. |
| `walletSignGenericPdf` | Wallet/PDF generico | facade async sobre `webWalletSignGenericPdfBytes` | OK via facade | ja coberto | Paridade comportamental; assina com chave ML-DSA protegida no storage WASM. |

## Exports WASM atuais sem nome Node equivalente

Estes exports existem porque o WASM usa uma superficie JSON/bytes e um backend de wallet
baseado em storage chave-valor. Eles devem permanecer disponiveis mesmo quando uma facade
Node-compatible for criada.

| Export WASM | Papel | Decisao |
|---|---|---|
| `createDidJson` | API comum textual para adapters | manter como API tecnica |
| `createSchemaFromAttributesJson` | API comum textual para adapters | manter como API tecnica |
| `embedSignedCredentialInPdfBytes` | API bytes/texto para PDF | manter como API tecnica |
| `extractCredentialManifestFromPdfBytes` | API bytes/texto para manifesto PDF | manter como API tecnica |
| `extractGenericSignatureManifestFromPdfBytes` | API bytes/texto para manifesto PDF generico | manter como API tecnica |
| `issueCredentialFromSchemaJson` | API textual para credencial | manter como API tecnica |
| `multibaseBase58btcDecode` | Helper extra de encoding usado em DID Documents | manter; opcionalmente adicionar tambem ao Node depois |
| `multibaseBase58btcEncode` | Helper extra de encoding usado em DID Documents | manter; opcionalmente adicionar tambem ao Node depois |
| `signedCredentialToPdfBytes` | API bytes/texto para PDF | manter como API tecnica |
| `verifyDidDocumentJson` | Verificacao DID textual | manter como API tecnica |
| `verifySignedCredentialJson` | Verificacao credencial textual | manter como API tecnica |
| `verifySignedCredentialPdfJson` | Verificacao PDF textual | manter como API tecnica |
| `verifySignedGenericPdfJson` | Verificacao PDF generico textual | manter como API tecnica |
| `webWalletChangePasswordJson` | Wallet browser sobre storage | manter como base da facade |
| `webWalletClearMemory` | Controle de memoria para testes/reload | manter como utilitario WASM |
| `webWalletCreateDidJson` | Wallet browser sobre storage | manter como base da facade |
| `webWalletCreateJson` | Wallet browser sobre storage | manter como base da facade |
| `webWalletDeleteStorage` | Snapshot/import/export e limpeza por namespace | manter como utilitario WASM |
| `webWalletEmbedSignedCredentialInPdfBytes` | Wallet browser + PDF credencial | manter como base da facade |
| `webWalletExportStorageJson` | Snapshot cifrado para IndexedDB/OPFS | manter como API tecnica |
| `webWalletGetDidDocumentJson` | Wallet browser sobre storage | manter como base da facade |
| `webWalletImportStorageJson` | Snapshot cifrado para IndexedDB/OPFS | manter como API tecnica |
| `webWalletIssueCredentialFromSchemaJson` | Wallet browser + emissao | manter como base da facade |
| `webWalletListDidsJson` | Wallet browser sobre storage | manter como base da facade |
| `webWalletMlkemDecapsulate` | Wallet browser + ML-KEM | manter como base da facade |
| `webWalletOpenJson` | Wallet browser sobre storage | manter como base da facade |
| `webWalletSignGenericPdfBytes` | Wallet browser + PDF generico | manter como base da facade |

## Criterio de conclusao

Em 2026-06-26, a biblioteca Node e a biblioteca WASM devem ser consideradas
equivalentes para a superficie portavel quando todos os itens abaixo forem
verdadeiros:

1. Todos os helpers portaveis do Node existem no WASM diretamente ou na facade
   `packages/web/ssi-pq-node-compatible.mjs`.
   **Status atual: atendido.** O teste `test-wasm/node-compatible-api-surface.test.js`
   compara a superficie Node com a facade WASM e permite apenas `canonicalJsonFile`
   como excecao browser.

2. Os fluxos principais possuem testes Node e WASM equivalentes.
   **Status atual: atendido.** Os testes de paridade por grupo cobrem foundation,
   primitivas PQ, schema/credencial, wallet/PDF e PDF generico. O fluxo completo
   wallet -> DID -> credencial -> PDF -> ML-KEM/AES -> verificacao tambem existe
   em Node e em WASM.

3. A unica diferenca funcional documentada e armazenamento.
   **Status atual: atendido.** No Node, `walletCreate(path, password, options)`
   cria/abre uma wallet SQLCipher em arquivo. No WASM/browser, a facade usa
   `walletCreate(walletName, password, options)` sobre `webWallet*` com snapshot
   cifrado para IndexedDB/OPFS. Essa diferenca e intencional e de arquitetura,
   nao de semantica de wallet.

Veredito: **paridade Node/WASM concluida para APIs compativeis com browser**.
Isso nao implica bytes identicos para PDFs, chaves, assinaturas ou wallets entre
plataformas, porque esses artefatos incluem aleatoriedade e backends distintos.
O contrato de paridade e comportamental: gerar, assinar, persistir, extrair,
decapsular, cifrar/decifrar e verificar com os mesmos invariantes publicos.

## Ordem sugerida de implementacao

1. Exports Rust puros: hashes, random, ML-DSA, ML-KEM keygen/decapsulate, schema/issuer hash. **Concluido.**
2. Exports Rust de PDF generico sem wallet: extract/verify generic PDF. **Concluido.**
3. Suporte de PDF generico em `wallet_storage` e export WASM para `walletSignGenericPdf`. **Concluido.**
4. Facade JS Node-compatible sobre as APIs core de alto nivel. **Concluido para DID, schema, credencial, PDF-credencial e PDF generico.**
5. Facade JS Node-compatible para wallet browser sobre `webWallet*`. **Concluido para wallet credencial/PDF/ML-KEM/generic PDF; metodos async por causa de IndexedDB.**
6. Facade JS de compatibilidade em `packages/web/ssi-pq-node-compatible.mjs`. **Concluido; teste de superficie garante todos os nomes Node browser-compatible.**
7. Testes de paridade por grupo copiando os testes Node e trocando apenas o import para a facade WASM. **Concluido com `test-wasm/parity-foundation.test.js`, `test-wasm/parity-pq-primitives.test.js`, `test-wasm/parity-schema-credential.test.js`, `test-wasm/parity-wallet-pdf.test.js` e `test-wasm/parity-generic-pdf.test.js`.**
8. Criterio de conclusao da paridade Node/WASM. **Concluido; a unica diferenca aceita e o backend de armazenamento: SQLCipher em arquivo no Node, IndexedDB/OPFS no WASM/browser.**
