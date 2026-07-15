# Manual de Funcoes da Lib Mobile

Auditoria de código: 2026-07-13

Este manual lista as funcoes disponiveis na API React Native segura da lib
mobile SSI-PQ e mostra um exemplo de uso de cada uma.

Pacote:

```ts
import * as SsiPq from '@ssi-pq/react-native';
```

Facade de compatibilidade Node:

```ts
import * as SsiPqNode from '@ssi-pq/react-native/node-compatible';
```

## Premissas dos Exemplos

Os exemplos abaixo usam variaveis comuns:

```ts
const walletName = 'issuer-wallet';
const password = 'senha forte 123';
const createdAt = new Date().toISOString();
const issuedAt = createdAt;
const inputPdfUri = 'file:///data/user/0/app/cache/input.pdf';
const outputPdfUri = 'file:///data/user/0/app/cache/output-signed.pdf';
const ciphertextBase64url = 'ciphertext_recebido_do_emissor';

const attributes = {
  name: 'Ana Silva',
  course: 'Post-Quantum Credentials',
  level: 'mobile',
};
```

Em Android/iOS reais, `inputPdfUri` e `outputPdfUri` devem ser URIs acessiveis
pelo app. Para PDFs grandes, prefira sempre APIs por URI.

## Observacoes Sobre a API Segura

A API principal em `@ssi-pq/react-native` e uma facade segura sobre o
TurboModule. Ela nao expoe private keys ao JavaScript e, por isso, fluxos como
criar DID, emitir credencial, assinar PDF e decapsular ML-KEM passam pela
wallet.

Algumas opcoes que no Node podem ser omitidas e preenchidas pelo addon, como
`createdAt` e `issuedAt`, aparecem como obrigatorias nos tipos TypeScript da API
segura mobile. Use timestamps ISO/RFC 3339, por exemplo
`new Date().toISOString()`.

Helpers tecnicos existentes no UniFFI/bindings nativos nao fazem parte da API
React Native segura atual. Quando necessario, eles devem ser tratados como API
tecnica/test-only e nao como fluxo normal de produto. A lista dos helpers
nativos nao expostos pela facade segura aparece na secao "Funcoes UniFFI
nativas nao expostas pela facade segura".

## Helpers e Perfis

### `supportedProfiles()`

Lista os perfis criptograficos suportados.

```ts
const profiles = await SsiPq.supportedProfiles();
console.log(profiles.includes('ML-DSA-65'));
```

### `canonicalJson(input)`

Canonicaliza um JSON textual.

```ts
const canonical = await SsiPq.canonicalJson('{"z":2,"a":1}');
// {"a":1,"z":2}
```

### `canonicalJsonHashBase64url(input)`

Calcula SHA3-256 em base64url sobre o JSON canonico.

```ts
const hash = await SsiPq.canonicalJsonHashBase64url('{"z":2,"a":1}');
```

### `sha3_256Base64url(bytesBase64)`

Calcula SHA3-256 de bytes recebidos em Base64 e retorna base64url.

```ts
const messageBase64 = 'U1NJLVBRCg==';
const digest = await SsiPq.sha3_256Base64url(messageBase64);
```

### `sha3_256Hex(bytesBase64)`

Calcula SHA3-256 de bytes recebidos em Base64 e retorna hexadecimal.

```ts
const digestHex = await SsiPq.sha3_256Hex('U1NJLVBRCg==');
```

### `base64urlEncode(bytesBase64)`

Converte bytes em Base64 para Base64URL sem padding.

```ts
const encoded = await SsiPq.base64urlEncode('U1NJLVBRCg==');
```

### `base64urlDecodeToBase64(value)`

Converte Base64URL para Base64.

```ts
const base64 = await SsiPq.base64urlDecodeToBase64(encoded);
```

## Utilitarios de Serializacao

### `jsonToString(value, fieldName?)`

Aceita objeto JSON ou string JSON e retorna string JSON valida.

```ts
const schemaOptionsJson = SsiPq.jsonToString({version: '1', createdAt}, 'schema options');
```

### `optionalJsonToString(value, fieldName?)`

