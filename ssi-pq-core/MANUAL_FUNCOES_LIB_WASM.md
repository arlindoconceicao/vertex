# Manual de Funcoes da Lib WASM SSI-PQ

Auditoria de codigo: 2026-07-13

Este manual descreve as funcoes expostas pela biblioteca WASM gerada a partir de
`crates/ssi-pq-wasm`, alem das facades JavaScript de apoio em `packages/web`.
Os exemplos usam JavaScript/TypeScript do ponto de vista de um app web ou de um
teste Node.js carregando o pacote WASM.

## Artefatos Gerados

Build para browser:

```sh
npm run build:wasm
```

Saida principal:

```text
packages/web/pkg/ssi_pq_wasm_bg.wasm
packages/web/pkg/ssi_pq_wasm.js
packages/web/pkg/ssi_pq_wasm.d.ts
```

Build para testes Node.js:

```sh
npm run build:wasm:test
```

Saida principal:

```text
packages/wasm-node/pkg/ssi_pq_wasm_bg.wasm
packages/wasm-node/pkg/ssi_pq_wasm.js
packages/wasm-node/pkg/ssi_pq_wasm.d.ts
```

## Inicializacao

### Browser/bundler web

```ts
import init, * as wasm from './pkg/ssi_pq_wasm.js';

await init();
const profiles = wasm.supportedProfiles();
```

### Node.js nos testes

```js
const wasm = require('../packages/wasm-node/pkg/ssi_pq_wasm.js');

const profiles = wasm.supportedProfiles();
```

## Tipos Usados nos Exemplos

- `Uint8Array`: bytes no browser/WASM.
- `string`: texto JavaScript.
- `object`: objeto JSON JavaScript.
- `jsonString`: objeto JSON serializado com `JSON.stringify`.
- `base64url`: base64url sem padding.
- `Profile ML-DSA`: `"ML-DSA-44"`, `"ML-DSA-65"` ou `"ML-DSA-87"`.
- `Profile ML-KEM`: `"ML-KEM-512"`, `"ML-KEM-768"` ou `"ML-KEM-1024"`.

Variaveis comuns:

```ts
const createdAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const issuedAt = createdAt;
const walletName = 'issuer-wallet';
const password = 'senha forte 123';
const message = new TextEncoder().encode('mensagem SSI-PQ');
const attributes = {
  name: 'Ana Silva',
  course: 'Post-Quantum Credentials',
  level: 'web',
};
const minimalPdf = new TextEncoder().encode(
  '%PDF-1.4\n%ABCD\n' +
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n' +
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>\nendobj\n' +
    'xref\n0 4\n' +
    '0000000000 65535 f \n' +
    '0000000015 00000 n \n' +
    '0000000064 00000 n \n' +
    '0000000121 00000 n \n' +
    'trailer\n<< /Size 4 /Root 1 0 R >>\n' +
    'startxref\n192\n' +
    '%%EOF\n',
);
```

Utilitarios dos exemplos:

```ts
const toJson = (value: unknown) => JSON.stringify(value);
const fromJson = <T = unknown>(value: string): T => JSON.parse(value) as T;
```

## Exports Diretos do WASM

### `supportedProfiles()`

Sintaxe:

```ts
supportedProfiles(): string[]
```

Exemplo:

```ts
const profiles = wasm.supportedProfiles();
console.log(profiles.includes('ML-DSA-65'));
```

### `base64urlEncode(bytes)`

Sintaxe:

```ts
base64urlEncode(bytes: Uint8Array): string
```

Exemplo:

```ts
const encoded = wasm.base64urlEncode(message);
```

### `base64urlDecode(value)`

Sintaxe:

```ts
base64urlDecode(value: string): Uint8Array
```

Exemplo:

```ts
const decoded = wasm.base64urlDecode(encoded);
```

### `multibaseBase58btcEncode(bytes)`

Sintaxe:

```ts
multibaseBase58btcEncode(bytes: Uint8Array): string
```

Exemplo:

