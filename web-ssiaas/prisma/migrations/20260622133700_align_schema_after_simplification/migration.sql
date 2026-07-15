-- Align database state from the IPFS/versioning migration to the simplified schema.

-- CreateEnum
CREATE TYPE "SchemaVisibility" AS ENUM ('PRIVATE', 'PUBLIC');

-- AlterTable
ALTER TABLE "users" ADD COLUMN "didPublicKey" TEXT;

-- AlterTable
ALTER TABLE "credential_schemas"
  ADD COLUMN "visibility" "SchemaVisibility" NOT NULL DEFAULT 'PRIVATE',
  ADD COLUMN "publishedAt" TIMESTAMP(3);

-- DropForeignKey
ALTER TABLE "credential_schemas" DROP CONSTRAINT "credential_schemas_parentId_fkey";

-- DropForeignKey
ALTER TABLE "verifiable_credentials" DROP CONSTRAINT "verifiable_credentials_schemaId_fkey";

-- AlterTable
ALTER TABLE "credential_schemas"
  DROP COLUMN "schemaType",
  DROP COLUMN "parentId",
  DROP COLUMN "isLatestVersion";

-- AlterTable
ALTER TABLE "verifiable_credentials"
  DROP COLUMN "schemaId",
  DROP COLUMN "ipfsCid",
  DROP COLUMN "storageLocation";

-- DropEnum
DROP TYPE "SchemaType";
