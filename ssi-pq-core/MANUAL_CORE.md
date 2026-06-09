# Manual da Biblioteca Core SSI-PQ

Este manual descreve as funções expostas pelo módulo Node.js `ssi_pq_core.node`. Os tipos abaixo usam a visão do JavaScript:

- `Buffer`: bytes binários do Node.js.
- `string`: texto JavaScript.
- `boolean`: verdadeiro ou falso.
- `object`: objeto JSON.
- `Value`: qualquer valor JSON aceito por `serde_json`, normalmente um objeto.
- `Profile ML-DSA`: `"ML-DSA-44"`, `"ML-DSA-65"` ou `"ML-DSA-87"`.
- `Profile ML-KEM`: `"ML-KEM-512"`, `"ML-KEM-768"` ou `"ML-KEM-1024"`.

Observação sobre nomes de campos: objetos retornados diretamente por structs N-API usam `camelCase`, como `publicKey`, `privateKey`, `sharedSecret`, `authTag`, `didDocument` e `privateKeys`. Objetos serializados como JSON interno do core preservam os nomes do Rust/JSON, em geral `snake_case`, como `pdf_base_hash_valid`, `did_count`, `created_at` e `credential_id`.

## Tipos de Opções

### `DidCreateOptions`

```ts
{
  mldsa?: string,
  mlkem?: string,
  createdAt?: string
}
```

Define os perfis das chaves ML-DSA e ML-KEM e o timestamp RFC 3339 usado no DID Document. Quando omitidos, os perfis padrão são `ML-DSA-65` e `ML-KEM-768`, e o timestamp é o horário UTC atual.

### `SchemaCreateOptions`

```ts
{
  version?: string,
  createdAt?: string
}
```

Define a versão lógica e o timestamp RFC 3339 do Schema. Quando omitidos, usa versão `"1"` e o horário UTC atual.

### `CredentialIssueOptions`

```ts
{
  credentialId?: string,
  issuedAt?: string,
  expiresAt?: string,
  statusRef?: object,
  visiblePaths?: string[],
  credentialVersion?: string
}
```

Controla a emissão da credencial. `visiblePaths` define quais atributos serão revelados; os demais ficam comprometidos pela árvore de Merkle. `credentialVersion` usa `"v2"` por padrão e aceita `"v1"` para compatibilidade.

### `PdfBindingOptions`

```ts
{
  createdAt?: string,
  didDocCid?: string
}
```

Define o timestamp RFC 3339 do vínculo PDF↔credencial e, opcionalmente, o CID do DID Document publicado.

### `PdfRenderOptions`

```ts
{
  labels?: Record<string, string>
}
```

Permite trocar os rótulos exibidos no PDF visual para caminhos de atributos, inclusive caminhos aninhados como `"titular.documento.numero"`.

### `PdfSignOptions`

```ts
{
  createdAt?: string,
  didDocCid?: string,
  visualSignature?: {
    mode?: "invisible" | "visible",
    placement?: "firstPageFooter" | "footer" | "firstPageRightMargin" | "rightMargin",
    text?: string
  }
}
```

Controla a assinatura de PDF genérico. Por padrão, a assinatura visual é invisível. Quando `mode` é `"visible"`, o core cria um widget de assinatura na primeira página.

### `WalletCreateOptions`

```ts
{
  createdAt?: string
}
```

Define o timestamp RFC 3339 gravado nos metadados da wallet. Quando omitido, usa o horário UTC atual.

### `WalletDidCreateOptions`

```ts
{
  label?: string,
  mldsa?: string,
  mlkem?: string,
  createdAt?: string,
  didDocCid?: string
}
```

Define rótulo local, perfis de chave, timestamp e CID opcional ao criar um DID dentro da wallet.

## Funções

### 1. `canonicalJson`

1. Parâmetros:
   - `json: string`
2. Retorno:
   - `string`

Recebe uma string JSON, interpreta o conteúdo e retorna sua representação canônica. A canonicalização ordena chaves de objetos recursivamente, preserva a ordem de arrays e produz uma string estável para hash, assinatura e comparação criptográfica. Se a string não for JSON válido, lança erro JavaScript.