```ts
const multibase = wasm.multibaseBase58btcEncode(message);
```

### `multibaseBase58btcDecode(value)`

Sintaxe:

```ts
multibaseBase58btcDecode(value: string): Uint8Array
```

Exemplo:

```ts
const bytes = wasm.multibaseBase58btcDecode(multibase);
```

### `canonicalJson(input)`

Sintaxe:

```ts
canonicalJson(input: string): string
```

Exemplo:

```ts
const canonical = wasm.canonicalJson('{"z":2,"a":1}');
// {"a":1,"z":2}
```

### `canonicalJsonHashBase64url(input)`

Sintaxe:

```ts
canonicalJsonHashBase64url(input: string): string
```

Exemplo:

```ts
const hash = wasm.canonicalJsonHashBase64url('{"z":2,"a":1}');
```

### `sha3_256Base64url(bytes)`

Sintaxe:

```ts
sha3_256Base64url(bytes: Uint8Array): string
```

Exemplo:

```ts
const digest = wasm.sha3_256Base64url(message);
```

### `sha3_256Hex(bytes)`

Sintaxe:

```ts
sha3_256Hex(bytes: Uint8Array): string
```

Exemplo:

```ts
const digestHex = wasm.sha3_256Hex(new Uint8Array());
```

### `secureRandomKey(length)`

Sintaxe:

```ts
secureRandomKey(length: number): Uint8Array
```

Exemplo:

```ts
const key = wasm.secureRandomKey(32);
```

### `schemaHashBase64(schema)`

Sintaxe:

```ts
schemaHashBase64(schema: object): string
```

Exemplo:

```ts
const schema = fromJson(
  wasm.createSchemaFromAttributesJson(
    toJson(attributes),
    toJson({version: '1', createdAt}),
  ),
);
const schemaHash = wasm.schemaHashBase64(schema);
```

### `issuerIdentifierBase64(didDocument)`

Sintaxe:

```ts
issuerIdentifierBase64(didDocument: object): string
```

Exemplo:

```ts
const didResult = fromJson(
  wasm.createDidJson(toJson({mldsa: 'ML-DSA-65', mlkem: 'ML-KEM-768', createdAt})),
);
const issuerId = wasm.issuerIdentifierBase64(didResult.didDocument);
```

### `mldsaGenerateKeypair(profile)`

Sintaxe:

```ts
mldsaGenerateKeypair(profile: string): {
  profile: string;
  publicKey: string;
  privateKey: string;
}
```

Exemplo:

```ts
const mldsa = wasm.mldsaGenerateKeypair('ML-DSA-65');
```

### `mldsaSign(profile, privateKey, message, context)`

Sintaxe:

```ts
mldsaSign(
  profile: string,
  privateKey: string,
  message: Uint8Array,
  context: string,
): string
```

Exemplo:

```ts
const signature = wasm.mldsaSign(
  'ML-DSA-65',
  mldsa.privateKey,
  message,
  'SSI_CREDENTIAL_SIGNATURE_V1',
);
```

### `mldsaVerify(profile, publicKey, message, context, signature)`

Sintaxe:

```ts
mldsaVerify(
  profile: string,
  publicKey: string,
  message: Uint8Array,
  context: string,
  signature: string,
): boolean
```

Exemplo:

```ts
const valid = wasm.mldsaVerify(
  'ML-DSA-65',
  mldsa.publicKey,
  message,
  'SSI_CREDENTIAL_SIGNATURE_V1',
  signature,
);
```

### `mlkemGenerateKeypair(profile)`

Sintaxe:

```ts
mlkemGenerateKeypair(profile: string): {
  profile: string;
  publicKey: string;
  privateKey: string;
}
```

Exemplo:

```ts
const mlkem = wasm.mlkemGenerateKeypair('ML-KEM-768');
```

### `mlkemEncapsulate(profile, publicKey)`

Sintaxe:

```ts
mlkemEncapsulate(profile: string, publicKey: string): {
  profile: string;
  ciphertext: string;
  sharedSecret: string;
}
```

Exemplo:

