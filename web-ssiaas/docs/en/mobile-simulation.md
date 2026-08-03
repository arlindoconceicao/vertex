# Mobile Simulation and Support Scripts (`lib/`)

> [!WARNING]
> **ATTENTION (PRODUCTION ENVIRONMENT):** All Node simulation scripts (`.js` and `.ts`) located in the `lib/` folder operate with direct access to the database and should only be used in Development/Testing. In a **Production** environment, these scripts MUST be deleted. The `lib/` folder in production must contain only the `ssi_pq_core.node` binary library and strictly necessary modules for the web application.

This document describes the scripts created in the `lib/` folder to simulate the behavior of the Mobile Signer App and the end-to-end communication flow with the Web SSIaaS platform.

These scripts interact with the native `ssi_pq_core.node` library (Post-Quantum Cryptography), the encrypted SQLite database (`mobile_wallet.db`), and the local Next.js backend.

## 1. Pending Credential PDFs Generation

**Script:** `lib/generate-pending-pdfs.js`

This script simulates the Mobile App fetching the credentials that the issuer requested to generate on the platform, validating the possession of the keys through a challenge (Proof of Possession), and finally issuing a local PDF file of the signed credential containing the payload and its visible labels.

### Script Execution Flow:
1. **Encrypted Wallet Unlock**: Reads the decryption key in `lib/keys.txt` and opens the local SQLite database (`lib/mobile_wallet.db`). Extracts the active DID (e.g., `did:ssipq:zHzcq...`).
2. **Authentication (Proof-of-Possession)**: Instantly issues an in-memory `Verifiable Credential` (VC) for authentication that acts as a temporary "challenge" to prove possession of the primary key (ML-DSA) of that DID.
3. **Platform Query**: Sends this Base64-encoded credential through the `x-signer-auth-credential` header to the `GET /api/signer/requests/pending` endpoint.
4. **Sensitive Data Filter**: Receives the array of pending credentials. Dynamically sweeps the `credentialSubject` object, deleting the internal `id` property so as not to dirty the final document. Extracts all JSON paths (e.g., `formacao.curso`, `endereco.cidade`) mapping their *labels*.
5. **Signature and PDF Generation**:
   - Creates a tailored structural schema via `core.createSchemaFromAttributes()`.
   - Executes the VC signature with the holder's key via `core.walletIssueCredentialFromSchema()`.
   - Generates a formatted `.pdf` file using the internal `core.signedCredentialToPdf()` function and saves the result as `lib/credential_<requestId>.pdf`.

### How to run:
```bash
node lib/generate-pending-pdfs.js
```

## 2. Encrypted PDFs Upload (Callback)

**Script:** `lib/upload-pdfs.js`

After generating the plaintext PDFs (by the previous script), this script simulates the final step where the Mobile App encrypts the PDF exclusively for the recipient's eyes and sends it to the platform (Callback).

### Script Execution Flow:
1. **Backend Authentication**: Uses the DID and ML-DSA signature to create a Proof-of-Possession.
2. **DID Fetching**: Reads the list of pending credentials. For each one, discovers the Recipient's (Holder's) DID.
3. **Public Key Resolution**: Makes a call to `GET /api/signer/recipient-key/:did` to fetch the recipient's public **ML-KEM** key.
4. **Hybrid Post-Quantum Encryption**:
   - Uses the recipient's ML-KEM public key to encapsulate a shared secret and generate a symmetric AES-256 key.
   - Encrypts the PDF content using AES-256-GCM.
5. **Multipart Callback**: Packages the encrypted PDF, the cryptographic material (ML-KEM ciphertext, nonce, authTag), and the metadata (summary without PII) in a `multipart/form-data` package.
6. **Final Upload**: Sends via `POST /api/signer/callback`. The platform stores the encrypted PDF, converts the status from PENDING to ACTIVE, and deletes the personal data from the JSON payload in the database. Then, the script deletes the local PDF for security.

