# Credential Revocation Flow Documentation

This document describes the architecture, security rules, timestamp registration (`revokedAt`), and user experience for revoking Verifiable Credentials on the SSI platform.

---

## 1. Business Rules and Permissions

- **Only the Issuer:** The action of revoking a credential can only be initiated by the user who issued it (`credential.issuerId === session.user.id`).
- **Only Active Credentials (`ACTIVE`):** Credentials in `PENDING` state or that have already been `REVOKED` do not display the revocation option.
- **Irreversible Operation with Timestamp:** Once revoked, the status in the database permanently changes to `REVOKED` and the `revokedAt` field records the exact date and time (`new Date()`) of the operation.

---

## 2. User Experience (Confirmation Modal Pop-up)

By navigating to the details of a sent credential (`/credentials/[id]?view=issued`), the issuer sees the **Revoke Credential** button.

1. **Click the Revocation Button:**
   - An **extended Modal Pop-up** is rendered on the screen with a darkened backdrop (`backdrop-blur-md`).
2. **Visual and Security Alerts:**
   - Displays a red warning/danger icon.
   - Shows the ID of the credential being revoked.
   - Displays the highlighted warning in enlarged font: *"Are you sure you want to revoke this credential? This action cannot be undone and will permanently invalidate the credential for the holder."*
3. **Decision:**
   - **Cancel:** Closes the modal immediately without making server calls.
   - **Yes, Revoke Credential:** Triggers the Server Action `revokeCredential(credentialId)` via React `startTransition`. During processing, the button displays a loading spinner and is disabled.

---

## 3. Backend Architecture and Database

- **Prisma Schema (`prisma/schema.prisma`):**
  The `verifiable_credentials` table records the status and date/time of revocation:
  ```prisma
  enum VCStatus {
    PENDING
    ACTIVE
    REVOKED
  }

  model VerifiableCredential {
    id        String    @id
    status    VCStatus  @default(PENDING)
    revokedAt DateTime?
    // ...
  }
  ```
- **Server Action (`src/app/actions/credential-actions.ts`):**
  The `revokeCredential(credentialId)` function performs the following steps:
  1. Authenticates the active user session via `@/auth`.
  2. Validates if `credential.issuerId === session.user.id`.
  3. Changes the `status` column to `REVOKED` and writes `revokedAt: new Date()`.
  4. Executes `revalidatePath` on the routes `/credentials/[id]` and `/dashboard`.

---

## 4. Display on the Interface and Public Verifier (`/verify`)

1. **Credential Details Page (`/credentials/[id]`):**
   - When the credential is revoked, the interface displays the red badge: `Revoked on: MM/DD/YYYY at HH:mm:ss`.
2. **Public Verifier (`/verify`):**
   - If anyone submits the PDF or Hash of a revoked credential on the public verification route (`http://localhost:3000/verify`), the API returns the `REVOKED_CREDENTIAL` error with the `revokedAt` timestamp.
   - The form prominently displays the warning: *"This credential was REVOKED by the issuer on MM/DD/YYYY at HH:mm:ss and is no longer valid."*