```ts
const encapsulation = wasm.mlkemEncapsulate('ML-KEM-768', mlkem.publicKey);
```

### `mlkemDecapsulate(profile, privateKey, ciphertext)`

Sintaxe:

```ts
mlkemDecapsulate(profile: string, privateKey: string, ciphertext: string): string
```

Exemplo:

```ts
const sharedSecret = wasm.mlkemDecapsulate(
  'ML-KEM-768',
  mlkem.privateKey,
  encapsulation.ciphertext,
);
```

### `aes256GcmEncrypt(key, plaintext, aad?)`

Sintaxe:

```ts
aes256GcmEncrypt(
  key: Uint8Array,
  plaintext: Uint8Array,
  aad?: Uint8Array | null,
): {
  ciphertext: Uint8Array;
  nonce: Uint8Array;
  authTag: Uint8Array;
}
```

Exemplo:

```ts
const encrypted = wasm.aes256GcmEncrypt(key, message, null);
```

### `aes256GcmDecrypt(key, ciphertext, nonce, authTag, aad?)`

Sintaxe:

```ts
aes256GcmDecrypt(
  key: Uint8Array,
  ciphertext: Uint8Array,
  nonce: Uint8Array,
  authTag: Uint8Array,
  aad?: Uint8Array | null,
): Uint8Array
```

Exemplo:

```ts
const plaintext = wasm.aes256GcmDecrypt(
  key,
  encrypted.ciphertext,
  encrypted.nonce,
  encrypted.authTag,
  null,
);
```

### `createDidJson(optionsJson?)`

Sintaxe:

```ts
createDidJson(optionsJson?: string | null): string
```

Exemplo:

```ts
const did = fromJson(
  wasm.createDidJson(toJson({mldsa: 'ML-DSA-65', mlkem: 'ML-KEM-768', createdAt})),
);
```

### `createSchemaFromAttributesJson(attributesJson, optionsJson?)`

Sintaxe:

```ts
createSchemaFromAttributesJson(
  attributesJson: string,
  optionsJson?: string | null,
): string
```

Exemplo:

```ts
const schemaJson = wasm.createSchemaFromAttributesJson(
  toJson(attributes),
  toJson({version: '1', createdAt}),
);
const schema = fromJson(schemaJson);
```

### `verifyDidDocumentJson(didDocumentJson)`

Sintaxe:

```ts
verifyDidDocumentJson(didDocumentJson: string): string
```

Exemplo:

```ts
const didVerification = fromJson(
  wasm.verifyDidDocumentJson(toJson(did.didDocument)),
);
console.log(didVerification.valid);
```

### `issueCredentialFromSchemaJson(...)`

Sintaxe:

```ts
issueCredentialFromSchemaJson(
  schemaJson: string,
  attributesJson: string,
  issuerDidDocumentJson: string,
  issuerPrivateKey: string,
  optionsJson?: string | null,
): string
```

Exemplo:

```ts
const signedCredentialJson = wasm.issueCredentialFromSchemaJson(
  schemaJson,
  toJson(attributes),
  toJson(did.didDocument),
  did.privateKeys.mldsa.privateKey,
  toJson({credentialId: 'cred-wasm-001', issuedAt, visiblePaths: ['name', 'course']}),
);
const signedCredential = fromJson(signedCredentialJson);
```

### `verifySignedCredentialJson(signedCredentialJson, issuerDidDocumentJson)`

Sintaxe:

```ts
verifySignedCredentialJson(
  signedCredentialJson: string,
  issuerDidDocumentJson: string,
): string
```

Exemplo:

```ts
const credentialVerification = fromJson(
  wasm.verifySignedCredentialJson(signedCredentialJson, toJson(did.didDocument)),
);
console.log(credentialVerification.valid);
```

### `signedCredentialToPdfBytes(signedCredentialJson, renderOptionsJson?)`

Sintaxe:

```ts
signedCredentialToPdfBytes(
  signedCredentialJson: string,
  renderOptionsJson?: string | null,
): Uint8Array
```

