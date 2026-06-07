/*
  Warnings:

  - A unique constraint covering the columns `[did]` on the table `users` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "SchemaType" AS ENUM ('TEMPLATE', 'MUTABLE');

-- CreateEnum
CREATE TYPE "StorageLocation" AS ENUM ('LOCAL', 'IPFS');

-- AlterTable
ALTER TABLE "credential_schemas" ADD COLUMN     "ipfsCid" TEXT,
ADD COLUMN     "isLatestVersion" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "parentId" TEXT,
ADD COLUMN     "schemaType" "SchemaType" NOT NULL DEFAULT 'MUTABLE',
ADD COLUMN     "storageLocation" "StorageLocation" NOT NULL DEFAULT 'LOCAL';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "did" TEXT;

-- AlterTable
ALTER TABLE "verifiable_credentials" ADD COLUMN     "ipfsCid" TEXT,
ADD COLUMN     "storageLocation" "StorageLocation" NOT NULL DEFAULT 'LOCAL';

-- CreateIndex
CREATE UNIQUE INDEX "users_did_key" ON "users"("did");

-- AddForeignKey
ALTER TABLE "credential_schemas" ADD CONSTRAINT "credential_schemas_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "credential_schemas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