Como `jsonToString`, mas aceita `null`/`undefined`.

```ts
const maybeOptions = SsiPq.optionalJsonToString(null, 'options');
// null
```

### `normalizeFileOperationResult(value)`

Normaliza o JSON retornado pelo nativo para `{ outputUri, bytesWritten, metadataJson }`.

```ts
const result = SsiPq.normalizeFileOperationResult(
  '{"outputUri":"file:///tmp/out.pdf","bytesWritten":123,"metadataJson":null}',
);
```

### `normalizeMobileError(error)`

Converte erro desconhecido para formato normalizado.

```ts
try {
  await SsiPq.openWallet(walletName, 'senha errada');
} catch (error) {
  const normalized = SsiPq.normalizeMobileError(error);
  console.log(normalized.code, normalized.message);
}
```

### `native`

Expoe o TurboModule bruto usado pela facade segura. Ele nao expoe o objeto
UniFFI completo; prefira a API segura de alto nivel.

```ts
const rawProfiles = await SsiPq.native.supportedProfiles();
```

## Funcoes UniFFI Nativas Nao Expostas Pela Facade Segura

As funcoes abaixo existem em `crates/ssi-pq-mobile-ffi/src/lib.rs` e nos
bindings UniFFI gerados para Kotlin/Swift, mas nao sao exportadas por
`packages/react-native/src/index.ts` nem por `NativeSsiPq.ts`. Para usa-las em
React Native seria necessario criar metodos especificos no TurboModule. Elas
devem ser consideradas tecnicas/test-only, principalmente quando recebem ou
retornam private keys, segredos compartilhados ou PDFs em bytes.

### Construtores UniFFI

- `SsiPq::new()`: cria a instancia UniFFI com diretorio de armazenamento padrao
  nativo.
- `SsiPq::new_with_storage_dir(storageDir)`: cria a instancia UniFFI apontando
  para um diretorio de armazenamento especifico.

### Helpers nativos nao expostos

- `secure_random_key(length)`: gera bytes aleatorios seguros.
- `schema_hash_base64(schemaJson)`: calcula o hash Base64 da definicao logica
  de um Schema.
- `issuer_identifier_base64(didDocumentJson)`: calcula o identificador curto do
  emissor a partir do DID Document.

### Primitivas criptograficas diretas

- `mldsa_generate_keypair(profile)`: gera par de chaves ML-DSA e retorna a
  private key ao chamador.
- `mldsa_sign(profile, privateKey, message, context)`: assina diretamente com
  private key recebida por parametro.
- `mldsa_verify(profile, publicKey, message, context, signature)`: verifica uma
  assinatura ML-DSA direta.
- `mlkem_generate_keypair(profile)`: gera par de chaves ML-KEM e retorna a
  private key ao chamador.
- `mlkem_encapsulate(profile, publicKey)`: encapsula segredo para uma public key
  ML-KEM.
- `mlkem_decapsulate(profile, privateKey, ciphertext)`: decapsula usando private
  key explicita. Na API segura use `mlkemDecapsulate`, que usa a chave protegida
  na wallet.
- `aes256_gcm_encrypt(key, plaintext, aad?)`: cifra bytes diretamente.
- `aes256_gcm_decrypt(key, ciphertext, nonce, authTag, aad?)`: decifra bytes
  diretamente.

### APIs diretas de DID, credencial e PDF

- `create_did_json(optionsJson?)`: cria DID fora da wallet e retorna private
  keys no JSON, por isso nao e exposta pela facade segura.
- `issue_credential_from_schema_json(schemaJson, attributesJson, issuerDidDocumentJson, issuerPrivateKey, optionsJson?)`:
  emite credencial usando private key explicita.
- `signed_credential_to_pdf(signedCredentialJson, renderOptionsJson?)`: gera o
  PDF visual em bytes.
- `embed_signed_credential_in_pdf(pdfBase, signedCredentialJson, issuerDidDocumentJson, issuerPrivateKey, optionsJson?)`:
  embute manifesto em PDF usando private key explicita.