Exemplo:

```ts
const pdfBase = wasm.signedCredentialToPdfBytes(
  signedCredentialJson,
  toJson({labels: {name: 'Nome', course: 'Curso'}}),
);
```

### `embedSignedCredentialInPdfBytes(...)`

Sintaxe:

```ts
embedSignedCredentialInPdfBytes(
  pdfBase: Uint8Array,
  signedCredentialJson: string,
  issuerDidDocumentJson: string,
  issuerPrivateKey: string,
  optionsJson?: string | null,
): Uint8Array
```

Exemplo:

```ts
const finalCredentialPdf = wasm.embedSignedCredentialInPdfBytes(
  pdfBase,
  signedCredentialJson,
  toJson(did.didDocument),
  did.privateKeys.mldsa.privateKey,
  toJson({createdAt}),
);
```

### `extractCredentialManifestFromPdfBytes(pdfBytes)`

Sintaxe:

```ts
extractCredentialManifestFromPdfBytes(pdfBytes: Uint8Array): string
```

Exemplo:

```ts
const credentialManifest = fromJson(
  wasm.extractCredentialManifestFromPdfBytes(finalCredentialPdf),
);
```

### `verifySignedCredentialPdfJson(pdfBytes, issuerDidDocumentJson)`

Sintaxe:

```ts
verifySignedCredentialPdfJson(
  pdfBytes: Uint8Array,
  issuerDidDocumentJson: string,
): string
```

Exemplo:

```ts
const pdfVerification = fromJson(
  wasm.verifySignedCredentialPdfJson(finalCredentialPdf, toJson(did.didDocument)),
);
console.log(pdfVerification.valid);
```

### `extractGenericSignatureManifestFromPdfBytes(pdfBytes)`

Sintaxe:

```ts
extractGenericSignatureManifestFromPdfBytes(pdfBytes: Uint8Array): string
```

Exemplo:

```ts
const genericManifest = fromJson(
  wasm.extractGenericSignatureManifestFromPdfBytes(signedGenericPdf),
);
```

### `verifySignedGenericPdfJson(pdfBytes, signerDidDocumentJson)`

Sintaxe:

```ts
verifySignedGenericPdfJson(
  pdfBytes: Uint8Array,
  signerDidDocumentJson: string,
): string
```

Exemplo:

```ts
const genericVerification = fromJson(
  wasm.verifySignedGenericPdfJson(signedGenericPdf, toJson(did.didDocument)),
);
```

## Wallet Web Direta no WASM

As funcoes `webWallet*` usam um storage em memoria dentro do modulo WASM. Para
persistencia real em browser, use a camada `createPersistentWebWallet` descrita
mais abaixo.

O parametro `optionsJson` dessas funcoes e opcional na assinatura JavaScript
gerada (`string | null | undefined`), mas as operacoes que criam, emitem ou
assinam artefatos ainda exigem os campos de tempo esperados dentro do JSON, como
`createdAt` ou `issuedAt`, conforme o caso.

### `webWalletCreateJson(walletName, password, optionsJson?)`

Sintaxe:

```ts
webWalletCreateJson(
  walletName: string,
  password: string,
  optionsJson?: string | null,
): string
```

Exemplo:

```ts
const walletInfo = fromJson(
  wasm.webWalletCreateJson(walletName, password, toJson({createdAt})),
);
```

### `webWalletOpenJson(walletName, password)`

Sintaxe:

```ts
webWalletOpenJson(walletName: string, password: string): string
```

Exemplo:

```ts
const opened = fromJson(wasm.webWalletOpenJson(walletName, password));
```

### `webWalletChangePasswordJson(walletName, oldPassword, newPassword)`

Sintaxe:

```ts
webWalletChangePasswordJson(
  walletName: string,
  oldPassword: string,
  newPassword: string,
): string
```

Exemplo:

```ts
const changed = fromJson(
  wasm.webWalletChangePasswordJson(walletName, password, 'nova senha forte 456'),
);
```

