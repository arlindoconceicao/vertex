# E2E Tutorial: Authentication, Signature, and Post-Quantum Download

> [!WARNING]
> **ATTENTION (PRODUCTION ENVIRONMENT):** All Node scripts (`.js` and `.ts`) mentioned in this tutorial, located in the `lib/` folder, access the database directly and manipulate critical application states for testing purposes. In a **Production** environment, these files MUST be removed. The `lib/` folder in production should contain only the `ssi_pq_core.node` binary and internal Next.js utilities, preventing unauthorized access.

This tutorial describes the complete and ordered step-by-step process to test the lifecycle of a Verifiable Credential on the platform, simulating the actions of the Issuer (Mobile App), the Recipient (Mobile/Web App), and the Verifier (Public Platform) starting **exactly from scratch**. All tests use the utility scripts located in the `lib/` folder.

Use this script to homologate the Post-Quantum flow end-to-end.

---

## 1. Environment Cleanup and Reset (Starting from Scratch)

To ensure no conflicts with previous tests, we clean the database by unlinking old DIDs and deleting credentials from past tests. (In this example, we will use `teste@gmail.com`).

**Clear DID Pairing:**
This script removes the user's DID, public keys, and previous pairing challenges from the database.
```bash
node lib/reset-did.js teste@gmail.com
```

**Clear Old Credentials:**
```bash
npx tsx lib/clear-user-credentials.ts "teste@gmail.com"
```

---

## 2. Initial Pairing Tests (Optional)

Before officially pairing your user for the main flow, you can run the following scripts that validate the integrity of the pairing system:

**A. Forged Pairing Test (Negative):**
Simulates an attack where someone tries to respond to the pairing challenge using forged keys (invalid ML-DSA signature). The platform **must reject**.
```bash
node lib/complete-pairing-forged.js
```

**B. Automated Pairing Test:**
Runs the entire flow automatically (creates challenge, signs with real key, sends, and approves) without manual intervention.
```bash
node lib/did-pairing-flow.test.js
```

---

## 3. Manual Pairing Simulating the App

In order for your credentials issued via Web to be signed correctly, you must associate your user with the local Mobile Wallet.
1. Access the web platform (`/settings`) and start pairing.
2. Copy the JSON Payload generated on the screen.
3. Run the script passing the payload between single quotes to simulate the Mobile App completing the pairing:
```bash
node lib/complete-pairing.js '{"pairingId":"...", "nonce":"...", ...}'
```
*The script will create the `mobile_wallet.db` with your new DID identity and post-quantum keys, successfully linking it to the database.*

---

## 4. Credential Issuance (Web Interface)

1. Access the platform's **Dashboard**.
2. Click on **Issue New Credential**.
3. Fill out the forms with the recipient's data and submit. 
4. The credential will remain in the `PENDING` state awaiting signature from the Mobile Wallet.
   - **Privacy & Security Rule:** While `PENDING`, the credential is visible **exclusively to the Issuer** in their "Issued Credentials" tab. The Recipient **never** sees pending credentials until the post-quantum signature process is completed.

---

## 5. Signature Simulation (Issuer's Mobile Wallet)

The Issuer's App fetches the pending credential and signs the data by injecting the Post-Quantum SSI Manifest into the PDF.

Run:
```bash
node lib/generate-pending-pdfs.js
```
*Generates the local signed plaintext `.pdf` file.*

---

## 6. Proof of Existence Generation (Optional - PDF Hash)

If you want to test the Hash validation later on the public screen, you can extract the exact SHA-256 of this plaintext PDF now.
```bash
node lib/get-pdf-hash.js lib/credential_XXXXXXXX.pdf
```
*Keep the returned hash to paste into the "PDF Hash" tab of the Verification page.*

---

## 7. Encrypted Upload to the Platform (Issuer's Mobile Wallet)

The Issuer's App encrypts the PDF using the Recipient's public key (ML-KEM) before sending it to the web.
```bash
node lib/upload-pdfs.js
```
*Upon completion of this upload, the credential status automatically changes to `ACTIVE`, making it finally visible and available in the Recipient's "Received Credentials" tab.*

---

## 8. Download and Decryption

The Recipient wants to read their newly issued credential. They can do this in two ways in the simulation:

**A. Simulation via Mobile App (Automatic):**
This script simulates the App making the API call to download the `.enc` file, opening `mobile_wallet.db`, and performing decapsulation (ML-KEM + AES-GCM) to generate the plaintext PDF locally.
```bash
node lib/simulate-mobile-download.js
```

**B. Simulation via Web Interface (Manual):**
You access the Web Dashboard with the recipient's account and manually download the `.enc`. To decrypt this file on your local PC using your test Wallet:
```bash
node lib/decrypt-local-pdf.js ~/Downloads/credential_XXXXXXXX.pdf.enc
```

Both steps will generate a readable PDF (ending in `_decifrado.pdf`).

---

## 9. Public Cryptographic Validation (Verifier)

To attest the complete cycle, use the decrypted file or the hash generated in Step 6.

1. Access the public route: `http://localhost:3000/verify`
2. **Via PDF**: In the "PDF Upload" tab, submit `_decifrado.pdf`. The platform will read the keys in-memory and yield "Valid".
3. **Via Hash**: In the "PDF Hash" tab, paste the hash from Step 6 to attest existence in the database.

---

## 10. Privacy Dynamics on the Dashboard (Holder vs Issuer)

The Dashboard (`/credentials/[id]`) dynamically handles data visibility and erasure (Zero-Knowledge):

- **Recipient's View (Holder):**
  "Received Credentials" tab. Displays credentials in `ACTIVE` or `REVOKED` statuses (`PENDING` credentials are not displayed). You will have the option to download the encrypted PDF. After the first download, the platform will **permanently delete the PII data from the database**, replacing the keys with `"Ocultado (PII removido)"` (Hidden (PII removed)).

- **Issuer's View (Issuer):**
  "Issued Credentials" tab. Displays issuances in all statuses (`PENDING`, `ACTIVE`, `REVOKED`).
  - **While PENDING**: Awaiting signature by the Signer App.
  - **After ACTIVE (before download by Holder)**: Displays the **Show Data** button, allowing you to see the issued data.
  - **After Holder downloads**: The "Show Data" button disappears, and the screen will only display the keys (e.g., `Name`, `CPF`) with values marked as "Ocultado (PII removido)".

> **Important for unified testing:** 
> If you used the **same user** (same email/DID) to act as both Issuer and Recipient in the test, clicking the credential card on the main screen will cause the platform to send an internal parameter (`?view=received` or `?view=issued`), forcing the correct perspective of that tab so buttons don't overlap.

### Reset Script for Visual Testing

If you have already run the Recipient's download simulation and wish to test viewing the raw data again in the Issuer's view **without needing to issue a new credential**, simply use the reset script.

```bash
# Reset a specific credential:
node lib/reset-download-status.js "CREDENTIAL_ID"

# Reset all credentials for an issuer at once:
node lib/reset-download-status.js "teste@gmail.com"
```