### Output Example:
```bash
node lib/upload-pdfs.js
=================================================
📤 ENVIANDO PDFs CRIPTOGRAFADOS PARA A PLATAFORMA
=================================================
🔑 Autenticando com DID: did:ssipq:zHzcqWj9c21JqCYdKGGoeVDSXtjaTMdVowavVstxGuEYf
📡 Buscando requisições pendentes para obter os IDs e DIDs...

📄 Processando upload para requisição: cms7ffgtn0001ikxkdhkbucld
🔍 Buscando chave pública do destinatário: did:ssipq:zHzcqWj9c21JqCYdKGGoeVDSXtjaTMdVowavVstxGuEYf
🔒 Criptografando o PDF...
🚀 Fazendo upload via POST multipart/form-data...
✅ Upload da credencial cms7ffgtn0001ikxkdhkbucld concluído com sucesso!
```

## 3. PDF Download and Decryption

**Script:** `lib/simulate-mobile-download.js`

This script simulates the Recipient's (Holder's) Mobile App downloading the encrypted PDF and decrypting it with their Post-Quantum private key.

### Script Execution Flow:
1. **Encrypted Wallet Unlock**: Reads the key and opens the local SQLite database (`lib/mobile_wallet.db`). Extracts the active DID.
2. **Authentication (Proof-of-Possession)**: Issues and signs a temporary credential to query and download the files destined for their DID.
3. **Platform Query**: Calls `GET /api/signer/credentials/available` and returns the IDs of the credentials awaiting download by the holder.
4. **Download and Automatic PII Deletion**: For each available file, the script makes the request to `GET /api/signer/download-pdf/[id]`. At this exact moment, the **platform deletes the confidential information (PII)** from the cloud database to maintain secrecy, leaving only the metadata and marking the `pdfDownloadedAt` date.
5. **Hybrid Decryption**:
   - Reads the downloaded binary PDF file.
   - Extracts the ML-KEM capsule, nonce, authTag, and AES ciphertext.
   - Decapsulates the key using their own wallet via `core.walletMlkemDecapsulate()`.
   - Decrypts the PDF back to its readable version using `core.aes256GcmDecrypt()`.
   - Saves the PDF locally in plaintext as `lib/decrypted_<credentialId>.pdf`.

### How to run:
```bash
node lib/simulate-mobile-download.js
```

## 4. Issuer Identifier vs. DID

When observing the generated PDF or the platform's settings page, you will notice two distinct identifiers. It is crucial to understand the cryptographic purpose of each:

### Decentralized Identity (DID)
**Example:** `did:ssipq:zHzcqWj9c21JqCYdKGGoeVDSXtjaTMdVowavVstxGuEYf`
- The DID is the primary readable address used for routing and registration in distributed environments.
- It publicly points to the **DID Document**, which in turn, carries the public keys (ML-DSA for signature and ML-KEM for pairing).
- It is the identity that users and systems exchange to initiate credential requests.

### Issuer Identifier
**Example:** `zv2BZBG5bBPLB4UITTtEyTl8Q3ZLZr7KxNHpf2s4Nww=`
- Unlike the logical address (DID), the Issuer Identifier is a **cryptographic fingerprint in Base64 (Hash/Fingerprint)** generated uniquely over the DID Document and the **raw public key**.
- **Security Purpose**: It is physically displayed inside the Credential's PDF file (and now also on the platform's Settings screen). 
- By linking the PDF document to the actual, mathematical *Hash* of the key instead of the mere textual address (DID), the `ssi_pq_core` library protects the PDF from trivial tampering (such as someone simply changing the DID string by editing the PDF without possessing the true private key corresponding to the signature attached to the document).

Thus, the **DID** identifies *where to find* the keys, and the **Issuer Identifier** proves *mathematically that the keys match* the present signature.

## 5. Credentials Cleanup (Testing Environment)

**Script:** `lib/clear-user-credentials.ts`

During the development and testing of the issuance flow, generation of PDFs, and encrypted PDF uploads, it may be necessary to clean the database of credentials that have already gone through the signature flow. As the platform aims to not have a button to "delete" a record permanently through the normal user interface (given the immutable nature of SSI records, except for revocation), we created a script to act directly on the database.

### Script Behavior:
1. It connects to the database via the environment URL (`DATABASE_URL` via `.env`).
2. Searches for the system user using the **Email**.
3. Counts how many credentials that email Issued (as `Issuer`) and Received (as `Holder`).
4. Presents the result on the screen and performs a security verification prompt (Yes/No).
5. If confirmed, triggers Prisma's `deleteMany`, permanently eliminating the credentials and their associated PDFs.

### How to run:
Execute the script passing the user's email in quotes:
```bash
npx tsx lib/clear-user-credentials.ts "email@exemplo.com"
```