### `webWalletCreateDidJson(walletName, password, optionsJson?)`

Sintaxe:

```ts
webWalletCreateDidJson(
  walletName: string,
  password: string,
  optionsJson?: string | null,
): string
```

Exemplo:

```ts
const walletDid = fromJson(
  wasm.webWalletCreateDidJson(
    walletName,
    password,
    toJson({label: 'Emissor web', mldsa: 'ML-DSA-65', mlkem: 'ML-KEM-768', createdAt}),
  ),
);
```

### `webWalletListDidsJson(walletName, password)`

Sintaxe:

```ts
webWalletListDidsJson(walletName: string, password: string): string
```

Exemplo:

```ts
const dids = fromJson(wasm.webWalletListDidsJson(walletName, password));
```

### `webWalletGetDidDocumentJson(walletName, password, did)`

Sintaxe:

```ts
webWalletGetDidDocumentJson(
  walletName: string,
  password: string,
  did: string,
): string
```

Exemplo:

```ts
const didDocument = fromJson(
  wasm.webWalletGetDidDocumentJson(walletName, password, walletDid.did),
);
```

### `webWalletIssueCredentialFromSchemaJson(...)`

Sintaxe:

```ts
webWalletIssueCredentialFromSchemaJson(
  walletName: string,
  password: string,
  did: string,
  schemaJson: string,
  attributesJson: string,
  optionsJson?: string | null,
): string
```

Exemplo:

```ts
const walletCredentialJson = wasm.webWalletIssueCredentialFromSchemaJson(
  walletName,
  password,
  walletDid.did,
  schemaJson,
  toJson(attributes),
  toJson({credentialId: 'cred-web-wallet-001', issuedAt, visiblePaths: ['name']}),
);
```

### `webWalletEmbedSignedCredentialInPdfBytes(...)`

Sintaxe:

```ts
webWalletEmbedSignedCredentialInPdfBytes(
  walletName: string,
  password: string,
  did: string,
  pdfBase: Uint8Array,
  signedCredentialJson: string,
  optionsJson?: string | null,
): Uint8Array
```

Exemplo:

```ts
const walletCredentialPdf = wasm.webWalletEmbedSignedCredentialInPdfBytes(
  walletName,
  password,
  walletDid.did,
  pdfBase,
  walletCredentialJson,
  toJson({createdAt}),
);
```

### `webWalletSignGenericPdfBytes(walletName, password, did, pdfBase, optionsJson?)`

Sintaxe:

```ts
webWalletSignGenericPdfBytes(
  walletName: string,
  password: string,
  did: string,
  pdfBase: Uint8Array,
  optionsJson?: string | null,
): Uint8Array
```

Exemplo:

```ts
const signedGenericPdf = wasm.webWalletSignGenericPdfBytes(
  walletName,
  password,
  walletDid.did,
  minimalPdf,
  toJson({
    createdAt,
    visualSignature: {
      mode: 'visible',
      placement: 'firstPageFooter',
      text: 'Assinado com SSI-PQ WASM',
    },
  }),
);
```

### `webWalletMlkemDecapsulate(walletName, password, did, ciphertext)`

Sintaxe:

```ts
webWalletMlkemDecapsulate(
  walletName: string,
  password: string,
  did: string,
  ciphertext: string,
): string
```

Exemplo:

```ts
const recoveredSecret = wasm.webWalletMlkemDecapsulate(
  walletName,
  password,
  walletDid.did,
  encapsulation.ciphertext,
);
```

### `webWalletClearMemory()`

Sintaxe:

```ts
webWalletClearMemory(): void
```

Exemplo:

```ts
wasm.webWalletClearMemory();
```

### `webWalletExportStorageJson(walletName)`

Sintaxe:

```ts
webWalletExportStorageJson(walletName: string): string
```

Exemplo:

```ts
const snapshotJson = wasm.webWalletExportStorageJson(walletName);
```

### `webWalletImportStorageJson(walletName, snapshotJson)`

Sintaxe:

```ts
webWalletImportStorageJson(walletName: string, snapshotJson: string): void
```

