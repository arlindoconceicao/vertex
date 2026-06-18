# Vertex Web SSIaaS — API Architecture

> **Stack:** Next.js App Router · REST · TypeScript
> **Base URL (dev):** `http://localhost:3000/api`
> **Authentication:** All endpoints require an active session (Auth.js).
> The signer callback uses a shared secret token for machine-to-machine auth.

---

## Architectural Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Web Platform                         │
│                  (Next.js — Issuer UI)                  │
│                                                         │
│  1. Issuer fills credential form                        │
│  2. POST /api/credentials → creates unsigned payload    │
│  3. POST /api/signer/requests → sends to Mobile Signer  │
└──────────────────────┬──────────────────────────────────┘
                       │ Signing Request (unsigned payload)
                       ▼
┌─────────────────────────────────────────────────────────┐
│                  Mobile Signer App                      │
│                                                         │
│  4. GET /api/signer/requests/pending → fetches request  │
│  5. Signs payload with Issuer's private key             │
│  6. POST /api/signer/callback → returns signed VC       │
└──────────────────────┬──────────────────────────────────┘
                       │ Signed Verifiable Credential
                       ▼
┌─────────────────────────────────────────────────────────┐
│                    Web Platform                         │
│                                                         │
│  7. Saves signed VC to PostgreSQL (never to IPFS)        │
│  8. Notifies Holder via email                           │
└─────────────────────────────────────────────────────────┘
```

> **Privacy note:** Verifiable Credentials are personal data and are
> **never** published to IPFS. They live exclusively in PostgreSQL. Only
> **Credential Schemas** (the templates, which contain no personal data)
> may optionally be published to IPFS.

---

## 1. Schemas

Manages the credential schema templates created by Issuers. Schemas have
a single `version` field and no version-chain in this stage of the MVP —
editing a draft schema updates it in place.

---

### `GET /api/schemas`

Lists schemas visible to the logged-in user (their own schemas, plus all
`PUBLIC` schemas from the community).

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
    "createdAt": "2025-04-01T00:00:00Z"
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

- `name`, `description` and `jsonSchema` may only be edited **before**
  the schema is published (`publishedAt = null`).
- `visibility` may be toggled at any time — this is how a user makes a
  schema `PUBLIC` so it becomes a community template.

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

Publishes a `LOCAL` schema to IPFS. Stores the returned CID in `ipfsCid`,
sets `storageLocation` to `IPFS`, and records `publishedAt`.

**Request Body** — empty `{}`

**Response `200`**
```json
{
  "id": "clx123",
  "ipfsCid": "QmXoypizjW3WknFiJnKLwHCnL72ved...",
  "storageLocation": "IPFS",
  "publishedAt": "2025-04-01T00:00:00Z"
}
```

---

## 2. Credentials

Manages the full lifecycle of Verifiable Credentials. Credentials are
fully decoupled from `CredentialSchema` at the database level — there is
no foreign key between them. The schema reference (id, name, version) is
embedded as a snapshot inside `vcPayload.credentialSchema` at issuance
time.

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
    "issuedAt": "2025-04-01T00:00:00Z",
    "expiresAt": "2026-04-01T00:00:00Z",
    "issuer": { "id": "user1", "name": "UNIFESP", "email": "registry@unifesp.br" },
    "holder": { "id": "user2", "name": "Breno", "email": "breno@unifesp.br" },
    "schemaSnapshot": { "id": "clx123", "name": "Graduation Diploma", "version": "1.0" }
  }
]
```

> `schemaSnapshot` is read directly from `vcPayload.credentialSchema` —
> it is not a database join, since there is no relation anymore.

---

### `GET /api/credentials/:id`

Returns the full credential, including the complete W3C/JSON-LD payload.

**Response `200`**
```json
{
  "id": "cred123",
  "status": "ACTIVE",
  "issuedAt": "2025-04-01T00:00:00Z",
  "expiresAt": "2026-04-01T00:00:00Z",
  "vcPayload": {
    "@context": ["https://www.w3.org/2018/credentials/v1"],
    "type": ["VerifiableCredential", "GraduationDiploma"],
    "issuer": "did:web:unifesp.br",
    "issuanceDate": "2025-04-01T00:00:00Z",
    "credentialSchema": {
      "id": "clx123",
      "name": "Graduation Diploma",
      "version": "1.0"
    },
    "credentialSubject": {
      "id": "did:web:vertex.unifesp.br:users:user2",
      "studentName": "Breno",
      "course": "Computer Engineering",
      "graduationYear": 2025
    },
    "proof": {
      "type": "Ed25519Signature2020",
      "created": "2025-04-01T00:00:00Z",
      "proofValue": "z58DAdFfa9..."
    }
  }
}
```

