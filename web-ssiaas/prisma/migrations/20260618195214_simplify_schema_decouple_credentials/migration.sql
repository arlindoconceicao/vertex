/*
  Warnings:

  - You are about to drop the column `isLatestVersion` on the `credential_schemas` table. All the data in the column will be lost.
  - You are about to drop the column `parentId` on the `credential_schemas` table. All the data in the column will be lost.
  - You are about to drop the column `schemaType` on the `credential_schemas` table. All the data in the column will be lost.
  - You are about to drop the column `ipfsCid` on the `verifiable_credentials` table. All the data in the column will be lost.
  - You are about to drop the column `schemaId` on the `verifiable_credentials` table. All the data in the column will be lost.
  - You are about to drop the column `storageLocation` on the `verifiable_credentials` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "SchemaVisibility" AS ENUM ('PRIVATE', 'PUBLIC');

-- DropForeignKey
ALTER TABLE "credential_schemas" DROP CONSTRAINT "credential_schemas_parentId_fkey";

-- DropForeignKey
ALTER TABLE "verifiable_credentials" DROP CONSTRAINT "verifiable_credentials_schemaId_fkey";

-- AlterTable
ALTER TABLE "credential_schemas" DROP COLUMN "isLatestVersion",
DROP COLUMN "parentId",
DROP COLUMN "schemaType",
ADD COLUMN     "publishedAt" TIMESTAMP(3),
ADD COLUMN     "visibility" "SchemaVisibility" NOT NULL DEFAULT 'PRIVATE';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "didPublicKey" TEXT;

-- AlterTable
ALTER TABLE "verifiable_credentials" DROP COLUMN "ipfsCid",
DROP COLUMN "schemaId",
DROP COLUMN "storageLocation";

-- DropEnum
DROP TYPE "SchemaType";
