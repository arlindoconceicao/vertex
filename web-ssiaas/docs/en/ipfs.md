# IPFS Integration with Pinata

This document explains how the SSI Platform integrates with IPFS (InterPlanetary File System) using Pinata to host Credential Schemas and DID Documents.

## Overview

Verifiable Credentials (VCs) rely on data schemas (JSON Schema) to define their structure. In addition, the SSI architecture requires users' public keys to be available on the network via DID Documents. For interoperability and immutability, both schemas and DID documents can be published to the public IPFS network. The platform uses the Pinata SDK to upload these JSON files without running a dedicated IPFS node.

## Implementation Details

1. **Database Schema:**
   In Prisma, we use the following fields:
   - For `CredentialSchema`: `ipfsCid`, `pinataFileId`, and `storageLocation`.
   - For `User` (regarding the DID Document): `didIpfsCid`, `didPinataFileId`, and `didPublishedAt`.

2. **Backend Server Action:**
   - In `src/app/actions/schema-actions.ts`, the `publishSchema` function pushes the schema to the Pinata gateway with the metadata `keyvalues` configured as `resourceType: ssi-schema`.
   - In `src/app/actions/did-actions.ts`, the `publishDidDocumentToIpfs` function performs the same operation for the users' DID documents (metadata: `resourceType: did-document`).

3. **Frontend Integration:**
   - When a **schema** is published, the user interface (`SchemaDetailClientView.tsx`) displays the Pinata File ID, the IPFS CID, and the link for viewing.
   - Similarly, when a user's **DID Document** is published, the DID Document tab in settings (`DidDocumentTab.tsx`) displays these technical details and provides a link for public consultation (`https://{GATEWAY_URL}/ipfs/{CID}`).

## Environment Configuration

The platform requires an active Pinata account with API keys configured in the `.env` file.

Add the following to your `.env` (a template is available in `.env.example`):

```env
# --- PINATA IPFS ---
# URL of your Dedicated Pinata Gateway (e.g. my-gateway.mypinata.cloud)
GATEWAY_PINATA="your-gateway.mypinata.cloud"
# JWT Token for API authentication
JWT_PINATA="eyJhbGciOiJIUzI1NiIsInR5cCI..."
```

## How to Configure Your Pinata Account

To retrieve your Gateway and JWT credentials, follow these steps:

1. **Create an Account:**
   Go to [Pinata](https://app.pinata.cloud/auth/signup) and create a free account. The free tier offers 1GB of storage and a dedicated gateway, which is more than enough for small JSON schemas.

2. **Obtain the Gateway URL:**
   - In the Pinata dashboard, click on **Gateways**.
   - Locate the dedicated gateway automatically created for you.
   - Copy only the domain name (e.g., `aquamarine-casual-tarantula-177.mypinata.cloud`). Do NOT include `https://` or `/ipfs/`. Paste this into `GATEWAY_PINATA`.

3. **Generate an API Key (JWT):**
   - In the Pinata dashboard, click on **API Keys**.
   - Click **New Key**.
   - Select the following permissions to ensure security:
     - `org:files:read`
     - `org:files:write`
   - Name the key (e.g., "ssi-platform-backend").
   - Click **Create Key**.
   - Copy the long string marked as **JWT** and paste it into `JWT_PINATA`.
   - *Note: Keep your JWT secure. It should only be present in the backend `.env` file and never exposed in the frontend.*
