# DID Document Cryptographic Verification Test

This document outlines the purpose and execution instructions for the testing script designed to validate the cryptographic security and integrity of DID Documents (W3C format) on the platform, leveraging Post-Quantum Cryptography (PQC).

**File Path:** `lib/test-did-verify.ts`

## Objective

The goal of this test is to challenge the `verifyDidDocument` function (and consequently the `ssi_pq_core.node` native module) to guarantee that any tampered document is immediately rejected by the mathematical ML-DSA validation routines.

The test certifies that:
1. A genuinely generated document by the user successfully passes all signature and structural validations.
2. Any violation to its vital properties breaks the cryptographic hash bindings (fingerprint) or invalidates the digital mathematical proof, resulting in an immediate rejection of the payload.

## How to Run

Open your terminal in the project's root directory (`web-ssiaas`) and execute the script using `tsx`, providing the registered email address of a user who currently has a valid DID.

```bash
npx tsx lib/test-did-verify.ts user@example.com
```

> **Warning:** Ensure that the `.env` file is properly configured at the root of your project (including database variables and M2M secrets), as the test simulates a request from the Mobile App and temporarily interacts with the database.

## Scenarios Covered

The script runs a full end-to-end flow: it authenticates itself via the M2M endpoint (`/api/dids/search`), fetches the document, and executes 5 sequential checks.

### 1. Happy Path (Pristine Document)
The raw DID Document fetched from the database is passed directly to `verifyDidDocument`.
- **Expected Result:** The payload is validated with SUCCESS.

### 2. Test A: Identifier (ID) Tampering
The root identifier of the document (`did:ssipq:...`) is maliciously appended with a character.
- **Expected Result:** Rejection. The tampered ID no longer matches the public key representation (Broken Fingerprint/Hash).

### 3. Test B: Signing Key (ML-DSA) Tampering
The Base58BTC/Base64 content of the signing key (ML-DSA-65) is modified.
- **Expected Result:** Rejection. Because the DID identifier derives from this exact key, altering it causes the mathematical fingerprint correspondence to fail.

### 4. Test C: Encryption Key (ML-KEM) Tampering
The Key Agreement public key (ML-KEM-768) content is slightly tampered with.
- **Expected Result:** Rejection. Whether through strict integrity proofs or a full document hash signature, the tampering will be detected.

### 5. Test D: Document Signature (Proof) Tampering
The Base64Url digital signature coupled to the document (`signature.value` or `proof.proofValue`) is tampered with while keeping its original length to force the native ML-DSA engine to reject the signature mathematically.
- **Expected Result:** Rejection (or an exception thrown during native decoding). The mathematical proof will confirm that the payload was not signed by the owner's key.

## Cleanup

To keep the database clean, the script dynamically creates and deletes a dummy "requester" user whose sole purpose is to generate the Machine-to-Machine (M2M) authentication tokens needed to fetch the data through the protected API.