### 2. `canonicalJsonHashBase64url`

1. Parâmetros:
   - `json: string`
2. Retorno:
   - `string`

Canonicaliza a string JSON recebida, calcula SHA3-256 sobre os bytes canônicos e retorna o digest em base64url sem padding. É útil para comparar JSONs semanticamente iguais mesmo quando as chaves aparecem em ordens diferentes.

### 3. `schemaHashBase64`

1. Parâmetros:
   - `schema: object`
2. Retorno:
   - `string`

Recebe um Schema SSI-PQ em JSON, valida sua estrutura interna e calcula o hash SHA3-256/Base64 da definição lógica do Schema. Esse hash identifica o Schema de forma estável.

### 4. `issuerIdentifierBase64`

1. Parâmetros:
   - `didDocument: object`
2. Retorno:
   - `string`

Calcula o identificador SHA3-256/Base64 do emissor a partir do DID Document público. Esse identificador é usado dentro das credenciais para vincular a credencial ao emissor sem depender apenas de texto livre.

### 5. `sha3_256Base64url`

1. Parâmetros:
   - `bytes: Buffer`
2. Retorno:
   - `string`

Calcula SHA3-256 dos bytes recebidos e retorna o digest em base64url sem padding.

### 6. `sha3_256Hex`

1. Parâmetros:
   - `bytes: Buffer`
2. Retorno:
   - `string`

Calcula SHA3-256 dos bytes recebidos e retorna o digest em hexadecimal.

### 7. `base64urlEncode`

1. Parâmetros:
   - `bytes: Buffer`
2. Retorno:
   - `string`

Codifica bytes em base64url sem padding. É usado para transportar chaves, assinaturas, ciphertexts e hashes em JSON.

### 8. `base64urlDecode`

1. Parâmetros:
   - `value: string`
2. Retorno:
   - `Buffer`

Decodifica uma string base64url sem padding e retorna os bytes correspondentes em um `Buffer`. Se o valor não for base64url válido, lança erro JavaScript.

### 9. `secureRandomKey`

1. Parâmetros:
   - `length: number`
2. Retorno:
   - `Buffer`

Gera material de chave aleatório seguro dentro do core Rust. Para tamanhos até 32 bytes, usa diretamente a fonte segura do sistema operacional. Para tamanhos maiores, gera um seed seguro de 32 bytes e expande com SHAKE256 usando separação de domínio. Rejeita tamanho zero e tamanhos acima do limite defensivo interno.

### 10. `supportedProfiles`

1. Parâmetros:
   - nenhum
2. Retorno:
   - `string[]`

Retorna a lista de perfis criptográficos pós-quânticos suportados pela API pública atual: ML-DSA e ML-KEM nos tamanhos implementados.

### 11. `mldsaGenerateKeypair`

1. Parâmetros:
   - `profile: string`
2. Retorno:
   - `{ profile: string, publicKey: string, privateKey: string }`

Gera um par de chaves ML-DSA para assinatura digital pós-quântica. As chaves retornam em base64url sem padding. A chave privada deve ser tratada como material sensível.

### 12. `mldsaSign`

1. Parâmetros:
   - `profile: string`
   - `privateKey: string`
   - `message: Buffer`
   - `context: string`
2. Retorno:
   - `string`

Assina `message` usando ML-DSA e a chave privada em base64url. O `context` é usado como separador de domínio criptográfico, impedindo que uma assinatura válida em um contexto seja reutilizada indevidamente em outro. Retorna a assinatura em base64url sem padding.

### 13. `mldsaVerify`

1. Parâmetros:
   - `profile: string`
   - `publicKey: string`
   - `message: Buffer`
   - `context: string`
   - `signature: string`
2. Retorno:
   - `boolean`

Verifica uma assinatura ML-DSA. A chave pública e a assinatura são recebidas em base64url sem padding. Retorna `true` apenas se a assinatura, a mensagem, o perfil e o contexto forem compatíveis.

### 14. `mlkemGenerateKeypair`