Exemplo:

```ts
wasm.webWalletImportStorageJson(walletName, snapshotJson);
```

### `webWalletDeleteStorage(walletName)`

Sintaxe:

```ts
webWalletDeleteStorage(walletName: string): void
```

Exemplo:

```ts
wasm.webWalletDeleteStorage(walletName);
```

## Facade de Wallet Persistente

Modulo:

```ts
import {
  createIndexedDbSnapshotStore,
  createIndexedDbWalletStore,
  createMemorySnapshotStore,
  createPersistentWebWallet,
  initIndexedDbWallet,
} from './ssi-pq-indexeddb-wallet.mjs';
```

### `initIndexedDbWallet(options?)`

Sintaxe:

```ts
initIndexedDbWallet(options?: {
  wasmModule?: string | object;
  wasmInitInput?: unknown;
  indexedDB?: IDBFactory;
  dbName?: string;
  storeName?: string;
}): Promise<WebWallet>
```

Exemplo:

```ts
const wallet = await initIndexedDbWallet({
  wasmModule: './pkg/ssi_pq_wasm.js',
});
```

### `createIndexedDbWalletStore(wasm, options?)`

Sintaxe:

```ts
createIndexedDbWalletStore(wasm: object, options?: object): WebWallet
```

Exemplo:

```ts
const wallet = createIndexedDbWalletStore(wasm, {indexedDB: globalThis.indexedDB});
```

### `createPersistentWebWallet(wasm, snapshotStore)`

Sintaxe:

```ts
createPersistentWebWallet(wasm: object, snapshotStore: SnapshotStore): WebWallet
```

Exemplo:

```ts
const snapshotStore = createMemorySnapshotStore();
const wallet = createPersistentWebWallet(wasm, snapshotStore);
```

### `createIndexedDbSnapshotStore(options?)`

Sintaxe:

```ts
createIndexedDbSnapshotStore(options?: {
  indexedDB?: IDBFactory;
  dbName?: string;
  storeName?: string;
}): SnapshotStore
```

Exemplo:

```ts
const snapshotStore = createIndexedDbSnapshotStore({
  dbName: 'ssi-pq-wallets',
  storeName: 'walletSnapshots',
});
```

### `createMemorySnapshotStore(initialRecords?)`

Sintaxe:

```ts
createMemorySnapshotStore(initialRecords?: Record<string, string>): SnapshotStore
```

Exemplo:

```ts
const memoryStore = createMemorySnapshotStore();
```

### Metodos de `WebWallet`

#### `createWallet(walletName, password, options)`

```ts
const info = await wallet.createWallet(walletName, password, {createdAt});
```

#### `openWallet(walletName, password)`

```ts
const info = await wallet.openWallet(walletName, password);
```

#### `changePassword(walletName, oldPassword, newPassword)`

```ts
await wallet.changePassword(walletName, password, 'nova senha forte 456');
```

#### `createDid(walletName, password, options)`

```ts
const did = await wallet.createDid(walletName, password, {
  label: 'Emissor web',
  mldsa: 'ML-DSA-65',
  mlkem: 'ML-KEM-768',
  createdAt,
});
```

#### `listDids(walletName, password)`

```ts
const dids = await wallet.listDids(walletName, password);
```

#### `getDidDocument(walletName, password, did)`

```ts
const didDocument = await wallet.getDidDocument(walletName, password, did.did);
```

#### `issueCredentialFromSchema(walletName, password, did, schema, attributes, options)`

```ts
const signedCredential = await wallet.issueCredentialFromSchema(
  walletName,
  password,
  did.did,
  schema,
  attributes,
  {credentialId: 'cred-wallet-web-001', issuedAt, visiblePaths: ['name']},
);
```

#### `embedSignedCredentialInPdf(walletName, password, did, pdfBase, signedCredential, options)`

```ts
const finalPdf = await wallet.embedSignedCredentialInPdf(
  walletName,
  password,
  did.did,
  pdfBase,
  signedCredential,
  {createdAt},
);
```

