# Dashboard Testing Guide (`/dashboard`) - Search, Filters, and Pagination

This document describes the testing procedures and the utility of the scripts for the homologation of the **Received Credentials** and **Issued Credentials** tabs on the Dashboard page (`http://localhost:3000/dashboard`).

---

## 1. Features Overview

On the Dashboard, both the Recipient (Holder) and the Issuer have advanced tools to manage and filter their volume of credentials:

- **Real-Time Search:** Allows filtering instantly by:
  - Name or email of the counterparty (Issuer or Recipient).
  - Source Schema name.
  - Schema ID or Credential ID.
  - Credential Type (e.g., `Identity`, `Diploma`).
- **Status Filter:** Refines the search by credential state (`All Statuses`, `Active`, `Pending`, `Revoked`).
- **Pagination:** Groups the display into **6 credentials per page** with navigation controls ("Previous", "Page X of Y", "Next").

---

## 2. Automated Testing Scripts in `lib/`

To test search and pagination without having to manually create and sign dozens of credentials, use the auxiliary scripts:

### A. Fake Credentials Generation (`lib/generate-fake-credentials.js`)

Creates a batch of test credentials linked to your account. All generated credentials contain the prefix `"T1000T"`.

```bash
# Generate 15 test credentials for the default email:
node lib/generate-fake-credentials.js 15 teste@gmail.com
```

- Alternates statuses between `ACTIVE`, `PENDING`, and `REVOKED`.
- Assigns realistic titles and data to test the search filters.

---

### B. Fake Credentials Cleanup (`lib/cleanup-fake-credentials.js`)

Removes all test credentials and schemas created with the `"T1000T"` prefix from the database.

```bash
node lib/cleanup-fake-credentials.js
```

---

## 3. E2E Homologation Script

1. Generate 15 test credentials in the database:
   ```bash
   node lib/generate-fake-credentials.js 15 teste@gmail.com
   ```
2. Access `http://localhost:3000/dashboard`.
3. Navigate between pages on the "Received Credentials" tab.
4. Try filtering by status (e.g., select "Pending").
5. Type a search term (e.g., `"Identity"` or an issuer's email) to test the reactive search.
6. Clean up the temporary credentials from the database:
   ```bash
   node lib/cleanup-fake-credentials.js
   ```
