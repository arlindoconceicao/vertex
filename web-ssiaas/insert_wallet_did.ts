import { prisma } from "./src/lib/prisma";
import fs from "fs";
import path from "path";
const core = require("./lib/ssi_pq_core.node");

async function main() {
  const walletPath = path.join(__dirname, "lib", "mobile_wallet.db");
  const keysFilePath = path.join(__dirname, "lib", "keys.txt");
  const walletPassword = fs.readFileSync(keysFilePath, "utf-8").trim();

  core.walletOpen(walletPath, walletPassword);
  const dids = core.walletListDids(walletPath, walletPassword);
  
  const targetDid = dids[dids.length - 1].did;
  const didDocument = core.walletGetDidDocument(walletPath, walletPassword, targetDid);
  
  // Extract mldsa pubkey multibase
  const mlDsaKeyObj = didDocument.keys ? didDocument.keys.find((k: any) => k.type === "ML-DSA-65") :
                      didDocument.verificationMethod ? didDocument.verificationMethod.find((k: any) => k.type === "ML-DSA-65" || k.type === "ML-DSA") : null;
  const mlKemKeyObj = didDocument.keys ? didDocument.keys.find((k: any) => k.type === "ML-KEM-768") :
                      didDocument.verificationMethod ? didDocument.verificationMethod.find((k: any) => k.type === "ML-KEM-768" || k.type === "ML-KEM") : null;

  await prisma.user.upsert({
    where: { did: targetDid },
    update: {
      didDocument: didDocument,
      didPublicKey: mlDsaKeyObj ? (mlDsaKeyObj.public_key_multibase || mlDsaKeyObj.publicKeyMultibase) : null,
      didMlkemKey: mlKemKeyObj ? (mlKemKeyObj.public_key_multibase || mlKemKeyObj.publicKeyMultibase) : null,
    },
    create: {
      email: `test-${Date.now()}@example.com`,
      did: targetDid,
      didDocument: didDocument,
      didPublicKey: mlDsaKeyObj ? (mlDsaKeyObj.public_key_multibase || mlDsaKeyObj.publicKeyMultibase) : null,
      didMlkemKey: mlKemKeyObj ? (mlKemKeyObj.public_key_multibase || mlKemKeyObj.publicKeyMultibase) : null,
      didPairedAt: new Date()
    }
  });

  console.log("Successfully injected DID into database:", targetDid);

  // Update pending credentials to belong to this issuer DID
  await prisma.verifiableCredential.updateMany({
    where: { status: "PENDING" },
    data: {
      issuerId: (await prisma.user.findUnique({ where: { did: targetDid } }))!.id
    }
  });
  console.log("Successfully linked pending credentials to this DID.");
}

main().catch(console.error).finally(() => prisma.$disconnect());