1. Parâmetros:
   - `profile: string`
2. Retorno:
   - `{ profile: string, publicKey: string, privateKey: string }`

Gera um par de chaves ML-KEM para encapsulamento de segredo compartilhado. As chaves retornam em base64url sem padding. A chave privada deve permanecer secreta.

### 15. `mlkemEncapsulate`

1. Parâmetros:
   - `profile: string`
   - `publicKey: string`
2. Retorno:
   - `{ profile: string, ciphertext: string, sharedSecret: string }`

Encapsula um segredo compartilhado para a chave pública ML-KEM informada. Retorna o ciphertext que deve ser enviado ao destinatário e o segredo compartilhado do remetente, ambos em base64url sem padding. O segredo compartilhado é material de chave pseudoaleatório.

### 16. `mlkemDecapsulate`

1. Parâmetros:
   - `profile: string`
   - `privateKey: string`
   - `ciphertext: string`
2. Retorno:
   - `string`

Decapsula um segredo compartilhado usando a chave privada ML-KEM e o ciphertext recebido. Retorna o mesmo segredo compartilhado obtido pelo encapsulador, em base64url sem padding, desde que a chave privada corresponda à chave pública usada no encapsulamento.

### 17. `aes256GcmEncrypt`

1. Parâmetros:
   - `key: Buffer`
   - `plaintext: Buffer`
   - `aad?: Buffer`
2. Retorno:
   - `{ ciphertext: Buffer, nonce: Buffer, authTag: Buffer }`

Cifra bytes com AES-256-GCM. A chave deve ter exatamente 32 bytes. A função gera internamente um nonce aleatório de 96 bits e separa o tag de autenticação GCM em `authTag`. O parâmetro opcional `aad` autentica dados associados sem cifrá-los.

### 18. `aes256GcmDecrypt`

1. Parâmetros:
   - `key: Buffer`
   - `ciphertext: Buffer`
   - `nonce: Buffer`
   - `authTag: Buffer`
   - `aad?: Buffer`
2. Retorno:
   - `Buffer`

Decifra e autentica dados AES-256-GCM. A chave deve ter 32 bytes, o nonce deve ter 12 bytes e o tag deve ter 16 bytes. Se o ciphertext, o nonce, o tag ou o `aad` não conferirem, a função lança erro.

### 19. `createDid`

1. Parâmetros:
   - `options: DidCreateOptions`
2. Retorno:
   - `{ did: string, fingerprint: string, didDocument: object, privateKeys: object }`

Cria um DID SSI-PQ com chaves públicas ML-DSA e ML-KEM, monta o DID Document público e assina o documento. O retorno inclui o DID, o fingerprint multibase, o DID Document e chaves privadas em `privateKeys`. Este retorno com chaves privadas é útil para testes e protótipos; para produção, prefira o fluxo de wallet.

### 20. `didVerify`

1. Parâmetros:
   - `didDocument: object`
2. Retorno:
   - `boolean`

Verifica a assinatura do DID Document e a coerência geral do documento. Retorna `true` apenas se o DID Document estiver assinado corretamente e for consistente.

### 21. `didFingerprintMatchesKeys`

1. Parâmetros:
   - `didDocument: object`
2. Retorno:
   - `boolean`

Verifica se o identificador DID corresponde ao fingerprint derivado das chaves públicas declaradas no DID Document.

### 22. `createSchemaFromAttributes`

1. Parâmetros:
   - `attributes: object`
   - `options?: SchemaCreateOptions`
2. Retorno:
   - `object`

Cria um Schema SSI-PQ padronizado a partir de um objeto de atributos. O core infere caminhos de atributos, inclusive aninhados, e tipos primitivos. O Schema resultante é usado para emitir credenciais com validação estrutural e provas de revelação seletiva.

### 23. `issueCredentialFromSchema`

1. Parâmetros:
   - `schema: object`
   - `attributes: object`
   - `issuerDidDocument: object`
   - `issuerPrivateKey: string`
   - `options?: CredentialIssueOptions`
2. Retorno:
   - `object`

