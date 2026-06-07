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
│  7. Saves signed VC to PostgreSQL                       │
│  8. Optionally publishes to IPFS                        │
│  9. Notifies Holder via email                           │
└─────────────────────────────────────────────────────────┘
```

---

## 1. Schemas

Manages the credential schema templates created by Issuers.

---

### `GET /api/schemas`

Lists all schemas created by the logged-in user.

**Query Parameters**

| Parameter | Type | Description |
|---|---|---|
| `type` | `TEMPLATE \| MUTABLE` | Filter by schema type |
| `latest` | `boolean` | If `true`, returns only the latest version of each chain |

**Response `200`**
```json
[
  {
    "id": "clx123",
    "name": "Graduation Diploma",
    "version": "1.0",
    "schemaType": "MUTABLE",
    "storageLocation": "LOCAL",
    "ipfsCid": null,
    "isLatestVersion": true,
    "createdAt": "2025-04-01T00:00:00Z"
  }
]
```

---

### `POST /api/schemas`

Creates a new credential schema.

**Request Body**
```json
{
  "name": "Graduation Diploma",
  "description": "Issued to graduating students",
  "schemaType": "MUTABLE",
  "jsonSchema": {
    "fields": [
      { "name": "studentName", "type": "string", "required": true },
      { "name": "course",      "type": "string", "required": true },
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
  "isLatestVersion": true
}
```

---

### `GET /api/schemas/:id`

Returns the full details of a schema, including its version chain.

**Response `200`**
```json
{
  "id": "clx123",
  "name": "Graduation Diploma",
  "version": "2.0",
  "schemaType": "MUTABLE",
  "storageLocation": "IPFS",
  "ipfsCid": "QmXoypizjW3WknFiJnKLwHCnL72ved...",
  "jsonSchema": { "fields": [] },
  "isLatestVersion": true,
  "parent": {
    "id": "clx000",
    "version": "1.0",
    "ipfsCid": "QmPreviousCid..."
  }
}
```

---

### `POST /api/schemas/:id/new-version`

Creates a new child schema from an existing MUTABLE schema.  
**Does not edit the original** — preserves the IPFS immutability chain.  
Sets `isLatestVersion = false` on the parent automatically.

**Request Body**
```json
{
  "description": "Updated to include GPA field",
  "jsonSchema": {
    "fields": [
      { "name": "studentName", "type": "string", "required": true },
      { "name": "course",      "type": "string", "required": true },
      { "name": "graduationYear", "type": "number", "required": true },
      { "name": "gpa",         "type": "number", "required": false }
    ]
  }
}
```

**Response `201`**
```json
{
  "id": "clx456",
  "version": "1.1",
  "parentId": "clx123",
  "isLatestVersion": true
}
```

---

### `POST /api/schemas/:id/publish`

Publishes a LOCAL schema to IPFS.  
Stores the returned CID in `ipfsCid` and updates `storageLocation` to `IPFS`.

**Request Body** — empty `{}`

**Response `200`**
```json
{
  "id": "clx123",
  "ipfsCid": "QmXoypizjW3WknFiJnKLwHCnL72ved...",
  "storageLocation": "IPFS"
}
```

---

## 2. Credentials

Manages the full lifecycle of Verifiable Credentials.

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
    "schema": { "id": "clx123", "name": "Graduation Diploma", "version": "1.0" },
    "issuer": { "id": "user1", "name": "UNIFESP", "email": "registry@unifesp.br" },
    "holder": { "id": "user2", "name": "Breno",   "email": "breno@unifesp.br" }
  }
]
```

---

### `GET /api/credentials/:id`

Returns the full credential details including the W3C/JSON-LD payload.

**Response `200`**
```json
{
  "id": "cred123",
  "status": "ACTIVE",
  "storageLocation": "LOCAL",
  "ipfsCid": null,
  "vcPayload": {
    "@context": ["https://www.w3.org/2018/credentials/v1"],
    "type": ["VerifiableCredential", "GraduationDiploma"],
    "issuer": "did:web:unifesp.br",
    "issuanceDate": "2025-04-01T00:00:00Z",
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

Initiates a credential issuance.  
Builds the **unsigned** W3C payload and creates a `SigningRequest` for the Mobile Signer.  
Does **not** save the final credential yet — that happens after signing.

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
    "credentialSubject": { "..." : "..." }
  }
}
```

> **Note:** `202 Accepted` signals that the process has started but is not yet complete —  
> the credential will only be finalized after the Mobile Signer calls the callback.

---

### `PATCH /api/credentials/:id/accept`

Called by the **Holder** to accept a `PENDING` credential.  
Updates status from `PENDING` → `ACTIVE`.

**Request Body** — empty `{}`

**Response `200`**
```json
{ "id": "cred123", "status": "ACTIVE" }
```

---

### `PATCH /api/credentials/:id/revoke`

Called by the **Issuer** to revoke an `ACTIVE` credential.  
Updates status to `REVOKED`.

**Request Body**
```json
{ "reason": "Credential issued in error." }
```

**Response `200`**
```json
{ "id": "cred123", "status": "REVOKED" }
```

---

### `POST /api/credentials/:id/publish`

Publishes a signed credential to IPFS.  
Only allowed if `status = ACTIVE`.

**Response `200`**
```json
{
  "id": "cred123",
  "ipfsCid": "QmSignedCredentialCid...",
  "storageLocation": "IPFS"
}
```

---

## 3. Signer (Mobile App Communication)

Handles the round-trip communication between the Web Platform and the Mobile Signer App.

> **Machine-to-Machine Auth:**  
> These endpoints require a `Authorization: Bearer <SIGNER_SECRET>` header.  
> `SIGNER_SECRET` is a shared token stored in `.env` on both sides.

---

### `GET /api/signer/requests/pending`

Polled by the Mobile Signer App to fetch signing requests that are waiting for a signature.

**Response `200`**
```json
[
  {
    "requestId": "req789",
    "createdAt": "2025-04-01T10:00:00Z",
    "issuer": {
      "did": "did:web:unifesp.br",
      "name": "UNIFESP"
    },
    "unsignedPayload": {
      "@context": ["https://www.w3.org/2018/credentials/v1"],
      "type": ["VerifiableCredential", "GraduationDiploma"],
      "issuer": "did:web:unifesp.br",
      "issuanceDate": "2025-04-01T00:00:00Z",
      "credentialSubject": { "..." : "..." }
    }
  }
]
```

---

### `POST /api/signer/callback`

Called by the Mobile Signer App after signing the credential.  
This is the **key endpoint** of the round-trip flow.

Upon receiving this call, the Web Platform will:
1. Validate the signed payload
2. Save the final `VerifiableCredential` to PostgreSQL
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

> **Note:** The credential is saved with `status = PENDING` because the Holder  
> still needs to formally accept it via `PATCH /api/credentials/:id/accept`.

---

### `GET /api/signer/requests/:requestId/status`

Polled by the **Web Platform UI** to show the Issuer the current state of a signing request.

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

Searches platform users by name or email.  
Excludes the logged-in user from results.

**Query Parameters**

| Parameter | Type | Description |
|---|---|---|
| `q` | `string` | Search term (min. 2 characters) |

**Response `200`**
```json
[
  {
    "id": "user2",
    "name": "Breno",
    "email": "breno@unifesp.br",
    "image": "https://..."
  }
]
```

---

## 5. Status Codes Summary

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

## 6. `.env` Variables Required

```env
# Shared secret between Web Platform and Mobile Signer App
SIGNER_SECRET="generate with: openssl rand -base64 32"
```

---

*Vertex Web SSIaaS · UNIFESP · FAPESP Research*
