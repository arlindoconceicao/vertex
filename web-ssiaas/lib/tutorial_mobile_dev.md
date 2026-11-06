# Guia de Arquitetura e Implementação do App Mobile
## Integração de Credenciais Verificáveis em Lote com Criptografia Pós-Quântica (SSI / NIST PQC)

Este documento é a especificação técnica e o guia de implementação para desenvolvedores de aplicativos móveis (**iOS, Android, React Native, Flutter**) que integrarão com a plataforma **SSIaaS (VeriFile)**.

O objetivo deste guia é fornecer todos os detalhes criptográficos, formatos de envelope binário, payloads JSON e chamadas de API REST para implementar as duas personas do aplicativo móvel:
1. **Carteira do Emissor (Issuer):** Gerencia chaves privadas ML-DSA de emissão, assina credenciais e cifra PDFs via ML-KEM para o titular.
2. **Carteira do Titular (Holder):** Gerencia chaves privadas ML-DSA de consentimento e ML-KEM de decifragem, recebe ofertas, autoriza emissões e armazena os certificados cifrados.

Nenhuma operação móvel acessa o banco de dados diretamente; todas as ações são executadas via endpoints HTTP REST autenticados com Prova de Posse (Proof-of-Possession).

---

## Sumário
1. [Arquitetura de Segurança e Comunicação](#1-arquitetura-de-segurança-e-comunicação)
2. [Criação e Gerenciamento da Wallet Local](#2-criação-e-gerenciamento-da-wallet-local)
3. [Passo 1: Pareamento do Dispositivo com a Plataforma Web](#3-passo-1-pareamento-do-dispositivo-com-a-plataforma-web)
4. [Passo 2: Emissão do Lote de Credenciais na Plataforma Web](#4-passo-2-emissão-do-lote-de-credenciais-na-plataforma-web)
5. [Passo 3: Consulta de Ofertas pelo Titular (Holder)](#5-passo-3-consulta-de-ofertas-pelo-titular-holder)
6. [Passo 4: Aceite ou Rejeição pelo Titular (Holder)](#6-passo-4-aceite-ou-rejeição-pelo-titular-holder)
7. [Passo 5: Assinatura Pós-Quântica pelo Emissor (Issuer)](#7-passo-5-assinatura-pós-quântica-pelo-emissor-issuer)
8. [Passo 6: Cifragem Híbrida (ML-KEM + AES-GCM) e Upload pelo Emissor](#8-passo-6-cifragem-híbrida-ml-kem--aes-gcm-e-upload-pelo-emissor)
9. [Passo 7: Download e Decifragem pelo Titular (Holder)](#9-passo-7-download-e-decifragem-pelo-titular-holder)
10. [Passo 8: Verificação Pública de Autenticidade](#10-passo-8-verificação-pública-de-autenticidade)
11. [Dicionário de Endpoints REST e Códigos de Status](#11-dicionário-de-endpoints-rest-e-códigos-de-status)

---

## 1. Arquitetura de Segurança e Comunicação

A comunicação entre o aplicativo móvel e a plataforma segue o padrão **M2M (Machine-to-Machine) com Prova de Posse Criptográfica (Proof-of-Possession - PoP)**. Toda requisição protegida exige **dois cabeçalhos HTTP simultâneos**:

```
+-----------------------------------------------------------------------------------------+
|                               PROTOCOLO DE SEGURANÇA M2M + PoP                          |
|                                                                                         |
|  Dispositivo Móvel                                                   Plataforma Web     |
|  +------------------------------+                                    +---------------+  |
|  | Chave Privada ML-DSA-65      |                                    | PostgreSQL    |  |
|  | Chave Privada ML-KEM-768     |                                    | didDocument   |  |
|  +------------------------------+                                    +---------------+  |
|                 |                                                            ^          |
|                 | 1. Assina Prova de Posse (PoP efêmero ML-DSA)              |          |
|                 | 2. Calcula Bearer HMAC(SIGNER_SECRET, DID)                 |          |
|                 v                                                            |          |
|        Headers HTTP da Requisição:                                           |          |
|        - Authorization: Bearer <HMAC-SHA256> ------------------------------> |          |
|        - x-signer-auth-credential: <Base64(SignedVC)> ---------------------> Validação  |
+-----------------------------------------------------------------------------------------+
```

### 1.1. Header `Authorization` (Bearer Token HMAC M2M)
Garante que o cliente conhece o segredo compartilhado da aplicação (`SIGNER_SECRET`) associado àquele DID:
* **Algoritmo:** HMAC-SHA-256
* **Entrada:** Chave = `SIGNER_SECRET`, Mensagem = `userDid` (ex: `did:ssipq:zERrY...`)
* **Saída:** String hexadecimal de 64 caracteres em minúsculas.
* **Header:**
  ```http
  Authorization: Bearer d3b07384d113edec49eaa6238ad5ff00b1965b206c9f658097b9196b01f92e6e
  ```

### 1.2. Header `x-signer-auth-credential` (Prova de Posse ML-DSA)
Garante o não-repúdio e impede replay attacks. Consiste em uma credencial verificável (VC) criada e assinada em tempo real com a chave privada **ML-DSA-65** da carteira:
* **Atributos do Subject:**
  ```json
  {
    "action": "<nome_da_acao>",
    "timestamp": "2026-10-29T17:00:00.000Z"
  }
  ```
* **Ações Válidas por Rota:**
  * Consulta de ofertas: `"offered_requests_auth"`
  * Aceite de credencial: `"accept_credential_auth"`
  * Rejeição de credencial: `"reject_credential_auth"`
  * Consulta de assinaturas pendentes: `"pending_requests_auth"`
  * Upload de lote assinado: `"sync_upload_auth"`
  * Download de credenciais ativas: `"available_credentials_auth"`
* **Regra do Servidor:** O servidor decodifica o Base64, busca o `didDocument` do usuário no banco, valida matematicamente a assinatura ML-DSA-65 e rejeita a requisição com HTTP 401 se $|t_{\text{servidor}} - t_{\text{timestamp}}| > 2 \text{ minutos}$.
* **Header:**
  ```http
  x-signer-auth-credential: eyJAY29udGV4dCI6WyJodHRwczovL3d3dy53M...
  ```

---

## 2. Criação e Gerenciamento da Wallet Local

O aplicativo móvel deve armazenar com segurança as chaves privadas geradas no dispositivo.

### 2.1. Armazenamento Seguro
* **Implementação de Referência (`lib/`):** Utiliza SQLite criptografado (SQLCipher) via biblioteca nativa `ssi_pq_core.node`.
* **Implementação Nativa (iOS / Android):** 
  * iOS: Keychain Services + SQLite com chave gerada no Secure Enclave.
  * Android: Android Keystore + EncryptedSharedPreferences / SQLCipher.

### 2.2. Geração do DID e Par de Chaves Pós-Quânticas
O aplicativo móvel gera uma identidade descentralizada baseada nos padrões W3C e NIST PQC:
1. **Assinatura Digital:** **ML-DSA-65** (FIPS 204 - Dilithium3)
2. **Cifragem / Encapsulamento:** **ML-KEM-768** (FIPS 203 - Kyber768)

#### Como a Wallet Local é criada:
```javascript
const core = require("./lib/ssi_pq_core.node");

// 1. Cria a base de dados SQLite criptografada com a senha local
core.walletCreate(walletPath, walletPassword, {
  createdAt: new Date().toISOString()
});

// 2. Gera o DID e as chaves pós-quânticas dentro da wallet segura
const didRecord = core.walletCreateDid(walletPath, walletPassword, {
  label: "Minha Carteira Móvel (usuario@email.com)",
  mldsa: "ML-DSA-65",
  mlkem: "ML-KEM-768",
  createdAt: new Date().toISOString()
});

const myDid = didRecord.did; // Formato: did:ssipq:zERrY2Yh8DNiXU2rTwabB8ZvZM36APdFA9yM9dKEMDGAt
const myDidDoc = core.walletGetDidDocument(walletPath, walletPassword, myDid);
```

#### Estrutura do `DID Document` gerado:
```json
{
  "id": "did:ssipq:zERrY2Yh8DNiXU2rTwabB8ZvZM36APdFA9yM9dKEMDGAt",
  "controller": "did:ssipq:zERrY2Yh8DNiXU2rTwabB8ZvZM36APdFA9yM9dKEMDGAt",
  "keys": [
    {
      "id": "#mldsa-1",
      "type": "ML-DSA-65",
      "public_key_multibase": "z2v5X4Wk4wT41f3dNuP...",
      "usage": ["authentication", "assertionMethod"]
    },
    {
      "id": "#mlkem-1",
      "type": "ML-KEM-768",
      "public_key_multibase": "zctHpB4Mx1s3a2ZVC8...",
      "usage": ["keyAgreement"]
    }
  ],
  "status": "active"
}
```

---

## 3. Passo 1: Pareamento do Dispositivo com a Plataforma Web

O pareamento conecta a conta web do usuário (identificada por e-mail ou sessão Google) ao DID criado na carteira móvel.

```
App Mobile                                                    Plataforma Web
    |                                                                |
    |  1. Escaneia QR Code contendo o Payload do Desafio             |
    |<---------------------------------------------------------------|
    |                                                                |
    |  2. Abre/cria a wallet local e obtém o DID + chaves públicas   |
    |                                                                |
    |  3. POST /api/v1/did-pairings/{pairingId}/complete             |
    |--------------------------------------------------------------->|
    |     Body: { pairingId, did, didDocument, mlDsaPubKey, ... }    |
    |                                                                |
    |  4. HTTP 200 OK (Pareamento Concluído)                         |
    |<---------------------------------------------------------------|
```

### 3.1. Leitura do QR Code
Na tela de Configurações da plataforma web (`/settings`), ao clicar em "Iniciar Pareamento", a web gera um desafio contendo:
```json
{
  "id": "cmvtrqj830001yyxkocspx5x1",
  "pairingId": "8f2a1b9c-...",
  "nonce": "7c9e0d1f...",
  "expiresAt": "2026-10-29T17:10:00.000Z",
  "endpoint": "http://localhost:3000/api/v1/did-pairings/8f2a1b9c-.../complete",
  "email": "usuario@teste.com"
}
```

### 3.2. Chamada de Conclusão do Pareamento (Mobile -> Web)
O app móvel envia a requisição HTTP POST para o endpoint recebido no QR Code:
* **Método:** `POST`
* **URL:** `/api/v1/did-pairings/{pairingId}/complete`
* **Headers:** `Content-Type: application/json`
* **Body:**
  ```json
  {
    "pairingId": "8f2a1b9c-...",
    "nonce": "7c9e0d1f...",
    "email": "usuario@teste.com",
    "did": "did:ssipq:zERrY2Yh8DNiXU2rTwabB8ZvZM36APdFA9yM9dKEMDGAt",
    "didDocument": { ... },
    "mlDsaPublicKey": "z2v5X4Wk4wT41f3dNuP...",
    "mlKemPublicKey": "zctHpB4Mx1s3a2ZVC8..."
  }
  ```

### 3.3. Script de Referência
```bash
node lib/complete-pairing.js 'JSON_DO_QRCODE' --wallet lib/issuer_wallet.db
```

---

## 4. Passo 2: Emissão do Lote de Credenciais na Plataforma Web

Esta etapa é executada pelo Emissor na interface Web:
1. Em `/schemas`, o emissor seleciona ou cria um esquema de credencial (ex: `Certificado`).
2. Em `/credentials/issue` (aba "Emissão em Lote"), faz o download do modelo CSV.
3. Preenche o CSV com os dados e o e-mail do titular cadastrado na coluna `HolderEmail`:
   ```csv
   HolderEmail,Nome,Curso,Data
   titular@teste.com,Carlos Silva,Segurança Pós-Quântica,01/01/2026
   titular@teste.com,Mariana Souza,Identidade Auto-Soberana,01/02/2026
   ```
4. Envia o arquivo CSV e clica em **Emitir Lote**.
5. As credenciais são inseridas no banco de dados com o status **`OFFERED`** agrupadas pelo mesmo `batchId`.

> **Princípio SSI:** Nenhuma credencial entra na carteira ativa do usuário sem o seu consentimento prévio e explícito.

---

## 5. Passo 3: Consulta de Ofertas pelo Titular (Holder)

O aplicativo do titular consulta periodicamente (polling ou push notification) se existem novas ofertas de credenciais destinadas ao seu DID.

### 5.1. Chamada de API
* **Método:** `GET`
* **URL:** `/api/signer/requests/offered`
* **Headers Obrigatórios:**
  * `Authorization: Bearer <HMAC-SHA256(SIGNER_SECRET, holderDid)>`
  * `x-signer-auth-credential: <Base64(PoP com action: "offered_requests_auth")>`

### 5.2. Resposta do Servidor (HTTP 200)
```json
[
  {
    "requestId": "cmvtry7o70005yyxkj12icj9y",
    "batchId": "22b4c2c6-5934-450a-bbc1-8601b5d4be8b",
    "createdAt": "2026-10-29T16:45:27.503Z",
    "issuer": {
      "name": "Universidade Exemplo",
      "did": "did:ssipq:zERrY2Yh8DNiXU2rTwabB8ZvZM36APdFA9yM9dKEMDGAt"
    },
    "unsignedPayload": {
      "@context": [
        "https://www.w3.org/2018/credentials/v1",
        "http://localhost:3000/api/schemas/cmvtrw0xe0004yyxksydszpw0"
      ],
      "type": ["VerifiableCredential", "Certificado"],
      "issuer": "did:ssipq:zERrY...",
      "issuanceDate": "2026-10-29T16:45:27.503Z",
      "expirationDate": "2027-10-30T00:00:00.000Z",
      "credentialSubject": {
        "id": "did:ssipq:zHolderDid...",
        "Nome": "Carlos Silva",
        "Curso": "Segurança Pós-Quântica",
        "Data": "01/01/2026"
      }
    }
  }
]
```

### 5.3. Script de Referência
```bash
node lib/get-batch-credentials.js --wallet lib/holder_wallet.db
```

---

## 6. Passo 4: Aceite ou Rejeição pelo Titular (Holder)

Após inspecionar os dados na tela do celular, o titular decide aceitar ou recusar a oferta.

### 6.1. Aceite Individual
* **Método:** `POST`
* **URL:** `/api/signer/requests/offered/{requestId}/accept`
* **Headers:** 
  * `Authorization: Bearer <HMAC>`
  * `x-signer-auth-credential: <Base64(PoP com action: "accept_credential_auth")>`
* **Resposta (HTTP 200):**
  ```json
  {
    "success": true,
    "message": "Credential accepted successfully and moved to PENDING.",
    "credential": {
      "id": "cmvtry7o70005yyxkj12icj9y",
      "status": "PENDING",
      "batchId": "22b4c2c6-5934-450a-bbc1-8601b5d4be8b"
    }
  }
  ```

### 6.2. Aceite em Lote (Batch Accept)
Para permitir que o usuário aprove todas as ofertas do lote com um único toque:
* **Método:** `POST`
* **URL:** `/api/signer/requests/offered/batch-accept`
* **Headers:** `Authorization`, `x-signer-auth-credential`
* **Body:**
  ```json
  {
    "batchId": "22b4c2c6-5934-450a-bbc1-8601b5d4be8b"
  }
  ```
  *(ou `{ "credentialIds": ["id1", "id2"] }`)*

### 6.3. Rejeição
* **Método:** `POST`
* **URL:** `/api/signer/requests/offered/{requestId}/reject`
* Move o status para `REJECTED`.

### 6.4. Script de Referência
```bash
node lib/holder-accept-offer.js --wallet lib/holder_wallet.db
```

---

## 7. Passo 5: Assinatura Pós-Quântica pelo Emissor (Issuer)

Assim que o titular aceita a credencial, ela transaciona para **`PENDING`**. O app do Emissor detecta a pendência e realiza a assinatura criptográfica no dispositivo.

### 7.1. Consulta de Pendências (Emissor)
* **Método:** `GET`
* **URL:** `/api/signer/requests/pending`
* **Headers:** `Authorization`, `x-signer-auth-credential` (`action: "pending_requests_auth"`)
* **Retorno:** Todas as credenciais aceitas aguardando assinatura.

### 7.2. Geração do Documento e Assinatura ML-DSA no Celular
Para cada credencial do lote:
```javascript
// 1. Assina a credencial verificável usando a chave privada ML-DSA-65 da carteira
const signedVcPayload = core.walletIssueCredentialFromSchema(
  walletPath,
  walletPassword,
  issuerDid,
  dynamicSchema,
  credentialData,
  issueOptions
);

// 2. Renderiza o layout visual do PDF com carimbo e QR Code
const pdfBaseBuffer = Buffer.from(
  core.signedCredentialToPdf(signedVcPayload, { labels: pdfLabels })
);

// 3. Embute a credencial verificável assinada dentro do manifesto do arquivo PDF
const finalPdfBuffer = Buffer.from(
  core.walletEmbedSignedCredentialInPdf(
    walletPath,
    walletPassword,
    issuerDid,
    pdfBaseBuffer,
    signedVcPayload
  )
);

// 4. Calcula o Hash SHA-256 do PDF gerado
const pdfHash = crypto.createHash("sha256").update(finalPdfBuffer).digest("hex");
```

---

## 8. Passo 6: Cifragem Híbrida (ML-KEM + AES-GCM) e Upload pelo Emissor

Para garantir privacidade estrita, a plataforma **nunca armazena PDFs legíveis**. O emissor cifra o PDF com a chave pública pós-quântica do titular antes de fazer o envio.

```
+-----------------------------------------------------------------------------------------+
|                              ESTRUTURA DO ENVELOPE CIFRADO                              |
|                                                                                         |
| [ 4 bytes ]        [ 1088 bytes ]    [ 12 bytes ]   [ 16 bytes ]     [ N bytes ]        |
| Tamanho Cápsula    Cápsula ML-KEM    Nonce AES      Auth Tag GCM     Ciphertext PDF     |
| (UInt32 BigEndian) (Kyber768 Encaps) (Vetor Inicial) (Autenticação)  (Cifrado com AES)  |
+-----------------------------------------------------------------------------------------+
```

### 8.1. Obtenção da Chave Pública ML-KEM do Titular
* **Método:** `GET`
* **URL:** `/api/signer/recipient-key/{holderDid}`
* **Headers:** `Authorization: Bearer <HMAC>`, `x-signer-auth-credential`
* **Retorno:** `DID Document` contendo a chave `type: "ML-KEM-768"` em multibase.

### 8.2. Cifragem no Dispositivo Móvel
1. **Encapsulamento ML-KEM:**
   ```javascript
   const encapsulation = core.mlkemEncapsulate("ML-KEM-768", recipientPubKeyBase64url);
   const sharedSecret = core.base64urlDecode(encapsulation.sharedSecret); // 32 bytes
   const capsulaRaw = core.base64urlDecode(encapsulation.ciphertext);     // 1088 bytes
   ```
2. **Cifragem Simétrica com AES-256-GCM:**
   ```javascript
   const encrypted = core.aes256GcmEncrypt(sharedSecret, finalPdfBuffer);
   // Retorna: { ciphertext, nonce (12 bytes), authTag (16 bytes) }
   ```
3. **Montagem do Buffer Binário:**
   ```javascript
   const combinedBuffer = Buffer.concat([
     Buffer.alloc(4),
     capsulaRaw,
     Buffer.from(encrypted.nonce),
     Buffer.from(encrypted.authTag),
     Buffer.from(encrypted.ciphertext)
   ]);
   combinedBuffer.writeUInt32BE(capsulaRaw.length, 0);
   ```

### 8.3. Upload para a Plataforma (HTTP Multipart)
* **Método:** `POST`
* **URL:** `/api/signer/callback`
* **Headers:** 
  * `Authorization: Bearer <HMAC>`
  * `Content-Type: multipart/form-data`
* **Campos do Formulário:**
  * `metadata`: JSON contendo `{ requestId, issuerDid, recipientDid, pdfHash, timestamp }`
  * `signedPayload`: JSON-LD da VC assinada com ML-DSA
  * `encryptedPdf`: Arquivo binário do buffer cifrado (`combinedBuffer`)
* **Resultado:** O backend valida o `pdfHash` contra os metadados, persiste o PDF cifrado e atualiza o status para **`ACTIVE`**.

### 8.4. Script de Referência
```bash
node lib/sign-batch-credentials.js --upload --wallet lib/issuer_wallet.db
```

---

## 9. Passo 7: Download e Decifragem pelo Titular (Holder)

O titular acessa sua carteira móvel para resgatar os certificados oficiais.

```
App Titular (Holder)                                          Plataforma Web
    |                                                                |
    |  1. GET /api/signer/credentials/available                      |
    |--------------------------------------------------------------->|
    |     Retorna lista de credenciais com status ACTIVE             |
    |<---------------------------------------------------------------|
    |                                                                |
    |  2. GET /api/signer/download-pdf/{credentialId}                |
    |--------------------------------------------------------------->|
    |     Retorna o arquivo binário do Envelope Cifrado              |
    |<---------------------------------------------------------------|
    |                                                                |
    |  3. Decapsula com Chave Privada ML-KEM-768 da Carteira         |
    |  4. Decifra com AES-256-GCM                                    |
    |  5. Salva o PDF Original localmente                            |
```

### 9.1. Decifragem no Dispositivo Móvel
1. **Lê o Envelope:**
   ```javascript
   const capsulaLength = encryptedBuffer.readUInt32BE(0); // 1088 bytes
   const capsulaRaw = encryptedBuffer.slice(4, 4 + capsulaLength);
   const nonce = encryptedBuffer.slice(4 + capsulaLength, 4 + capsulaLength + 12);
   const authTag = encryptedBuffer.slice(4 + capsulaLength + 12, 4 + capsulaLength + 28);
   const ciphertext = encryptedBuffer.slice(4 + capsulaLength + 28);
   ```
2. **Decapsulamento com a Chave Privada da Carteira:**
   ```javascript
   const sharedSecretBase64url = core.walletMlkemDecapsulate(
     walletPath,
     walletPassword,
     holderDid,
     core.base64urlEncode(capsulaRaw)
   );
   const sharedSecret = core.base64urlDecode(sharedSecretBase64url);
   ```
3. **Decifragem com AES-256-GCM:**
   ```javascript
   const decryptedPdfBuffer = core.aes256GcmDecrypt(sharedSecret, {
     ciphertext,
     nonce,
     authTag
   });
   // decryptedPdfBuffer contém o PDF original assinado!
   ```

### 9.2. Script de Referência
```bash
node lib/simulate-mobile-download.js --wallet lib/holder_wallet.db
```

---

## 10. Passo 8: Verificação Pública de Autenticidade

A credencial é auto-verificável sem a necessidade de acessar credenciais secretas do usuário.
* Qualquer terceiro pode acessar `http://localhost:3000/verify`.
* Ao fazer o upload do PDF ou informar o hash SHA-256, a plataforma:
  1. Extrai o manifesto do PDF embutido pelo emissor.
  2. Obtém o `issuer_did` da credencial.
  3. Consulta o DID Document e a chave pública ML-DSA-65 correspondente.
  4. Executa a verificação matemática `core.verifySignedCredentialPdf(...)` e atesta a validade jurídica e técnica do documento.

---

## 11. Dicionário de Endpoints REST e Códigos de Status

| Método | Endpoint | Papel | Headers Exigidos | Códigos de Retorno |
| :---: | :--- | :---: | :--- | :--- |
| `POST` | `/api/v1/did-pairings/{id}/complete` | Ambos | `Content-Type: application/json` | `200` (OK)<br>`400` (Dados inválidos)<br>`404` (Desafio não encontrado)<br>`409` (Já pareado) |
| `GET` | `/api/signer/requests/offered` | Titular | `Authorization`<br>`x-signer-auth-credential` | `200` (Array de ofertas)<br>`401` (Não autorizado / PoP inválido) |
| `POST` | `/api/signer/requests/offered/{id}/accept` | Titular | `Authorization`<br>`x-signer-auth-credential` | `200` (Status -> PENDING)<br>`400` (Não está OFFERED)<br>`403` (Não é o titular) |
| `POST` | `/api/signer/requests/offered/{id}/reject` | Titular | `Authorization`<br>`x-signer-auth-credential` | `200` (Status -> REJECTED)<br>`400` (Não está OFFERED) |
| `POST` | `/api/signer/requests/offered/batch-accept` | Titular | `Authorization`<br>`x-signer-auth-credential` | `200` (Total de aceitas no lote) |
| `GET` | `/api/signer/requests/pending` | Emissor | `Authorization`<br>`x-signer-auth-credential` | `200` (Array de credenciais para assinar) |
| `GET` | `/api/signer/recipient-key/{did}` | Emissor | `Authorization`<br>`x-signer-auth-credential` | `200` (DID Document com ML-KEM) |
| `POST` | `/api/signer/callback` | Emissor | `Authorization`<br>`Content-Type: multipart/form-data` | `200` (Status -> ACTIVE)<br>`400` (Hash divergente) |
| `GET` | `/api/signer/credentials/available` | Titular | `Authorization`<br>`x-signer-auth-credential` | `200` (Array de credenciais ativas para download) |
| `GET` | `/api/signer/download-pdf/{id}` | Titular | `Authorization` | `200` (Buffer binário application/octet-stream)<br>`403` (Proibido) |