Emite uma credencial SSI-PQ assinada a partir de um Schema, atributos e DID Document do emissor. Valida os atributos contra o Schema, cria compromissos Merkle para os atributos, inclui apenas os atributos revelados em `visiblePaths` e assina a credencial com ML-DSA usando a chave privada do emissor em base64url.

### 24. `verifySignedCredential`

1. Parâmetros:
   - `signedCredential: object`
   - `issuerDidDocument: object`
2. Retorno:
   - `boolean`

Verifica criptograficamente uma credencial assinada. A verificação cobre DID do emissor, validade do DID Document, assinatura ML-DSA da credencial e provas Merkle dos atributos revelados.

### 25. `signedCredentialToPdf`

1. Parâmetros:
   - `signedCredential: object`
   - `options?: PdfRenderOptions`
2. Retorno:
   - `Buffer`

Gera um PDF visual simples a partir de uma credencial assinada. O PDF mostra as informações da credencial em linguagem de usuário, incluindo atributos revelados, emissor e dados básicos de assinatura. Esse PDF ainda é o PDF-base visual; para criar o PDF final verificável, use `embedSignedCredentialInPdf` ou `walletEmbedSignedCredentialInPdf`.

### 26. `embedSignedCredentialInPdf`

1. Parâmetros:
   - `pdfBase: Buffer`
   - `signedCredential: object`
   - `issuerDidDocument: object`
   - `issuerPrivateKey: string`
   - `options?: PdfBindingOptions`
2. Retorno:
   - `Buffer`

Embute uma credencial assinada em um PDF-base e assina o vínculo PDF↔credencial. Antes de embutir, valida a credencial contra o DID do emissor. O retorno é o PDF final com manifesto SSI-PQ anexado como atualização incremental, contendo a credencial JSON e o vínculo criptográfico com o PDF-base.

### 27. `extractCredentialManifestFromPdf`

1. Parâmetros:
   - `pdfBytes: Buffer`
2. Retorno:
   - `object`

Extrai o manifesto SSI-PQ embutido em um PDF-credencial. Esta função existe para inspeção e depuração; ela não substitui `verifySignedCredentialPdf`, pois apenas lê o JSON interno.

### 28. `verifySignedCredentialPdf`

1. Parâmetros:
   - `pdfBytes: Buffer`
   - `issuerDidDocument: object`
2. Retorno:
   - `object`

Verifica integralmente um PDF-credencial emitido pelo core. A verificação cobre manifesto, DID do emissor, assinatura da credencial JSON interna, provas Merkle, hash da credencial, hash do PDF-base, assinatura do vínculo PDF↔credencial e exigência de que o manifesto seja a revisão final do PDF. O retorno contém campos como `valid`, `status`, `errors`, `pdf_base_hash_valid`, `credential_signature_valid`, `document_binding_signature_valid`, `manifest_is_final_revision`, `did_key_match`, `manifest` e `signed_credential`.

### 29. `extractGenericSignatureManifestFromPdf`

1. Parâmetros:
   - `pdfBytes: Buffer`
2. Retorno:
   - `object`

Extrai o manifesto de assinatura genérica SSI-PQ embutido em um PDF. Serve para inspeção e depuração do JSON interno de assinatura genérica.

### 30. `verifySignedGenericPdf`

1. Parâmetros:
   - `pdfBytes: Buffer`
   - `signerDidDocument: object`
2. Retorno:
   - `object`

Verifica um PDF genérico assinado pelo core. A verificação cobre o DID do assinante, hash do PDF original, assinatura ML-DSA destacada sobre o `/ByteRange`, manifesto embutido e exigência de que o manifesto seja a atualização incremental final. O retorno contém campos como `valid`, `status`, `signer_did`, `pdf_base_hash_valid`, `signature_valid`, `manifest_is_final_revision`, `did_key_match`, `errors` e `manifest`.

### 31. `walletCreate`

1. Parâmetros:
   - `path: string`
   - `password: string`
   - `options?: WalletCreateOptions`
2. Retorno:
   - `object`

