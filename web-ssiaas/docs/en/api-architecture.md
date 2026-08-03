# Vertex Web SSIaaS — API Architecture

> **Stack:** Next.js App Router · REST · TypeScript · Post-Quantum Cryptography (ML-DSA-65 & ML-KEM-768)  
> **Base URL (dev):** `http://localhost:3000/api`  
> **Authentication:** 
> - **Web Platform:** Active Session (Auth.js / Google OIDC).
> - **Mobile Signer (Defense in Depth):** 
>   1. **PoP:** Post-Quantum Proof-of-Possession via signed ML-DSA Verifiable Credential in HTTP Header `x-signer-auth-credential`.
>   2. **M2M:** Personalized Bearer Token (HMAC-SHA256 of DID using server secret) in HTTP Header `Authorization: Bearer <token>`.

---

## Architectural Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Web Platform                         │
│                  (Next.js — Issuer UI)                  │
│                                                         │
│  1. Issuer fills credential form                        │
│  2. POST /api/credentials → creates unsigned payload    │
│  3. Saves unsigned VC in PostgreSQL (status: PENDING)   │
└──────────────────────┬──────────────────────────────────┘
                       │ Signing Request awaiting mobile signature
                       ▼
┌─────────────────────────────────────────────────────────┐
│                  Mobile Signer App                      │
│                                                         │
│  4. GET /api/signer/requests/pending → PoP Auth        │
│  5. GET /api/signer/recipient-key/:did → gets ML-KEM    │
│  6. Signs VC (ML-DSA-65) & Encrypts PDF (AES-GCM/KEM)   │
│  7. POST /api/signer/callback → returns signed & enc PDF│
└──────────────────────┬──────────────────────────────────┘
                       │ Signed & Encrypted PDF + Metadata
                       ▼