#### `signGenericPdf(walletName, password, did, pdfBase, options)`

```ts
const signedPdf = await wallet.signGenericPdf(
  walletName,
  password,
  did.did,
  minimalPdf,
  {createdAt},
);
```

#### `mlkemDecapsulate(walletName, password, did, ciphertext)`

```ts
const secret = await wallet.mlkemDecapsulate(
  walletName,
  password,
  did.did,
  encapsulation.ciphertext,
);
```

#### `deleteWallet(walletName)`

```ts
await wallet.deleteWallet(walletName);
```

#### `exportWalletSnapshot(walletName)`

```ts
const snapshotJson = await wallet.exportWalletSnapshot(walletName);
```

#### `importWalletSnapshot(walletName, snapshotJson)`

```ts
await wallet.importWalletSnapshot(walletName, snapshotJson);
```

#### `clearMemory()`

```ts
wallet.clearMemory();
```

### Metodos de `SnapshotStore`

#### `get(walletName)`

```ts
const snapshotJson = await snapshotStore.get(walletName);
```

#### `put(walletName, snapshotJson)`

```ts
await snapshotStore.put(walletName, snapshotJson);
```

#### `delete(walletName)`

```ts
await snapshotStore.delete(walletName);
```

#### `dump()`

Disponivel no store em memoria criado por `createMemorySnapshotStore`.

```ts
const records = memoryStore.dump();
```

## Facade Node-Compatible

Modulo:

```ts
import {
  createNodeCompatibleCore,
  initNodeCompatibleCore,
} from './ssi-pq-node-compatible.mjs';
```

Use esta facade quando quiser nomes e formatos parecidos com a lib Node. Ela
reexporta os helpers WASM diretos e adiciona nomes Node-like para DID,
credencial, PDF e wallet. A excecao documentada e `canonicalJsonFile`, que nao
existe no browser.

### `initNodeCompatibleCore(options?)`

Sintaxe:

```ts
initNodeCompatibleCore(options?: {
  wasmModule?: string | object;
  wasmInitInput?: unknown;
  walletStore?: WebWallet;
  indexedDB?: IDBFactory | null;
  disableWalletPersistence?: boolean;
}): Promise<NodeCompatibleCore>
```

Exemplo:

```ts
const core = await initNodeCompatibleCore({
  wasmModule: './pkg/ssi_pq_wasm.js',
});
```

### `createNodeCompatibleCore(wasm, options?)`

Sintaxe:

```ts
createNodeCompatibleCore(wasm: object, options?: {
  walletStore?: WebWallet;
  indexedDB?: IDBFactory | null;
  disableWalletPersistence?: boolean;
}): NodeCompatibleCore
```

Exemplo:

```ts
const walletStore = createPersistentWebWallet(wasm, createMemorySnapshotStore());
const core = createNodeCompatibleCore(wasm, {walletStore});
```

### Helpers Node-like da facade

Estes nomes funcionam como na lib Node, com bytes em `Uint8Array`:

```ts
core.supportedProfiles();
core.canonicalJson('{"b":2,"a":1}');
core.canonicalJsonHashBase64url('{"b":2,"a":1}');
core.sha3_256Hex(message);
core.sha3_256Base64url(message);
core.base64urlEncode(message);
core.base64urlDecode(core.base64urlEncode(message));
core.secureRandomKey(32);
```

### DID, Schema e Credencial pela facade

```ts
const did = core.createDid({mldsa: 'ML-DSA-65', mlkem: 'ML-KEM-768', createdAt});
const schema = core.createSchemaFromAttributes(attributes, {version: '1', createdAt});
const credential = core.issueCredentialFromSchema(
  schema,
  attributes,
  did.didDocument,
  did.privateKeys.mldsa.privateKey,
  {credentialId: 'cred-node-compatible-001', issuedAt, visiblePaths: ['name']},
);

console.log(core.didVerify(did.didDocument));
console.log(core.didFingerprintMatchesKeys(did.didDocument));
console.log(core.verifySignedCredential(credential, did.didDocument));
```

