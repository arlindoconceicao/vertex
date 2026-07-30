import { prisma } from "./src/lib/prisma";
import fs from "fs";
import path from "path";

async function main() {
  const simulateKeysPath = path.join(__dirname, "lib", "simulate_keys.json");
  const keys = JSON.parse(fs.readFileSync(simulateKeysPath, "utf-8"));
  const lastKey = keys[keys.length - 1];

  const did = lastKey.did;
  const didDocument = lastKey.didDocument;
  
  // Extract mldsa pubkey multibase
  const mlDsaKeyObj = didDocument.keys.find((k: any) => k.type === "ML-DSA-65");
  const mlKemKeyObj = didDocument.keys.find((k: any) => k.type === "ML-KEM-768");

  await prisma.user.upsert({
    where: { did },
    update: {
      didDocument,
      didPublicKey: mlDsaKeyObj.public_key_multibase,
      didMlkemKey: mlKemKeyObj.public_key_multibase,
    },
    create: {
      email: `test-${Date.now()}@example.com`,
      did,
      didDocument,
      didPublicKey: mlDsaKeyObj.public_key_multibase,
      didMlkemKey: mlKemKeyObj.public_key_multibase,
      didPairedAt: new Date()
    }
  });

  console.log("Successfully injected DID into database:", did);

  // Update pending credentials to belong to this issuer DID
  const issuerUser = await prisma.user.findUnique({ where: { did } });
  if (issuerUser) {
    await prisma.verifiableCredential.updateMany({
      where: { status: "PENDING" },
      data: {
        issuerId: issuerUser.id
      }
    });
    console.log("Successfully linked pending credentials to this DID.");
  } else {
    console.log("Issuer user not found, skipping credential update.");
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