Cria uma wallet SQLite cifrada por SQLCipher no caminho informado. A senha abre o banco e também é usada para derivar, via Argon2id, uma chave de linha para cifrar chaves privadas armazenadas. Retorna metadados públicos da wallet, como `wallet_id`, `version`, `created_at`, `did_count` e `sqlcipher_version`.

### 32. `walletOpen`

1. Parâmetros:
   - `path: string`
   - `password: string`
2. Retorno:
   - `object`

Abre uma wallet cifrada e retorna metadados públicos. Se a senha estiver errada, a wallet estiver corrompida ou o arquivo não puder ser aberto corretamente, lança erro.

### 33. `walletChangePassword`

1. Parâmetros:
   - `path: string`
   - `oldPassword: string`
   - `newPassword: string`
2. Retorno:
   - `object`

Troca a senha da wallet. A função abre a wallet com a senha antiga, recifra o banco SQLCipher, deriva nova chave de linha com Argon2id e recifra as chaves privadas armazenadas. Retorna os metadados públicos atualizados.

### 34. `walletCreateDid`

1. Parâmetros:
   - `path: string`
   - `password: string`
   - `options: WalletDidCreateOptions`
2. Retorno:
   - `object`

Cria um DID dentro da wallet sem exportar as chaves privadas. O DID Document público é retornado, mas as chaves privadas ficam cifradas na wallet. O retorno inclui campos como `did`, `fingerprint`, `did_document`, `label` e `created_at`.

### 35. `walletListDids`

1. Parâmetros:
   - `path: string`
   - `password: string`
2. Retorno:
   - `object[]`

Lista os DIDs armazenados na wallet. O retorno é uma lista JSON de resumos públicos contendo campos como `did`, `label`, `mldsa_alg`, `mlkem_alg`, `status`, `created_at` e `did_doc_cid`.

### 36. `walletGetDidDocument`

1. Parâmetros:
   - `path: string`
   - `password: string`
   - `did: string`
2. Retorno:
   - `object`

Recupera o DID Document público armazenado na wallet para o DID informado. Não exporta chaves privadas.

### 37. `walletIssueCredentialFromSchema`

1. Parâmetros:
   - `path: string`
   - `password: string`
   - `did: string`
   - `schema: object`
   - `attributes: object`
   - `options?: CredentialIssueOptions`
2. Retorno:
   - `object`

Emite uma credencial usando a chave privada ML-DSA armazenada na wallet. O fluxo é equivalente a `issueCredentialFromSchema`, mas a chave privada não sai da wallet: o core abre a wallet, decifra a chave internamente, assina a credencial e retorna apenas a credencial assinada.

### 38. `walletEmbedSignedCredentialInPdf`

1. Parâmetros:
   - `path: string`
   - `password: string`
   - `did: string`
   - `pdfBase: Buffer`
   - `signedCredential: object`
   - `options?: PdfBindingOptions`
2. Retorno:
   - `Buffer`

Embute uma credencial assinada em PDF usando a chave privada ML-DSA guardada na wallet. O core valida a credencial, cria e assina o vínculo PDF↔credencial internamente e retorna o PDF final verificável, sem exportar a chave privada.

### 39. `walletSignGenericPdf`

1. Parâmetros:
   - `path: string`
   - `password: string`
   - `did: string`
   - `pdfBase: Buffer`
   - `options?: PdfSignOptions`
2. Retorno:
   - `Buffer`

Assina um PDF genérico usando a chave privada ML-DSA armazenada na wallet. O retorno é um PDF final com assinatura SSI-PQ, manifesto embutido, `/ByteRange` e `/Contents`. Pode gerar assinatura invisível ou visual conforme `visualSignature`.

### 40. `walletMlkemDecapsulate`

1. Parâmetros:
   - `path: string`
   - `password: string`
   - `did: string`
   - `ciphertext: string`
2. Retorno:
   - `string`

Decapsula um segredo ML-KEM usando a chave privada ML-KEM guardada na wallet. O ciphertext deve estar em base64url sem padding. Retorna o segredo compartilhado em base64url sem padding, sem exportar a chave privada.
