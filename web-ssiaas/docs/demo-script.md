# Vertex Web SSIaaS — Demo Script & Validation Guide

> **Purpose:** End-to-end system validation.
> **Platform:** Vertex Web SSIaaS (Next.js + Prisma + PostgreSQL)
> **Research:** FAPESP-funded

---

## 1. Environment Checklist

Complete every item below **before** opening the browser.

### Infrastructure

| # | Item | Command / Action | Expected Result |
|---|---|---|---|
| 1 | Docker Desktop running | Open Docker Desktop, wait for stable icon | Whale icon in system tray |
| 2 | PostgreSQL container up | `docker start vertex_postgres` | No error output |
| 3 | Container health check | `docker ps` | `vertex_postgres` with status `Up` |
| 4 | Dependencies installed | `npm install` | No errors |
| 5 | Prisma Client generated | `npx prisma generate` | `Generated Prisma Client` |
| 6 | Migrations applied | `npx prisma migrate deploy` | `All migrations applied` |
| 7 | Dev server running | `npm run dev` | `Ready on http://localhost:3000` |

### Users Setup (Two Actors Required)

The SSI triangle requires at least two people. You will play both roles:

| Actor | Role | How to Create |
|---|---|---|
| **User A** (You) | Issuer | Log in with your primary Google account |
| **User B** (Test Student) | Holder | Log in with a secondary Google account in an incognito window |

Both users must complete CPF registration before the demo begins.

### Optional but Recommended

| Item | Why |
|---|---|
| Prisma Studio open (`npx prisma studio`) | Watch database changes in real time during the demo |
| Two browser windows side by side | Show Issuer and Holder perspectives simultaneously |

---

## 2. Demo Storyline (The SSI Narrative)

The demo follows the real-world lifecycle of a verifiable credential,
from identity registration to independent verification by a third party.

```
Act 1: Identity          Act 2: Schema          Act 3: Issuance
┌──────────────┐     ┌──────────────────┐     ┌──────────────────┐
│ Register DID │ ──► │ Create Schema    │ ──► │ Issue Credential │
│ (Settings)   │     │ (Schema Builder) │     │ (Credential Form)│
└──────────────┘     │ Publish to IPFS  │     └────────┬─────────┘
                     └──────────────────┘              │
                                                       ▼
Act 4: Acceptance        Act 5: Verification
┌──────────────────┐     ┌──────────────────┐
│ Holder Accepts   │ ──► │ Public Verifier  │
│ (Holder's View)  │     │ (No login needed)│
└──────────────────┘     └──────────────────┘
```

### Act 1 — Identity Registration (Settings Page)

**Context:** "Before anyone can issue credentials in the
SSI model, they need a Decentralized Identifier — a DID. This is the
cryptographic identity that replaces centralized usernames."

1. Log in as **User A** (Issuer).
2. Navigate to **Settings**.
3. Show the profile section (email, masked CPF).
4. Register a DID: `did:web:vertex.unifesp.br:users:<userId>`
5. Enter a mock public key.
6. Click **Register DID** → green success badge appears.
7. Point out: "This DID is now stored in our database and can be resolved
   by anyone via our DID resolver endpoint."

### Act 2 — Schema Creation (Schemas Module)

**Context:** "Now that we have an identity, we can define what kind of
credentials we want to issue. Schemas are like blank forms — they define
the structure without containing any personal data."

1. Navigate to **Create Schema** (from the Issued Credentials tab).
2. Fill in:
   - Name: `Research Fellowship Certificate`
   - Description: `Certifies participation in a FAPESP-funded research project`
3. Add fields:
   - `researcherName` (string, required)
   - `projectTitle` (string, required)
   - `institution` (string, required)
   - `startYear` (number, required)
   - `isActive` (boolean, optional)
4. Show the **JSON Preview** at the bottom — "This is the machine-readable
   structure that follows our data model."