- `extract_credential_manifest_from_pdf(pdfBytes)`: extrai manifesto de PDF de
  credencial a partir de bytes.
- `verify_signed_credential_pdf(pdfBytes, issuerDidDocumentJson)`: verifica PDF
  de credencial em bytes. A API segura RN expoe a variante por URI.
- `extract_generic_signature_manifest_from_pdf(pdfBytes)`: extrai manifesto de
  assinatura generica a partir de bytes.
- `verify_signed_generic_pdf(pdfBytes, signerDidDocumentJson)`: verifica PDF
  generico em bytes. A API segura RN expoe a variante por URI.

### Variantes tecnicas de wallet e storage

- `wallet_embed_signed_credential_in_pdf_bytes(walletName, password, did, pdfBase, signedCredentialJson, optionsJson?)`:
  variante em bytes da assinatura PDF de credencial.
- `wallet_sign_generic_pdf_bytes(walletName, password, did, pdfBase, optionsJson?)`:
  variante em bytes da assinatura de PDF generico.
- `mobile_storage_get(key)`, `mobile_storage_put(key, value)`,
  `mobile_storage_delete(key)` e `mobile_storage_list_prefix(prefix)`: acesso
  direto ao storage chave-valor usado pela wallet mobile.

## Wallet

### `createWallet(walletName, password, options)`

Cria uma wallet cifrada pelo core.

```ts
const wallet = await SsiPq.createWallet(walletName, password, {createdAt});
```

### `openWallet(walletName, password)`

Abre uma wallet existente e retorna metadados publicos.

```ts
const wallet = await SsiPq.openWallet(walletName, password);
```

### `changeWalletPassword(walletName, oldPassword, newPassword)`

Troca a senha da wallet.

```ts
const changed = await SsiPq.changeWalletPassword(
  walletName,
  password,
  'nova senha forte 456',
);
```

## DID

### `createDid(walletName, password, options)`

Cria um DID dentro da wallet sem exportar private key para JavaScript.

```ts
const didResult = await SsiPq.createDid(walletName, password, {
  label: 'Emissor mobile',
  mldsa: 'ML-DSA-65',
  mlkem: 'ML-KEM-768',
  createdAt,
});
```

### `listDids(walletName, password)`

Lista DIDs publicos da wallet.

```ts
const dids = await SsiPq.listDids(walletName, password);
```

### `getDidDocument(walletName, password, did)`

Retorna o DID Document publico.

```ts
const didDocument = await SsiPq.getDidDocument(walletName, password, didResult.did);
```

### `verifyDidDocument(didDocument)`

Verifica assinatura e coerencia de um DID Document.

```ts
const didVerification = await SsiPq.verifyDidDocument(didDocument);
console.log(didVerification.valid);
```

## Schema e Credenciais

### `createSchemaFromAttributes(attributes, options)`

Cria schema a partir de atributos.

```ts
const schema = await SsiPq.createSchemaFromAttributes(attributes, {
  version: '1',
  createdAt,
});
```

### `issueCredentialFromSchema(walletName, password, did, schema, attributes, options)`

Emite credencial assinada usando a chave protegida na wallet.

```ts
const signedCredential = await SsiPq.issueCredentialFromSchema(
  walletName,
  password,
  didResult.did,
  schema,
  attributes,
  {
    credentialId: 'cred-mobile-001',
    issuedAt,
    visiblePaths: ['name', 'course'],
    credentialVersion: 'v2',
  },
);
```

### `verifySignedCredential(signedCredential, issuerDidDocument)`

Verifica uma credencial assinada.

```ts
const credentialVerification = await SsiPq.verifySignedCredential(
  signedCredential,
  didDocument,
);
console.log(credentialVerification.valid);
```

## PDF

### `embedSignedCredentialInPdf(request)`

Embute uma credencial assinada em um PDF e assina o vinculo PDF/credencial com
a chave da wallet.

```ts
const credentialPdf = await SsiPq.embedSignedCredentialInPdf({
  walletName,
  password,
  did: didResult.did,
  inputUri: inputPdfUri,
  outputUri: outputPdfUri,
  signedCredential,
  options: {createdAt},
});
```