---

### `POST /api/credentials`

Initiates a credential issuance. Looks up the schema by `schemaId`,
embeds a snapshot of it into the unsigned W3C payload, and creates a
`SigningRequest` for the Mobile Signer. Does **not** save the final
credential yet — that only happens after signing.

**Request Body**
```json
{
  "schemaId": "clx123",
  "holderEmail": "breno@unifesp.br",
  "expiresAt": "2026-04-01T00:00:00Z",
  "credentialSubject": {
    "studentName": "Breno",
    "course": "Computer Engineering",
    "graduationYear": 2025
  }
}
```

**Response `202 Accepted`**
```json
{
  "signingRequestId": "req789",
  "status": "PENDING_SIGNATURE",
  "unsignedPayload": {
    "@context": ["https://www.w3.org/2018/credentials/v1"],
    "type": ["VerifiableCredential", "GraduationDiploma"],
    "issuer": "did:web:unifesp.br",
    "issuanceDate": "2025-04-01T00:00:00Z",
    "credentialSchema": { "id": "clx123", "name": "Graduation Diploma", "version": "1.0" },
    "credentialSubject": { "...": "..." }
  }
}
```

> `202 Accepted` signals that the process has started but is not yet
> complete — the credential is only finalized after the Mobile Signer
> calls the callback.

---

### `PATCH /api/credentials/:id/accept`

Called by the **Holder** to accept a `PENDING` credential. Updates
status from `PENDING` → `ACTIVE`.

**Request Body** — empty `{}`

**Response `200`**
```json
{ "id": "cred123", "status": "ACTIVE" }
```

---

### `PATCH /api/credentials/:id/revoke`

Called by the **Issuer** to revoke an `ACTIVE` credential.

**Request Body**
```json
{ "reason": "Credential issued in error." }
```

**Response `200`**
```json
{ "id": "cred123", "status": "REVOKED" }
```

---

### `GET /api/credentials/stats`

Returns a quick balance of credentials for the logged-in user, broken
down by role and status. Used to power dashboard summary widgets.

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

## 3. Signer (Mobile App Communication)

Handles the round-trip communication between the Web Platform and the
Mobile Signer App.

> **Machine-to-Machine Auth:** these endpoints require an
> `Authorization: Bearer <SIGNER_SECRET>` header. `SIGNER_SECRET` is a
> shared token stored in `.env` on both sides.

---

### `GET /api/signer/requests/pending`

Polled by the Mobile Signer App to fetch signing requests awaiting a
signature.

**Response `200`**
```json
[
  {
    "requestId": "req789",
    "createdAt": "2025-04-01T10:00:00Z",
    "issuer": { "did": "did:web:unifesp.br", "name": "UNIFESP" },
    "unsignedPayload": {
      "@context": ["https://www.w3.org/2018/credentials/v1"],
      "type": ["VerifiableCredential", "GraduationDiploma"],
      "issuer": "did:web:unifesp.br",
      "issuanceDate": "2025-04-01T00:00:00Z",
      "credentialSchema": { "id": "clx123", "name": "Graduation Diploma", "version": "1.0" },
      "credentialSubject": { "...": "..." }
    }
  }
]
```

---

### `POST /api/signer/callback`

Called by the Mobile Signer App after signing the credential. This is
the key endpoint of the round-trip flow.

Upon receiving this call, the Web Platform will:
1. Validate the signed payload
2. Save the final `VerifiableCredential` to PostgreSQL (never to IPFS)
3. Update the `SigningRequest` status to `COMPLETED`
4. Notify the Holder via email

**Request Body**
```json
{
  "requestId": "req789",
  "signedPayload": {
    "@context": ["https://www.w3.org/2018/credentials/v1"],
    "type": ["VerifiableCredential", "GraduationDiploma"],
    "issuer": "did:web:unifesp.br",
    "issuanceDate": "2025-04-01T00:00:00Z",
    "credentialSchema": { "id": "clx123", "name": "Graduation Diploma", "version": "1.0" },
    "credentialSubject": {
      "id": "did:web:vertex.unifesp.br:users:user2",
      "studentName": "Breno",
      "course": "Computer Engineering",
      "graduationYear": 2025
    },
    "proof": {
      "type": "Ed25519Signature2020",
      "created": "2025-04-01T00:00:00Z",
      "verificationMethod": "did:web:unifesp.br#key-1",
      "proofValue": "z58DAdFfa9..."
    }
  }
}
```