5. Click **Create Schema**.
6. On the detail page, click **Publish to IPFS** → CID appears.
7. Click **Make Public** → badge changes to "Public".
8. Say: "Once published to IPFS, this schema is immutable and
   independently verifiable. Making it public means any institution
   can use this same template."

### Act 3 — Credential Issuance (Credentials Module)

**Context:** "With the schema published, we can now issue a real
credential to a specific person — the Holder."

1. Navigate to **Issue Credential** (from the Issued Credentials tab).
2. Select the schema created in Act 2.
3. Show how the form **dynamically renders** the fields defined in the
   schema — "The UI adapts automatically to whatever structure the
   schema defines."
4. Fill in:
   - Holder Email: User B's email
   - researcherName: "Test Student"
   - projectTitle: "Vertex SSIaaS Platform"
   - institution: "UNIFESP"
   - startYear: 2025
   - isActive: true
5. Set an expiration date (e.g., one year from now).
6. Click **Issue Credential**.
7. Navigate to the credential detail page.
8. Point out: "Notice the status is PENDING and the payload shows the
   complete W3C JSON-LD structure with the schema snapshot embedded.
   The credential is unsigned — in production, the Mobile Signer App
   would sign this before the Holder receives it."

### Act 4 — Holder Acceptance (Switch to User B)

**Context:** "Now let's switch to the student's perspective. They
received a notification that a credential was issued to them."

1. Switch to the **incognito window** (User B / Holder).
2. Open **Dashboard** → "Received Credentials" tab shows the pending
   credential.
3. Click on the credential card → detail page opens.
4. Point out: "The Holder can see who issued it, what schema was used,
   and all the credential data. They have full sovereignty over whether
   to accept or not."
5. Click **Accept Credential** → status changes to ACTIVE.
6. Say: "This is the 'consent' step of SSI — no credential is forced
   upon you. You explicitly choose to add it to your digital wallet."

### Act 5 — Public Verification (No Login Required)

**Context:** "The final piece of the SSI triangle: verification. Anyone
in the world can verify this credential without needing an account."

1. Go back to **User A's credential detail page**.
2. Copy the entire **W3C Payload** JSON from the bottom of the page.
3. Open a **new browser tab** (or even a different browser entirely).
4. Navigate to `/verify` — no login required.
5. Paste the JSON payload.
6. Click **Verify Credential** → green "Valid Credential" result.
7. Say: "This verifier checked the W3C structure, confirmed the
   cryptographic proof field exists, and validated the expiration date.
   No account, no login, no trust relationship needed — that's the
   power of decentralized verification."

### Bonus: Show Revocation

1. Switch back to **User A** (Issuer).
2. Open the credential detail page.
3. Click **Revoke Credential** → confirm.
4. Status changes to REVOKED.
5. Say: "Revocation is instant because the session lives in our
   PostgreSQL database. In a JWT-based system, we'd have to wait for
   the token to expire. Database sessions give us real-time control."

---

## 3. Validation Matrix by Page

### Dashboard (`/dashboard`)

| Test | Steps | Expected | Status |
|---|---|---|---|
| **Happy: Stats display** | Log in, check widgets | All four widgets show correct counts | 🟡 |
| **Happy: Tab switching** | Click between Received / Issued tabs | Content changes, counts match badges | 🟡 |
| **Happy: CPF search** | In Issued tab, type a valid CPF | User found with name, email, masked CPF | 🟡 |
| **Edge: Search own CPF** | Type your own CPF | No results (self-exclusion works) | 🟡 |
| **Edge: Partial CPF** | Type only 5 digits | No search triggered (waits for 11) | 🟡 |
| **Edge: No session** | Access `/dashboard` logged out | Redirected to `/login` | 🟡 |
| **Edge: No CPF** | Log in without completing CPF | Redirected to `/complete-registration` | 🟡 |

### Settings (`/settings`)

