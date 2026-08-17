# Application Endpoints (REST API)

This document records the endpoints available on the SSI platform, organized by business domain. All endpoints below have been checked against the codebase (`src/app/api`) and are implemented and active.

## Schemas (Credential Models)
- **`GET /api/schemas`**: Returns a list of all registered schemas.
- **`POST /api/schemas`**: Creates a new schema, initially in a draft state.
- **`GET /api/schemas/[id]`**: Returns the details of a specific schema via its ID.
- **`PATCH /api/schemas/[id]`**: Updates the information of an existing schema.
- **`POST /api/schemas/[id]/publish`**: Publishes a draft schema, making it immutable and ready for credential issuance.

## DIDs (Decentralized Identifiers)
- **`POST /api/dids`**: Creates a new Decentralized Identifier (DID).
- **`GET /api/dids/[id]`**: Resolves a DID and returns its respective DID Document (W3C DID Document) in JSON format, exposing the public keys.
- **`POST /api/dids/search/challenge`**: (M2M Integration) Generates a cryptographic challenge (nonce) associated with the Mobile App's DID (`requesterId`) for identity proof. Requires `SIGNER_SECRET` Bearer token authentication.
- **`GET /api/dids/search`**: (M2M Integration) Searches for a DID Document using the `cpf` or `email` provided as a Query Parameter. Requires `x-requester-id`, `x-challenge-id`, and `x-challenge-signature` headers to validate that the mobile app solved the previously issued challenge and possesses the correct private key.

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
- **`GET /api/signer/requests/pending`**: Endpoint for integrations (Mobile App) to query which credentials are awaiting signature. Requires Post-Quantum Proof of Possession (PoP) authentication via the `x-signer-auth-credential` header (a challenge credential generated locally by the wallet's encrypted SQLite database and verified with the ML-DSA public key of the DID registered on the platform). Filters and returns exclusively the pending credentials belonging to the authenticated DID.
- **`POST /api/signer/callback`**: Endpoint for integrations (M2M / Mobile App) to return the credential file already signed by the owner using post-quantum cryptography.

## Public Verification (Verifier)
- **`POST /api/verifier/verify`**: Public endpoint where a third party can submit a presented credential and receive back the cryptographic verification result (integrity, authorship, and revocation status).