**Response `201`**
```json
{
  "credentialId": "cred123",
  "status": "PENDING",
  "holderNotified": true
}
```

> The credential is saved with `status = PENDING` because the Holder
> still needs to formally accept it via `PATCH /api/credentials/:id/accept`.

---

### `GET /api/signer/requests/:requestId/status`

Polled by the **Web Platform UI** to show the Issuer the current state
of a signing request.

**Response `200`**
```json
{
  "requestId": "req789",
  "status": "PENDING_SIGNATURE | COMPLETED | FAILED",
  "credentialId": "cred123"
}
```

---

## 4. Users

---

### `GET /api/users/search`

Strict search by CPF. Returns the matching user including their CPF, so
the Issuer's UI can visually confirm the correct person before issuing a
credential to them. Excludes the logged-in user from the result.

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

## 5. DIDs

Manages the registration and resolution of Decentralized Identifiers,
following the W3C DID Core specification.

---

### `POST /api/dids`

Registers the logged-in user's DID and public key. Called once, after
the Mobile Signer App generates the user's keypair and DID.

**Request Body**
```json
{
  "did": "did:web:vertex.unifesp.br:users:user2",
  "publicKey": "z6MkpTHR8VNsBxYAAWHut2Geadd9jSwuBV8xRoAnwWsdvktH"
}
```

**Response `201`**
```json
{
  "id": "user2",
  "did": "did:web:vertex.unifesp.br:users:user2",
  "registeredAt": "2025-04-01T00:00:00Z"
}
```

---

### `GET /api/dids/:id`

Resolves a DID and returns its W3C DID Document. Used by the Verifier
(and by external parties) to fetch the public key needed to validate a
credential's signature.

**Response `200`** (`application/did+ld+json`)
```json
{
  "@context": ["https://www.w3.org/ns/did/v1"],
  "id": "did:web:vertex.unifesp.br:users:user2",
  "verificationMethod": [
    {
      "id": "did:web:vertex.unifesp.br:users:user2#key-1",
      "type": "Ed25519VerificationKey2020",
      "controller": "did:web:vertex.unifesp.br:users:user2",
      "publicKeyMultibase": "z6MkpTHR8VNsBxYAAWHut2Geadd9jSwuBV8xRoAnwWsdvktH"
    }
  ],
  "authentication": ["did:web:vertex.unifesp.br:users:user2#key-1"]
}
```

**Response `404`** — returned if no user is registered with that DID.

---

## 6. Verifier

---

### `POST /api/verifier/verify`

Verifies a signed Verifiable Credential. Performs three checks, in order:

1. Resolves the issuer's DID Document via `GET /api/dids/:id`
2. Validates the cryptographic `proof` against the public key found in
   the resolved DID Document
3. Checks `expirationDate` (if present) against the current date

**Request Body**
```json
{
  "vcPayload": {
    "@context": ["https://www.w3.org/2018/credentials/v1"],
    "type": ["VerifiableCredential", "GraduationDiploma"],
    "issuer": "did:web:unifesp.br",
    "issuanceDate": "2025-04-01T00:00:00Z",
    "credentialSubject": { "...": "..." },
    "proof": {
      "type": "Ed25519Signature2020",
      "verificationMethod": "did:web:unifesp.br#key-1",
      "proofValue": "z58DAdFfa9..."
    }
  }
}
```

**Response `200`** (valid credential)
```json
{
  "valid": true,
  "errors": []
}
```

**Response `200`** (invalid credential)
```json
{
  "valid": false,
  "errors": [
    "Signature does not match issuer's public key",
    "Credential has expired"
  ]
}
```

---

## 7. Status Codes Summary

| Code | Meaning |
|---|---|
| `200 OK` | Request succeeded |
| `201 Created` | Resource created successfully |
| `202 Accepted` | Process started, not yet complete |
| `400 Bad Request` | Invalid input |
| `401 Unauthorized` | Missing or invalid session/token |
| `403 Forbidden` | Authenticated but not allowed (e.g. Holder trying to revoke) |
| `404 Not Found` | Resource does not exist |
| `409 Conflict` | Duplicate resource (e.g. CPF already registered) |
| `500 Internal Server Error` | Unexpected server failure |

---

## 8. `.env` Variables Required

```env
# Shared secret between Web Platform and Mobile Signer App
SIGNER_SECRET="generate with: openssl rand -base64 32"
```

---

*Vertex Web SSIaaS · UNIFESP · FAPESP Research*
