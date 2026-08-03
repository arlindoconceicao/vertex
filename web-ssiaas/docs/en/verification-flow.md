# Credential Verification Flow (`/verify`)

The Verification page (Verifier) is the public entry point of the system, where external entities can audit the authenticity and validity of post-quantum credentials issued by the platform. This screen is accessible without the need for authentication (login) and focuses 100% on security, privacy, and abuse control.

## 1. Verification Modes

The page supports two distinct auditing methods, ensuring versatility depending on who holds the PDF file.

### A. PDF Upload (Decrypted)
In this tab, the verifier uploads the (plaintext) PDF file that was presented by the Recipient (Holder). 
- The file is sent via `multipart/form-data`.
- **Extreme Privacy (In-Memory Processing):** The Node.js server receives the file directly into a RAM Buffer. The file is **never** saved on the server's disk.
- **SSI-PQ Integration:** The Buffer is passed to the native C++ library (`core.extractCredentialManifestFromPdf`), which locates the binary marker `%SSI-PQ-MANIFEST-V1` (inserted by the `core.walletEmbedSignedCredentialInPdf` function) and extracts the embedded JSON.
- **Validation:** The platform extracts the `issuer_did`, fetches the issuer's public key from the database, and invokes `core.verifySignedCredentialPdf` to check the Post-Quantum mathematical signatures.
- After processing (and returning success or failure to the web interface), the Node Garbage Collector purges the memory, keeping 0 traces.

### B. PDF Hash (Proof of Existence)
For cases where the verifier does not have the complete PDF or the recipient does not want to share the entire document, verification can occur solely by the **Hash (SHA-256)** generated from the bytes of the original PDF.
- The auditor pastes the credential hash on the screen.
- The `/api/verifier/verify` API searches for this hash in the `pdfHash` column of the Credentials table.
- If it exists, the credential is considered authentic (Proof of Existence), as the platform only stores hashes of validated and issued credentials.
- The platform returns the stored *metadata* information.

---

## 2. Anti-Abuse Protection (CAPTCHA)

Being a public route and performing complex cryptographic calculations (ML-DSA), the endpoint is a potential target for Brute Force and Denial of Service (DDoS) attacks. 

To prevent this, we implemented a **local Math CAPTCHA** (`MathCaptcha.tsx`).
- The user must solve a simple math equation in the interface (e.g., `7 + 4 = ?`).
- The `Verify credential signature` button is blocked until resolution.
- **Auto-reset:** Whenever a validation finishes (with success or error), the form undergoes a `reset`. The CAPTCHA draws a new equation and the button is disabled again. This makes batch validations using the same CAPTCHA proof impossible.

---

## 3. Data Return and Display (Schema Structure)

To preserve the privacy of who holds the credential, the platform was adjusted to remove sensitive information (PII) from the extracted metadata. 
The API return displays two large blocks of information on the screen:

1. **Proof of Existence Metadata:** Presents the clean `credential` JSON (excluding the detailed `attribute_hashes`), and adding the `revealed_attributes` key (which contains the path and value of the characteristics released in the signature).
2. **Schema Structure:** Displays the original data schema (`schema_id`) that guided the creation of the credential (e.g., Mandatory fields of the "Graduation Certificate"). This way, the auditor can see not only what was proven, but what the total possible scope of that credential is, guaranteeing the context of the verification.