| Test | Steps | Expected | Status |
|---|---|---|---|
| **Happy: Register DID** | Fill DID and public key, submit | Green success badge, fields become read-only | 🟡 |
| **Edge: Invalid DID format** | Enter "not-a-did" | Error: must start with 'did:' | 🟡 |
| **Edge: Register twice** | Try registering after already registered | Error: already have a DID | 🟡 |
| **Edge: Empty fields** | Submit with empty public key | Error: both fields required | 🟡 |

### Schemas (`/schemas`, `/schemas/new`, `/schemas/[id]`)

| Test | Steps | Expected | Status |
|---|---|---|---|
| **Happy: Create schema** | Fill name, description, add 3 fields, submit | Redirected to detail page | 🟡 |
| **Happy: Publish to IPFS** | Click "Publish to IPFS" on detail page | CID appears, badge shows "IPFS" | 🟡 |
| **Happy: Toggle visibility** | Click "Make Public" | Badge changes to "Public" | 🟡 |
| **Happy: JSON preview** | Add fields in creation form | Preview updates in real time | 🟡 |
| **Edge: Empty name** | Submit without a name | Error message displayed | 🟡 |
| **Edge: No fields** | Remove all fields and submit | Error: at least one field required | 🟡 |
| **Edge: Edit after publish** | (API test) PATCH name on a published schema | 400: Cannot edit a published schema | 🟡 |
| **Edge: Publish twice** | Click "Publish to IPFS" again (button should be gone) | Button disappears after first publish | 🟡 |
| **Edge: View others' private** | (API test) GET schema ID owned by another user, visibility PRIVATE | 404: Schema not found | 🟡 |

### Credentials (`/credentials/issue`, `/credentials/[id]`)

| Test | Steps | Expected | Status |
|---|---|---|---|
| **Happy: Issue credential** | Select schema, fill fields, enter holder email, submit | 202: Credential created, redirected to detail | 🟡 |
| **Happy: Dynamic fields** | Switch between schemas in the dropdown | Form fields change to match selected schema | 🟡 |
| **Happy: Accept (as Holder)** | Switch to Holder, click Accept | Status changes to ACTIVE | 🟡 |
| **Happy: Revoke (as Issuer)** | Switch to Issuer, click Revoke on active credential | Status changes to REVOKED | 🟡 |
| **Edge: Issue without DID** | Try issuing before registering DID | Error: must register DID first | 🟡 |
| **Edge: Issue to self** | Enter your own email as holder | Error: cannot issue to yourself | 🟡 |
| **Edge: Issue to unknown email** | Enter non-existent email | Error: no user found | 🟡 |
| **Edge: Accept as Issuer** | (API test) PATCH accept with issuer's session | 403: Forbidden | 🟡 |
| **Edge: Revoke as Holder** | (API test) PATCH revoke with holder's session | 403: Forbidden | 🟡 |
| **Edge: Revoke PENDING** | (API test) Try revoking a PENDING credential | 400: Only ACTIVE can be revoked | 🟡 |
| **Edge: Accept ACTIVE** | (API test) Try accepting an ACTIVE credential | 400: Only PENDING can be accepted | 🟡 |
| **Edge: Past expiration date** | Enter a past date in the form | Error: must be future date | 🟡 |

### Public Verifier (`/verify`)

| Test | Steps | Expected | Status |
|---|---|---|---|
| **Happy: Valid credential** | Paste complete signed payload | Green: "Valid Credential", 0 errors | 🟡 |
| **Happy: No login needed** | Open `/verify` in incognito without logging in | Page loads normally | 🟡 |
| **Edge: Expired credential** | Paste payload with past `expirationDate` | Red: "Credential has expired" | 🟡 |
| **Edge: Missing proof** | Paste payload without `proof` field | Red: "Missing proof field" | 🟡 |
| **Edge: Missing W3C fields** | Paste `{ "foo": "bar" }` | Red: multiple missing field errors | 🟡 |
| **Edge: Invalid JSON** | Paste `not json at all` | Error: "Invalid JSON" before even calling API | 🟡 |
| **Edge: Empty input** | Click Verify with empty textarea | Button is disabled | 🟡 |