### `signGenericPdf(request)`

Assina um PDF generico com a chave da wallet.

```ts
const genericPdf = await SsiPq.signGenericPdf({
  walletName,
  password,
  did: didResult.did,
  inputUri: inputPdfUri,
  outputUri: outputPdfUri,
  options: {
    createdAt,
    visualSignature: {
      mode: 'visible',
      placement: 'firstPageFooter',
      text: 'Assinado com SSI-PQ',
    },
  },
});
```

### `verifySignedCredentialPdf(inputUri, issuerDidDocument)`

Verifica PDF de credencial.

```ts
const credentialPdfVerification = await SsiPq.verifySignedCredentialPdf(
  outputPdfUri,
  didDocument,
);
console.log(credentialPdfVerification.valid);
```

### `verifySignedGenericPdf(inputUri, signerDidDocument)`

Verifica PDF generico assinado.

```ts
const genericPdfVerification = await SsiPq.verifySignedGenericPdf(
  outputPdfUri,
  didDocument,
);
console.log(genericPdfVerification.valid);
```

## ML-KEM pela Wallet

### `mlkemDecapsulate(walletName, password, did, ciphertext)`

Decapsula um ciphertext ML-KEM usando a chave ML-KEM protegida na wallet.

```ts
const sharedSecretBase64url = await SsiPq.mlkemDecapsulate(
  walletName,
  password,
  didResult.did,
  ciphertextBase64url,
);
```

Nao logue nem persista `sharedSecretBase64url` em JavaScript.

## Aliases da API Principal

Os aliases abaixo apontam para as funcoes seguras acima.

### `issueCredential`

Alias de `issueCredentialFromSchema`.

```ts
const credential = await SsiPq.issueCredential(
  walletName,
  password,
  didResult.did,
  schema,
  attributes,
  {credentialId: 'cred-alias-001', issuedAt, visiblePaths: ['name']},
);
```

### `signPdf`

Alias de `signGenericPdf`.

```ts
const signed = await SsiPq.signPdf({
  walletName,
  password,
  did: didResult.did,
  inputUri: inputPdfUri,
  outputUri: outputPdfUri,
  options: {createdAt},
});
```

### `verifyCredentialPdf`

Alias de `verifySignedCredentialPdf`.

```ts
const result = await SsiPq.verifyCredentialPdf(outputPdfUri, didDocument);
```

### `verifyGenericPdf`

Alias de `verifySignedGenericPdf`.

```ts
const result = await SsiPq.verifyGenericPdf(outputPdfUri, didDocument);
```

### `walletCreate`

Alias de `createWallet`.

```ts
await SsiPq.walletCreate(walletName, password, {createdAt});
```

### `walletOpen`

Alias de `openWallet`.

```ts
await SsiPq.walletOpen(walletName, password);
```

### `walletChangePassword`

Alias de `changeWalletPassword`.

```ts
await SsiPq.walletChangePassword(walletName, password, 'nova senha forte');
```

### `walletCreateDid`

Alias de `createDid`.

```ts
const did = await SsiPq.walletCreateDid(walletName, password, {
  label: 'Alias DID',
  createdAt,
});
```

### `walletListDids`

Alias de `listDids`.

```ts
const dids = await SsiPq.walletListDids(walletName, password);
```

### `walletGetDidDocument`

Alias de `getDidDocument`.

```ts
const doc = await SsiPq.walletGetDidDocument(walletName, password, didResult.did);
```

### `walletIssueCredentialFromSchema`

Alias de `issueCredentialFromSchema`.

```ts
const credential = await SsiPq.walletIssueCredentialFromSchema(
  walletName,
  password,
  didResult.did,
  schema,
  attributes,
  {credentialId: 'cred-wallet-alias', issuedAt, visiblePaths: ['name']},
);
```

### `walletEmbedSignedCredentialInPdf`

Alias de `embedSignedCredentialInPdf`.

```ts
const result = await SsiPq.walletEmbedSignedCredentialInPdf({
  walletName,
  password,
  did: didResult.did,
  inputUri: inputPdfUri,
  outputUri: outputPdfUri,
  signedCredential,
  options: {createdAt},
});
```

