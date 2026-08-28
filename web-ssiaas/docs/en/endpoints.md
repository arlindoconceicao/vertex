# Application Endpoints (REST API)

This document records the endpoints available on the SSI platform, organized by business domain. All endpoints below have been checked against the codebase (`src/app/api`) and are implemented and active.

## Schemas (Credential Models)
- **`GET /api/schemas`**: Returns a list of all registered schemas. Optionally includes IPFS recording information (`ipfsCid` and `ipfsUrl`) if the schema has been published.
- **`POST /api/schemas`**: Creates a new schema, initially in a draft state.
- **`GET /api/schemas/[id]`**: Returns the details of a specific schema via its ID. Includes IPFS information (`ipfsCid` and `ipfsUrl`) if available.
- **`PATCH /api/schemas/[id]`**: Updates the information of an existing schema.
- **`POST /api/schemas/[id]/publish`**: Publishes a draft schema, making it immutable and ready for credential issuance.

## DIDs (Decentralized Identifiers)
- **`POST /api/dids`**: Creates a new Decentralized Identifier (DID).
- **`GET /api/dids/[id]`**: Resolves a DID and returns its respective DID Document (W3C DID Document) in JSON format, exposing the public keys. Additionally, returns IPFS properties (`ipfsCid`, `ipfsUrl`) if the DID is recorded on the decentralized network.
- **`POST /api/dids/search/challenge`**: (M2M Integration) **[Authentication: BEARER]** Generates a cryptographic challenge (nonce) associated with the Mobile App's DID (`requesterId`) for identity proof.
- **`GET /api/dids/search`**: (M2M Integration) **[Authentication: BEARER + CHALLENGE (PoP)]** Searches for a DID Document using the `cpf`, `email`, or `did` provided as a Query Parameter. Requires `x-requester-id`, `x-challenge-id`, and `x-signer-auth-credential` headers (Verifiable Credential PoP containing the generated nonce). This flow exactly mimics the mobile SDK process, attesting post-quantum DID ownership without exposing raw keys. Returns IPFS properties (`ipfsCid`, `ipfsUrl`) if they exist.

## Users
- **`GET /api/users/search`**: Performs a strict search for a user in the system (often used for exact search by CPF when selecting a recipient for a credential).

## Verifiable Credentials (VCs)
- **`GET /api/credentials`**: Returns the list of issued or received credentials, depending on who makes the request.
- **`POST /api/credentials`**: Initiates the issuance process of a new credential.
- **`GET /api/credentials/stats`**: Returns consolidated credential statistics (e.g., total amount, pending, issued, and revoked).
- **`GET /api/credentials/[id]`**: Fetches and returns the data of a specific credential by its ID.
- **`PATCH /api/credentials/[id]/accept`**: Registers that the recipient has accepted the credential (a phase in the credential lifecycle).
- **`PATCH /api/credentials/[id]/revoke`**: Revokes (cancels the validity of) an issued credential.

## Digital Signature (Mobile App Integration)
- **`GET /api/signer/requests/pending`**: **[Authentication: BEARER + CHALLENGE (PoP)]** Endpoint for integrations (Mobile App) to query which credentials are awaiting signature. Requires Post-Quantum Proof of Possession (PoP) authentication via the `x-signer-auth-credential` header with the action `pending_credentials_auth`. Filters and returns exclusively the pending credentials belonging to the authenticated DID.
- **`GET /api/signer/credentials/available`**: **[Authentication: BEARER + CHALLENGE (PoP)]** Returns credentials with ACTIVE status that have a PDF file and are awaiting download by the Holder. Requires PoP with action `available_credentials_auth`.
- **`GET /api/signer/download-pdf/[id]`**: **[Authentication: BEARER]** Allows downloading the encrypted PDF file of an active credential.
- **`GET /api/signer/recipient-key/[did]`**: **[Authentication: BEARER + CHALLENGE (PoP)]** Fetches the ML-KEM public key of a recipient for asymmetric encryption. Requires PoP with action `recipient_key_auth`.
- **`POST /api/signer/callback`**: **[Authentication: BEARER]** Endpoint for integrations (M2M / Mobile App) to return the credential file already signed by the owner using post-quantum cryptography.

## Public Verification (Verifier)
- **`POST /api/verifier/verify`**: Public endpoint where a third party can submit a presented credential and receive back the cryptographic verification result (integrity, authorship, and revocation status).

---

## Mobile Authentication (M2M Integration)

Integration endpoints with the mobile application (`/api/signer/*` and `/api/dids/search*`) are protected. The level of protection depends on the endpoint's sensitivity:

1. **[Authentication: BEARER]**
   Requires only sending a locally generated HMAC token using the `SIGNER_SECRET` and the user's DID.
2. **[Authentication: BEARER + CHALLENGE (PoP)]**
   In addition to the Bearer token, the application needs to mathematically prove that it possesses the DID's private key. It does this by generating an **Ephemeral Verifiable Credential** signed by the wallet itself and sending it in Base64 via the `x-signer-auth-credential` HTTP header.

### Access Examples (JavaScript / Node.js)

These examples illustrate how the logic should be coded (and can be adapted for the Android/Kotlin SDK).

**Example 1: Consuming a BEARER endpoint (`/api/signer/download-pdf`)**
```javascript
const crypto = require("crypto");

const signerSecret = "YOUR_SIGNER_SECRET";
const userDid = "did:ssipq:zHz..."; // Wallet owner's DID

// Generates the M2M token using HMAC SHA-256
const bearerToken = crypto.createHmac("sha256", signerSecret).update(userDid).digest("hex");

const response = await fetch("https://platform/api/signer/download-pdf/123", {
  method: "GET",
  headers: {
    "Authorization": `Bearer ${bearerToken}`
  }
});
```

**Example 2: Consuming a BEARER + CHALLENGE endpoint (`/api/signer/requests/pending`)**
```javascript
const crypto = require("crypto");
// (Assuming you have instantiated the library based on ssi_pq_core.node or native SDK)
const core = require('./lib/ssi_pq_core.node'); 

const signerSecret = "YOUR_SIGNER_SECRET";
const userDid = "did:ssipq:zHz...";
const bearerToken = crypto.createHmac("sha256", signerSecret).update(userDid).digest("hex");

// 1. The Mobile App generates a local challenge payload with the current timestamp
const authPayload = { 
  action: "pending_credentials_auth", 
  timestamp: new Date().toISOString() 
};

// 2. Prepares the temporary schema
const authSchema = core.createSchemaFromAttributes(authPayload, { 
  version: "1", 
  createdAt: authPayload.timestamp 
});

// 3. Issues the verifiable credential (Signing with the wallet's key)
const authCredential = core.walletIssueCredentialFromSchema(
  walletPath,       // Local wallet path
  walletPassword,   // Wallet password
  userDid,          // The active DID
  authSchema,
  authPayload,
  {
    credentialId: `auth-req-${Date.now()}`,
    issuedAt: authPayload.timestamp,
    visiblePaths: ["action", "timestamp"]
  }
);

// 4. Converts the signed credential (PoP) to Base64
const authCredentialBase64 = Buffer.from(JSON.stringify(authCredential)).toString("base64");

// 5. Sends the request containing the Bearer Token and the PoP
const response = await fetch("https://platform/api/signer/requests/pending", {
  method: "GET",
  headers: {
    "Authorization": `Bearer ${bearerToken}`,
    "x-signer-auth-credential": authCredentialBase64
  }
});
```

## Public Verification (Verifier)
- **`POST /api/verifier/verify`**: Public endpoint where a third party can submit a presented credential and receive back the cryptographic verification result (integrity, authorship, and revocation status).