*Legend: 🟢 Validated | 🟡 Awaiting Test | 🔴 Failed*

---

## 4. Speaking Script (One-Liners per Screen)

Use these during the live demo. Each line connects the technical
implementation to the SSI research value.

### Login
> "Authentication is handled via Google OIDC. We chose this to lower the
> barrier of entry, but the real identity layer is the DID — Google just
> gets you in the door."

### Complete Registration (CPF)
> "The CPF serves as our national identifier binding. We validate it
> mathematically using the official two-digit verification algorithm,
> not just by length."

### Dashboard
> "This is the unified inbox. Notice the clear separation between Holder
> and Issuer roles — the same user can be both, which is a core SSI
> principle. The stats widgets query the database in real time using
> PostgreSQL's GROUP BY."

### Settings (DID Registration)
> "This is where the decentralized identity is born. The DID follows the
> W3C DID Core specification and the public key uses Ed25519 multibase
> encoding. Once registered, it's immutable — just like a real
> cryptographic identity."

### Schema Creation
> "Schemas are the 'blank forms' of our system. They define structure
> without containing any personal data. Notice the JSON preview updating
> in real time — this is the machine-readable format that enables
> interoperability between different institutions."

### Schema Detail (After Publishing)
> "Once published to IPFS, this schema becomes content-addressed and
> immutable. The CID you see here is a cryptographic hash of the content
> itself. Two identical schemas anywhere in the world would produce the
> same CID — that's the power of content-addressable storage."

### Issue Credential
> "Watch how the form fields adapt dynamically to the selected schema.
> This is the bridge between the Issuer's template and the Holder's
> real data. The W3C payload is assembled automatically with the
> correct context, types, and DID references."

### Credential Detail (Issuer View)
> "The complete W3C Verifiable Credential payload is visible at the
> bottom. Notice the `credentialSchema` field embedded as a snapshot —
> we intentionally decoupled credentials from schemas at the database
> level for privacy. The schema reference lives inside the payload,
> not as a foreign key."

### Holder Acceptance
> "This is the consent mechanism of Self-Sovereign Identity. No
> credential is ever forced upon a user. The Holder explicitly
> chooses to accept, maintaining full sovereignty over their
> digital identity."

### Revocation
> "Revocation is instantaneous because we use database-stored sessions,
> not JWTs. For a platform issuing academic and institutional
> credentials, the ability to revoke access in milliseconds — not
> hours — is a non-negotiable security requirement."

### Public Verifier
> "This is the third vertex of the SSI trust triangle. Notice: no
> login required. Any person, institution, or automated system can
> paste a credential and verify it independently. The verifier doesn't
> need to trust the issuer, doesn't need an account, and doesn't need
> a pre-existing relationship. That's decentralized trust."

---

## 5. Quick Reference: Key Technical Decisions

Keep these in your back pocket for Q&A after the demo.

| Question | Answer |
|---|---|
| "Why database sessions instead of JWT?" | Instant revocation. JWT tokens live in the browser and can't be invalidated until they expire. For credential issuance platforms, that's a security risk. |
| "Why decouple credentials from schemas in the DB?" | Privacy. Credentials contain personal data. If we joined them to schemas via foreign key, deleting a schema could cascade-delete credentials, and querying schemas could expose credential metadata. The snapshot approach preserves both independence and auditability. |
| "Why is the Verifier public?" | It's a fundamental SSI principle. The trust triangle only works if verification doesn't require a relationship with the issuer. A locked verifier would recreate the centralized trust model we're trying to replace. |
| "Why not verify the cryptographic signature yet?" | The signature verification requires the Mobile Signer App (being developed by the team). Our structural validation proves the architecture works; the Ed25519 verification is a drop-in addition once the signer is ready. |
| "Why IPFS for schemas but not credentials?" | Schemas are structural templates with no personal data — safe to publish. Credentials contain PII (names, CPFs, institutional data) and must never be on a public, immutable network. |

---

*Vertex Web SSIaaS · UNIFESP · FAPESP Research*