┌─────────────────────────────────────────────────────────┐
│                    Web Platform                         │
│                                                         │
│  8. Saves encrypted PDF to PostgreSQL (status: ACTIVE)  │
│  9. Holder downloads encrypted PDF                      │
│ 10. Automatic PII stripping from PostgreSQL             │
└─────────────────────────────────────────────────────────┘
```

> **Privacy note:** Verifiable Credentials containing personal data (PII) are **never** published to IPFS. They live exclusively in PostgreSQL. Upon download by the Holder, PII is stripped automatically from the database, leaving only zero-knowledge transaction metadata. Only **Credential Schemas** (templates containing no personal data) may optionally be published to IPFS.

---

## 1. Schemas

Manages the credential schema templates created by Issuers. Schemas have a single `version` field and no version-chain — editing a draft schema updates it in place.

---

### `GET /api/schemas`

Lists schemas visible to the logged-in user (their own schemas, plus all `PUBLIC` schemas from the community).

**Query Parameters**

| Parameter | Type | Description |
|---|---|---|
| `visibility` | `PUBLIC \| PRIVATE` | Filter by visibility |
| `mine` | `boolean` | If `true`, returns only schemas created by the logged-in user |

**Response `200`**
```json
[
  {
    "id": "clx123",
    "name": "Graduation Diploma",
    "version": "1.0",
    "visibility": "PRIVATE",
    "storageLocation": "LOCAL",
    "ipfsCid": null,
    "publishedAt": null,
    "createdAt": "2026-04-01T00:00:00Z"
  }
]
```

---

### `POST /api/schemas`

Creates a new credential schema. Always starts as `PRIVATE`.

**Request Body**
```json
{
  "name": "Graduation Diploma",
  "description": "Issued to graduating students",
  "jsonSchema": {
    "fields": [
      { "name": "studentName", "type": "string", "required": true },
      { "name": "course", "type": "string", "required": true },
      { "name": "graduationYear", "type": "number", "required": true }
    ]
  }
}
```

**Response `201`**
```json
{
  "id": "clx123",
  "name": "Graduation Diploma",
  "version": "1.0",
  "visibility": "PRIVATE"
}
```

---

### `GET /api/schemas/:id`

Returns the full details of a single schema.

**Response `200`**
```json
{
  "id": "clx123",
  "name": "Graduation Diploma",
  "description": "Issued to graduating students",
  "version": "1.0",
  "visibility": "PRIVATE",
  "storageLocation": "LOCAL",
  "ipfsCid": null,
  "publishedAt": null,
  "jsonSchema": { "fields": [] },
  "creator": { "id": "user1", "name": "UNIFESP" }
}
```

---

### `PATCH /api/schemas/:id`

Updates a schema. Only the creator may call this endpoint.

- `name`, `description` and `jsonSchema` may only be edited **before** the schema is published (`publishedAt = null`).
- `visibility` may be toggled at any time — this is how a user makes a schema `PUBLIC` so it becomes a community template.

**Request Body**
```json
{
  "visibility": "PUBLIC"
}
```

**Response `200`**
```json
{
  "id": "clx123",
  "visibility": "PUBLIC"
}
```

---

### `POST /api/schemas/:id/publish`

Publishes a `LOCAL` schema to IPFS. Stores the returned CID in `ipfsCid`, sets `storageLocation` to `IPFS`, and records `publishedAt`.

**Request Body** — empty `{}`

**Response `200`**
```json
{
  "id": "clx123",
  "ipfsCid": "QmXoypizjW3WknFiJnKLwHCnL72ved...",
  "storageLocation": "IPFS",
  "publishedAt": "2026-04-01T00:00:00Z"
}
```

---

## 2. Credentials

Manages the full lifecycle of Verifiable Credentials. Credentials are fully decoupled from `CredentialSchema` at the database level — the schema reference (id, name, version) is embedded as a snapshot inside `vcPayload.credentialSchema` at issuance time.

---

### `GET /api/credentials`

Lists credentials for the logged-in user.

**Query Parameters**

| Parameter | Type | Description |
|---|---|---|
| `role` | `issued \| received` | Filter by user role |
| `status` | `PENDING \| ACTIVE \| REVOKED` | Filter by VC status |

**Response `200`**
```json
[
  {
    "id": "cred123",
    "status": "ACTIVE",
    "issuedAt": "2026-04-01T00:00:00Z",
    "expiresAt": "2027-04-01T00:00:00Z",
    "issuer": { "id": "user1", "name": "UNIFESP", "email": "registry@unifesp.br" },
    "holder": { "id": "user2", "name": "Breno", "email": "breno@unifesp.br" },
    "schemaSnapshot": { "id": "clx123", "name": "Graduation Diploma", "version": "1.0" }
  }
]
```

---

### `GET /api/credentials/stats`

Returns a quick balance of credentials for the logged-in user, broken down by role and status. Used to power dashboard summary widgets.

**Response `200`**
```json
{
  "issuedCount": 12,
  "receivedCount": 5,
  "issuedByStatus": { "PENDING": 2, "ACTIVE": 9, "REVOKED": 1 },
  "receivedByStatus": { "PENDING": 1, "ACTIVE": 4, "REVOKED": 0 }
}
```

---

### `GET /api/credentials/:id`

Returns the full credential detail, including the complete W3C/JSON-LD payload.

**Response `200`**
```json
{
  "id": "cred123",
  "status": "ACTIVE",
  "issuedAt": "2026-04-01T00:00:00Z",
  "expiresAt": "2027-04-01T00:00:00Z",
  "vcPayload": {
    "@context": ["https://www.w3.org/2018/credentials/v1"],
    "type": ["VerifiableCredential", "GraduationDiploma"],
    "issuer": "did:ssipq:zHzcqWj9c21JqCYdKGGoeVDSXtjaTMdVowavVstxGuEYf",
    "issuanceDate": "2026-04-01T00:00:00Z",
    "credentialSchema": {
      "id": "clx123",
      "name": "Graduation Diploma",
      "version": "1.0"
    },
    "credentialSubject": {
      "id": "did:ssipq:zFpb7WX2S2M5GCL4NYufwkcY9dw6yVfiDhTx699hzLJaj",
      "studentName": "Breno",
      "course": "Computer Engineering",
      "graduationYear": 2026
    }
  }
}
```

---

### `GET /api/credentials/:id/pdf`

Fetches the encrypted PDF payload. 
- Returns `200 OK` with the `application/octet-stream` PDF payload if valid.
- If it's the first time being downloaded, records `pdfDownloadedAt` and deletes all PII from the generic JSON `vcPayload` in PostgreSQL, replacing attribute values with `"Ocultado (PII removido)"`.
- Calculates **Logical Expiration** (`pdfDownloadedAt` + issuer's `pdfRetentionDays`). If the file is logically expired, returns `410 Gone` even if the physical deletion cron hasn't executed yet.
- Only the specific holder listed in `holderId` is authorized.

**Response `200`** (`application/octet-stream`)
- Headers: `Content-Disposition: attachment; filename="credential_cred123.pdf.enc"`
- Binary encrypted PDF content.

---

### `POST /api/credentials`

Initiates credential issuance. Looks up schema by `schemaId`, embeds a snapshot into the unsigned W3C payload, creates a `VerifiableCredential` with status `PENDING`, and returns `202 Accepted`.

**Request Body**
```json
{
  "schemaId": "clx123",
  "holderEmail": "breno@unifesp.br",
  "expiresAt": "2027-04-01T00:00:00Z",
  "credentialSubject": {
    "studentName": "Breno",
    "course": "Computer Engineering",
    "graduationYear": 2026
  }
}
```

**Response `202 Accepted`**
```json
{
  "signingRequestId": "cred123",
  "status": "PENDING_SIGNATURE",
  "unsignedPayload": {
    "@context": ["https://www.w3.org/2018/credentials/v1"],
    "type": ["VerifiableCredential", "GraduationDiploma"],
    "issuer": "did:ssipq:zHzcqWj9c21JqCYdKGGoeVDSXtjaTMdVowavVstxGuEYf",
    "issuanceDate": "2026-04-01T00:00:00Z",
    "credentialSchema": { "id": "clx123", "name": "Graduation Diploma", "version": "1.0" },
    "credentialSubject": { "...": "..." }
  }
}
```

---

### `PATCH /api/credentials/:id/accept`

Called by the **Holder** to accept a `PENDING` credential. Updates status from `PENDING` → `ACTIVE`.

**Request Body** — empty `{}`

**Response `200`**
```json
{ "id": "cred123", "status": "ACTIVE" }
```

---

### `PATCH /api/credentials/:id/revoke`

Called by the **Issuer** to revoke an `ACTIVE` credential. Updates status to `REVOKED` and sets `revokedAt: new Date()`.

**Request Body**
```json
{ "reason": "Credential issued in error." }
```

**Response `200`**
```json
{ "id": "cred123", "status": "REVOKED" }
```

---

## 3. Signer (Mobile App Communication)

Handles round-trip communication between the Web Platform and the Mobile Signer App.

> **Defense in Depth (PoP + HMAC Auth):** Endpoints marked with PoP require a base64-encoded signed authentication Verifiable Credential in the `x-signer-auth-credential` HTTP header. The credential contains `issuer_did` and a timestamp (verified against the registered ML-DSA public key with a 2-minute anti-replay window). Additionally, they require an `Authorization: Bearer <HMAC_Token>` header, where the token is an HMAC-SHA256 of the user's DID, ensuring personalized, unique device tokens that are gracefully rotatable on the server without breaking old clients.

---

### `GET /api/signer/requests/pending`

Polled by the Mobile Signer App to fetch credential signing requests awaiting signature for the authenticated DID.

**Headers**

| Header | Type | Description |
|---|---|---|
| `x-signer-auth-credential` | `string` | Base64-encoded signed authentication VC |
| `authorization` | `string` | Bearer token (HMAC-SHA256 of DID) |

**Response `200`**
```json
[
  {
    "requestId": "cred123",
    "createdAt": "2026-04-01T10:00:00Z",
    "issuer": { "did": "did:ssipq:zHzcq...", "name": "UNIFESP" },
    "unsignedPayload": {
      "@context": ["https://www.w3.org/2018/credentials/v1"],
      "type": ["VerifiableCredential", "GraduationDiploma"],
      "issuer": "did:ssipq:zHzcq...",
      "issuanceDate": "2026-04-01T00:00:00Z",
      "credentialSchema": { "id": "clx123", "name": "Graduation Diploma", "version": "1.0" },
      "credentialSubject": { "...": "..." }
    }
  }
]
```

---

### `GET /api/signer/recipient-key/:did`

Fetched by the Mobile Signer App to obtain the recipient's DID Document (containing their ML-KEM-768 public key) prior to encrypting the credential PDF.

**Headers**

| Header | Type | Description |
|---|---|---|
| `x-signer-auth-credential` | `string` | Base64-encoded signed authentication VC |
| `authorization` | `string` | Bearer token (HMAC-SHA256 of DID) |

**Response `200`**
- Returns the recipient's full W3C DID Document JSON.

---

### `POST /api/signer/callback`

Called by the Mobile Signer App after signing and encrypting the credential PDF.

Upon receiving this call, the platform:
1. Validates metadata and Proof of Existence parameters
2. Stores the encrypted PDF envelope (`pdfFile`), `pdfHash` and transaction `metadata` in PostgreSQL
3. Updates credential status to `ACTIVE`
4. Notifies the Holder

**Request Body** (`multipart/form-data`)
- `authorization` header required: `Bearer <HMAC_Token>`
- `file`: Encrypted PDF binary envelope (containing ML-KEM ciphertext, AES-256-GCM nonce, authTag, and ciphertext).
- `metadata`: JSON string with Proof of Existence metadata.

```json
// Content of 'metadata' field
{
  "requestId": "cred123",
  "issuerDid": "did:ssipq:zHzcq...",
  "recipientDid": "did:ssipq:zFpb7...",
  "timestamp": "2026-04-01T10:00:00Z",
  "pdfHash": "a94a8fe5ccb19ba61c4c0873d391e987982fbbd3",
  "schemaId": "clx123"
}
```

**Response `200`**
```json
{
  "success": true,
  "credentialId": "cred123",
  "status": "ACTIVE"
}
```

---

### `GET /api/signer/credentials/available`

Polled by the Mobile Signer App to list encrypted credentials awaiting download by the Holder.

**Headers**

| Header | Type | Description |
|---|---|---|
| `x-signer-auth-credential` | `string` | Base64-encoded signed authentication VC |
| `authorization` | `string` | Bearer token (HMAC-SHA256 of DID) |

**Response `200`**
```json
[
  {
    "credentialId": "cred123",
    "createdAt": "2026-04-01T10:00:00Z",
    "pdfDownloadedAt": null,
    "issuer": { "did": "did:ssipq:zHzcq...", "name": "UNIFESP" }
  }
]
```

---

### `GET /api/signer/download-pdf/[id]`

Called by the Mobile Signer App (or automated M2M client) to download an available encrypted PDF credential. Triggers automatic PII stripping on first download.

**Headers**

| Header | Type | Description |
|---|---|---|
| `authorization` | `string` | Bearer token (HMAC-SHA256 of DID) |

**Response `200`** (`application/octet-stream`)
- Headers: `Content-Disposition: attachment; filename="credential_cred123.pdf.enc"`
- Binary encrypted PDF content.

---

## 4. Users & Preferences

---

### `GET /api/users/search`

Strict search by CPF. Returns the matching user (including CPF) so the Issuer UI can confirm identity before issuance. Excludes the logged-in user.

**Query Parameters**

| Parameter | Type | Description |
|---|---|---|
| `cpf` | `string` | Exact CPF match (11 digits, no formatting) |

**Response `200`**
```json
[
  {
    "id": "user2",
    "name": "Breno",
    "email": "breno@unifesp.br",
    "image": "https://...",
    "cpf": "12345678901"
  }
]
```

---

### `PATCH /api/users/preferences`

Updates the authenticated user's UI language preference.

**Request Body**
```json
{
  "language": "pt"
}
```

**Response `200`**
```json
{
  "id": "user1",
  "language": "pt"
}
```

---

## 5. Settings

---

### `PATCH /api/settings/retention`

Updates the authenticated Issuer's PDF retention window (in days). This dictates the Logical Expiration of any encrypted PDF credential issued by this user.

**Constraints:**
- Must be an authenticated user (via NextAuth Session).
- `pdfRetentionDays` must be an integer between `1` and `15`.

**Request Body**
```json
{
  "pdfRetentionDays": 7
}
```

**Response `200`**
```json
{
  "success": true,
  "pdfRetentionDays": 7
}
```

---

## 6. DIDs & Post-Quantum DID Pairings

Manages registration, mobile pairing challenge flows, and resolution of Post-Quantum Decentralized Identifiers (ML-DSA-65 and ML-KEM-768) following the W3C DID Core specification.

---

### `POST /api/v1/did-pairings`

Generates a new DID pairing challenge for the logged-in user. Returns a 128-bit `pairingId`, cryptographic `nonce`, 10-minute expiration timestamp, and endpoint URL.

**Response `200`**
```json
{
  "id": "cuid...",
  "pairingId": "77f94d457ff86eb328099868c6150671",
  "nonce": "vMhxz_qF6AKhdZHhwN8NnfmELdaGDB91CzlwM-wm174",
  "expiresAt": "2026-07-27T17:14:29.811Z",
  "userId": "cms3asx8m0000f4xk1mcli8ko",
  "email": "teste@gmail.com",
  "endpoint": "http://localhost:3000/api/v1/did-pairings/77f94d457ff86eb328099868c6150671/complete"
}
```

---

### `POST /api/v1/did-pairings/:pairingId/complete`

Receives the signed challenge payload from the Mobile Signer App (or simulation script). Validates challenge status, expiration, nonce, email/userId match, and ML-DSA-65 signature proof over canonical challenge JSON. Saves the Post-Quantum DID (`did`), `didPublicKey` (ML-DSA-65), `didMlkemKey` (ML-KEM-768), and `didDocument` atomically into PostgreSQL.

**Request Body**
```json
{
  "pairingId": "77f94d457ff86eb328099868c6150671",
  "nonce": "vMhxz_qF6AKhdZHhwN8NnfmELdaGDB91CzlwM-wm174",
  "expiresAt": "2026-07-27T17:14:29.811Z",
  "userId": "cms3asx8m0000f4xk1mcli8ko",
  "email": "teste@gmail.com",
  "did": "did:ssipq:zFpb7WX2S2M5GCL4NYufwkcY9dw6yVfiDhTx699hzLJaj",
  "mlDsaPublicKey": "z...",
  "mlKemPublicKey": "z...",
  "didDocument": { "...": "..." },
  "proof": {
    "type": "ML-DSA-65",
    "created": "2026-07-27T17:00:00.000Z",
    "verificationMethod": "did:ssipq:z...#mldsa-1",
    "proofValue": "..."
  }
}
```

**Response `200`**
```json
{
  "paired": true,
  "did": "did:ssipq:zFpb7WX2S2M5GCL4NYufwkcY9dw6yVfiDhTx699hzLJaj",
  "status": "ACTIVE",
  "pairedAt": "2026-07-27T17:14:13.390Z",
  "bearerToken": "..."
}
```

---

### `POST /api/dids`

Registers the logged-in user's DID and public key directly.

**Request Body**
```json
{
  "did": "did:ssipq:zFpb7WX2S2M5GCL4NYufwkcY9dw6yVfiDhTx699hzLJaj",
  "publicKey": "z6MkpTHR8VNsBxYAAWHut2Geadd9jSwuBV8xRoAnwWsdvktH"
}
```

**Response `201`**
```json
{
  "id": "user2",
  "did": "did:ssipq:zFpb7WX2S2M5GCL4NYufwkcY9dw6yVfiDhTx699hzLJaj",
  "registeredAt": "2026-04-01T00:00:00Z"
}
```

---

### `GET /api/dids/:id`

Resolves a DID and returns its W3C DID Document.

**Response `200`** (`application/did+ld+json`)
```json
{
  "@context": ["https://www.w3.org/ns/did/v1"],
  "id": "did:ssipq:zFpb7WX2S2M5GCL4NYufwkcY9dw6yVfiDhTx699hzLJaj",
  "verificationMethod": [
    {
      "id": "did:ssipq:zFpb7WX2S2M5GCL4NYufwkcY9dw6yVfiDhTx699hzLJaj#key-1",
      "type": "Ed25519VerificationKey2020",
      "controller": "did:ssipq:zFpb7WX2S2M5GCL4NYufwkcY9dw6yVfiDhTx699hzLJaj",
      "publicKeyMultibase": "z6MkpTHR8VNsBxYAAWHut2Geadd9jSwuBV8xRoAnwWsdvktH"
    }
  ],
  "authentication": ["did:ssipq:zFpb7WX2S2M5GCL4NYufwkcY9dw6yVfiDhTx699hzLJaj#key-1"]
}
```

---

## 7. Verifier

---

### `POST /api/verifier/verify`

Public endpoint to verify a signed Verifiable Credential or PDF document. Supports two modes:

1. **PDF Upload (`file` field via `multipart/form-data`):** Processed entirely in RAM Buffer via `ssi_pq_core.node` (0 disk writes). Extracts `%SSI-PQ-MANIFEST-V1`, resolves the issuer's DID Document, checks post-quantum ML-DSA signatures, and checks revocation status (`REVOKED`).
2. **PDF Hash (`pdfHash` field via `application/json`):** Looks up the SHA-256 hash in PostgreSQL (`pdfHash`) for Proof of Existence verification.

**Request Body (JSON mode)**
```json
{
  "pdfHash": "a94a8fe5ccb19ba61c4c0873d391e987982fbbd3"
}
```

**Response `200`** (Valid Credential)
```json
{
  "valid": true,
  "errors": [],
  "metadata": {
    "issuerDid": "did:ssipq:zHzcq...",
    "recipientDid": "did:ssipq:zFpb7...",
    "timestamp": "2026-04-01T10:00:00Z",
    "schemaId": "clx123"
  }
}
```

---

## 8. Cron Jobs & Data Cleanup

To comply with the retention rules established by Issuers (from 1 to 15 days), the platform uses a cron job endpoint that removes the PDF binary payloads once they expire. The Proof of Existence metadata remains untouched.

### `GET /api/cron/cleanup-pdfs`

Designed to be called daily (e.g., via Vercel Cron or a standard scheduler). Finds all credentials that have a `pdfFile` and where `pdfDownloadedAt + issuer.pdfRetentionDays` is in the past. It then sets the `pdfFile` to `null` on all expired credentials.

**Headers**

| Header | Type | Description |
|---|---|---|
| `authorization` | `string` | Must be `Bearer <CRON_SECRET>` |

**Response `200`**
```json
{
  "success": true,
  "cleanedCount": 14,
  "timestamp": "2026-08-03T10:00:00.000Z"
}
```

---

## 9. Status Codes Summary

| Code | Meaning |
|---|---|
| `200 OK` | Request succeeded |
| `201 Created` | Resource created successfully |
| `202 Accepted` | Process started, not yet complete (awaiting signature) |
| `400 Bad Request` | Invalid input or invalid proof signature |
| `401 Unauthorized` | Missing or invalid session, token, or PoP signature |
| `403 Forbidden` | Authenticated but not permitted |
| `404 Not Found` | Resource does not exist |
| `409 Conflict` | Duplicate resource (e.g. CPF already registered) |
| `410 Gone` | Resource has expired and is logically or physically deleted |
| `500 Internal Server Error` | Unexpected server failure |

---

## 10. Security & Production Guidelines

- **Browser Access**: By design in Next.js App Router, backend code, configuration files, and internal directories (like `/lib`, `/docs`, `/prisma`, etc.) are completely invisible and inaccessible via the browser. Only routes explicitly defined inside `/api` and valid public pages are exposed. All interactions must happen either through the authenticated web interface or the API via the paired Mobile Signer.
- **Production `lib/` Folder**: During local development and testing, the `lib/` directory contains numerous `.js` and `.ts` utility scripts that manipulate the database directly via Prisma (e.g., `reset-did.js`). **In a production environment, all of these testing scripts must be deleted.** The `lib/` folder in production should contain **only** the `ssi_pq_core.node` binary library and strictly necessary application utilities, preventing any accidental unauthorized local script execution.

---

## 11. `.env` Variables Required

```env
# Comma-separated list of global secrets to allow Grace Period Rotation without breaking old Mobile Apps
# Se AMBAS as variáveis (SECRETS e SECRET) estiverem habilitadas, o sistema usará 
# EXCLUSIVAMENTE a variável SIGNER_SECRETS e ignorará a antiga.
# A primeira senha da lista será usada para assinar novos tokens.
SIGNER_SECRETS="secret_v2,secret_v1_legacy"

# Fallback (old)
SIGNER_SECRET="generate with: openssl rand -base64 32"

# Database Connection
DATABASE_URL="postgresql://user:password@localhost:5432/vertex_ssi?schema=public"
```

---

*Vertex Web SSIaaS · UNIFESP · FAPESP Research*