### `walletSignGenericPdf`

Alias de `signGenericPdf`.

```ts
const result = await SsiPq.walletSignGenericPdf({
  walletName,
  password,
  did: didResult.did,
  inputUri: inputPdfUri,
  outputUri: outputPdfUri,
  options: {createdAt},
});
```

### `walletMlkemDecapsulate`

Alias de `mlkemDecapsulate`.

```ts
const secret = await SsiPq.walletMlkemDecapsulate(
  walletName,
  password,
  didResult.did,
  ciphertextBase64url,
);
```

## Facade `node-compatible.ts`

Esta facade ajuda migracoes de nomes Node para React Native. Ela nao transforma
o mobile em Node: caminhos de arquivo viram URI, retornos sao `Promise`, e APIs
que exigiriam private key ficam indisponiveis.

### `nodeCompatibilityNotes`

Lista diferencas importantes.

```ts
console.log(SsiPqNode.nodeCompatibilityNotes);
```

### Helpers reexportados

```ts
await SsiPqNode.supportedProfiles();
await SsiPqNode.canonicalJson('{"b":2,"a":1}');
await SsiPqNode.canonicalJsonHashBase64url('{"b":2,"a":1}');
await SsiPqNode.sha3_256Base64url('U1NJLVBRCg==');
await SsiPqNode.sha3_256Hex('U1NJLVBRCg==');
await SsiPqNode.base64urlEncode('U1NJLVBRCg==');
```

### `base64urlDecode(value)`

Alias de `base64urlDecodeToBase64`.

```ts
const decodedBase64 = await SsiPqNode.base64urlDecode('U1NJLVBRCg');
```

### `createSchemaFromAttributes`

Mesmo comportamento da API principal.

```ts
const schema = await SsiPqNode.createSchemaFromAttributes(attributes, {
  version: '1',
  createdAt,
});
```

### `verifySignedCredential`

Mesmo comportamento da API principal.

```ts
const result = await SsiPqNode.verifySignedCredential(signedCredential, didDocument);
```

### `didVerify`

Alias para `verifyDidDocument`. Retorna o objeto de verificacao RN.

```ts
const result = await SsiPqNode.didVerify(didDocument);
console.log(result.valid);
```

### `didFingerprintMatchesKeys`

Alias para `verifyDidDocument`. Use `fingerprintMatchesKeys` no retorno.

```ts
const result = await SsiPqNode.didFingerprintMatchesKeys(didDocument);
console.log(result.fingerprintMatchesKeys);
```

### PDF por URI

```ts
await SsiPqNode.verifySignedCredentialPdfFromUri(outputPdfUri, didDocument);
await SsiPqNode.verifySignedGenericPdfFromUri(outputPdfUri, didDocument);
await SsiPqNode.verifySignedCredentialPdfFile(outputPdfUri, didDocument);
await SsiPqNode.verifySignedGenericPdfFile(outputPdfUri, didDocument);
```

### Wallet aliases Node-compatible

```ts
await SsiPqNode.walletCreate(walletName, password, {createdAt});
await SsiPqNode.walletOpen(walletName, password);
await SsiPqNode.walletChangePasswordJson(walletName, password, 'nova senha');
const did = await SsiPqNode.walletCreateDid(walletName, password, {createdAt});
await SsiPqNode.walletListDids(walletName, password);
await SsiPqNode.walletGetDidDocument(walletName, password, did.did);
await SsiPqNode.walletIssueCredentialFromSchema(
  walletName,
  password,
  did.did,
  schema,
  attributes,
  {credentialId: 'cred-node-compat', issuedAt, visiblePaths: ['name']},
);
await SsiPqNode.walletEmbedSignedCredentialInPdf({
  walletName,
  password,
  did: did.did,
  inputUri: inputPdfUri,
  outputUri: outputPdfUri,
  signedCredential,
  options: {createdAt},
});
await SsiPqNode.walletEmbedSignedCredentialInPdfFromUri({
  walletName,
  password,
  did: did.did,
  inputUri: inputPdfUri,
  outputUri: outputPdfUri,
  signedCredential,
  options: {createdAt},
});
await SsiPqNode.walletSignGenericPdf({
  walletName,
  password,
  did: did.did,
  inputUri: inputPdfUri,
  outputUri: outputPdfUri,
  options: {createdAt},
});
await SsiPqNode.walletSignGenericPdfFromUri({
  walletName,
  password,
  did: did.did,
  inputUri: inputPdfUri,
  outputUri: outputPdfUri,
  options: {createdAt},
});
await SsiPqNode.walletMlkemDecapsulate(walletName, password, did.did, ciphertextBase64url);
```

