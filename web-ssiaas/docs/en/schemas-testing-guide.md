# Schemas, Search, and Pagination Testing Guide (`/schemas`)

This document describes the testing procedures and the purpose of the automated scripts for homologating the schemas page (`http://localhost:3000/schemas`).

---

## 1. Screen Features Overview

The `/schemas` route provides management and navigation for verifiable credential schemas on the platform:

- **Real-Time Search:** Allows searching both by **Schema Name** (e.g., `Identity`) and by **Schema ID** (e.g., `cms61gaq80004xmxkuk3f4lcz`).
- **Visibility and Ownership Filter:**
  - **All Schemas (`ALL`):** Displays all schemas the user has access to (their own private/public schemas and third-party public schemas).
  - **My Schemas (`MINE`):** Exclusively displays schemas created by the logged-in user (public and private).
  - **Public Schemas (`PUBLIC`):** Displays all public schemas available on the platform.
  - **My Private Schemas (`PRIVATE`):** Displays only the private schemas created by the logged-in user.
- **Pagination:** Groups the display into **9 items per page** with clean navigation ("Previous", "Page X of Y", "Next").

---

## 2. Automated Testing Scripts (`lib/`)

To test the pagination efficiency, filter selectors, and search responsiveness without having to manually create dozens of schemas via the Web interface, we provide two utility scripts in `lib/`:

### A. Fake Schemas Generation (`lib/generate-fake-schemas.js`)

This script creates a batch of test schemas in the database. All generated schemas mandatorily receive a prefix in their name: `"T1000T"`.

**Execution Command:**
```bash
# Create 20 test schemas for the first user in the database:
node lib/generate-fake-schemas.js 20

# Create 25 test schemas for a specific user:
node lib/generate-fake-schemas.js 25 teste@gmail.com
```

**Behavior:**
- Generates varied titles (Diplomas, Certificates, Accreditations).
- Randomly alternates between `PUBLIC` and `PRIVATE` visibilities.
- Links the creator to the specified user to validate the "My Schemas" and "Public" filters.

---

### B. Fake Schemas Cleanup (`lib/cleanup-fake-schemas.js`)

This script removes from the PostgreSQL database all schemas whose names begin with the `"T1000T"` prefix.

**Execution Command:**
```bash
node lib/cleanup-fake-schemas.js
```

**Advantages:**
- Allows populating the database with 50+ records to homologate pagination and then cleaning it all up with a single command.
- Does not affect real schemas manually created by application users.

---

## 3. E2E Validation Script

1. Run the generation script:
   ```bash
   node lib/generate-fake-schemas.js 25 teste@gmail.com
   ```
2. Access the route: `http://localhost:3000/schemas`.
3. Check the generated pagination (3 pages). Navigate between them using "Next" and "Previous".
4. Toggle the filter selector to "My Private Schemas" and confirm that only private schemas created by you remain visible.
5. Type `"T1000T"` or an ID in the search field to test the real-time filter.
6. Run the cleanup script:
   ```bash
   node lib/cleanup-fake-schemas.js
   ```
7. Reload the `/schemas` page and confirm that the database has returned to its original state.