### PDF pela facade

```ts
const pdfBase = core.signedCredentialToPdf(credential, {
  labels: {name: 'Nome', course: 'Curso'},
});
const finalPdf = core.embedSignedCredentialInPdf(
  pdfBase,
  credential,
  did.didDocument,
  did.privateKeys.mldsa.privateKey,
  {createdAt},
);
const manifest = core.extractCredentialManifestFromPdf(finalPdf);
const verification = core.verifySignedCredentialPdf(finalPdf, did.didDocument);
```

### PDF generico pela facade

```ts
await core.walletCreate(walletName, password, {createdAt});
const signerDid = await core.walletCreateDid(walletName, password, {createdAt});
const signerDoc = await core.walletGetDidDocument(walletName, password, signerDid.did);
const signedPdf = await core.walletSignGenericPdf(
  walletName,
  password,
  signerDid.did,
  minimalPdf,
  {createdAt},
);
const genericManifest = core.extractGenericSignatureManifestFromPdf(signedPdf);
const genericVerification = core.verifySignedGenericPdf(signedPdf, signerDoc);
```

### Wallet pela facade

```ts
await core.walletCreate(walletName, password, {createdAt});
const did = await core.walletCreateDid(walletName, password, {
  label: 'Emissor facade',
  mldsa: 'ML-DSA-65',
  mlkem: 'ML-KEM-768',
  createdAt,
});
const didDocument = await core.walletGetDidDocument(walletName, password, did.did);
const dids = await core.walletListDids(walletName, password);
const opened = await core.walletOpen(walletName, password);
await core.walletChangePassword(walletName, password, 'nova senha forte 456');
```

### Credencial/PDF pela wallet da facade

```ts
const signedCredential = await core.walletIssueCredentialFromSchema(
  walletName,
  'nova senha forte 456',
  did.did,
  schema,
  attributes,
  {credentialId: 'cred-wallet-facade-001', issuedAt, visiblePaths: ['name']},
);
const pdfBase = core.signedCredentialToPdf(signedCredential);
const credentialPdf = await core.walletEmbedSignedCredentialInPdf(
  walletName,
  'nova senha forte 456',
  did.did,
  pdfBase,
  signedCredential,
  {createdAt},
);
```

### ML-KEM pela wallet da facade

```ts
const mlkemKey = didDocument.keys.find((key) => key.id === '#mlkem-1');
const publicKeyBase64url = core.base64urlEncode(
  core.multibaseBase58btcDecode(mlkemKey.public_key_multibase),
);
const encapsulation = core.mlkemEncapsulate('ML-KEM-768', publicKeyBase64url);
const recoveredSecret = await core.walletMlkemDecapsulate(
  walletName,
  'nova senha forte 456',
  did.did,
  encapsulation.ciphertext,
);
```

## Observacoes de Seguranca e Compatibilidade

- `canonicalJsonFile(path)` nao existe no browser. Leia `File`/`Blob`/texto com
  JavaScript e chame `canonicalJson`.
- Exports diretos que retornam ou recebem private key existem para paridade e
  testes. Em produto, prefira os fluxos de wallet.
- A wallet Node usa SQLCipher em arquivo. A wallet WASM usa snapshot cifrado em
  storage browser-like. Os artefatos gerados interoperam, mas os bytes da wallet
  nao sao o mesmo formato.
- A facade Node-compatible usa `Promise` para metodos de wallet.
- No browser, trate bytes como `Uint8Array`/`ArrayBuffer`, nao como `Buffer`.
- Evite executar operacoes paralelas que alterem a mesma wallet sem uma fila ou
  lock no nivel da aplicacao.

## Testes Relacionados

```sh
npm run test:wasm
```

Arquivos de referencia:

- `crates/ssi-pq-wasm/src/lib.rs`
- `packages/web/ssi-pq-node-compatible.mjs`
- `packages/web/ssi-pq-indexeddb-wallet.mjs`
- `test-wasm/*.test.js`