### `canonicalJsonFile()`

Nao existe como leitura direta de path Node no mobile. A funcao lanca erro
orientando a usar URI/texto.

```ts
try {
  SsiPqNode.canonicalJsonFile();
} catch (error) {
  console.log(String(error));
}
```

### `unsafe`

Namespace de APIs Node perigosas que nao sao expostas pela API segura mobile.
Todas lancam erro com alternativa segura.

```ts
try {
  SsiPqNode.unsafe.createDid();
} catch (error) {
  console.log(String(error));
}

try {
  SsiPqNode.unsafe.issueCredentialFromSchema();
} catch (error) {
  console.log(String(error));
}

try {
  SsiPqNode.unsafe.embedSignedCredentialInPdf();
} catch (error) {
  console.log(String(error));
}

try {
  SsiPqNode.unsafe.mldsaGenerateKeypair();
} catch (error) {
  console.log(String(error));
}

try {
  SsiPqNode.unsafe.mldsaSign();
} catch (error) {
  console.log(String(error));
}

try {
  SsiPqNode.unsafe.mlkemGenerateKeypair();
} catch (error) {
  console.log(String(error));
}

try {
  SsiPqNode.unsafe.mlkemDecapsulate();
} catch (error) {
  console.log(String(error));
}
```

## Exemplo Completo Minimo

```ts
import {
  createDid,
  createSchemaFromAttributes,
  createWallet,
  embedSignedCredentialInPdf,
  getDidDocument,
  issueCredentialFromSchema,
  openWallet,
  verifySignedCredentialPdf,
} from '@ssi-pq/react-native';

export async function runMobileFlow(inputPdfUri: string, outputPdfUri: string) {
  const walletName = 'issuer-wallet';
  const password = 'senha forte 123';
  const createdAt = new Date().toISOString();
  const issuedAt = createdAt;

  try {
    await createWallet(walletName, password, {createdAt});
  } catch (_error) {
    await openWallet(walletName, password);
  }

  const did = await createDid(walletName, password, {
    label: 'Emissor mobile',
    mldsa: 'ML-DSA-65',
    mlkem: 'ML-KEM-768',
    createdAt,
  });

  const didDocument = await getDidDocument(walletName, password, did.did);
  const attributes = {
    name: 'Ana Silva',
    course: 'Post-Quantum Credentials',
  };
  const schema = await createSchemaFromAttributes(attributes, {
    version: '1',
    createdAt,
  });
  const signedCredential = await issueCredentialFromSchema(
    walletName,
    password,
    did.did,
    schema,
    attributes,
    {
      credentialId: `cred-${Date.now()}`,
      issuedAt,
      visiblePaths: ['name', 'course'],
      credentialVersion: 'v2',
    },
  );

  const fileResult = await embedSignedCredentialInPdf({
    walletName,
    password,
    did: did.did,
    inputUri: inputPdfUri,
    outputUri: outputPdfUri,
    signedCredential,
    options: {createdAt},
  });

  const verification = await verifySignedCredentialPdf(outputPdfUri, didDocument);

  return {did, didDocument, signedCredential, fileResult, verification};
}
```

## Arquivos Relacionados

- `MANUAL_LIB_MOBILE_ANDROID_IOS.md`
- `packages/react-native/src/index.ts`
- `packages/react-native/src/node-compatible.ts`
- `packages/react-native/src/types.ts`
- `packages/react-native/example/minimal-flow.ts`
