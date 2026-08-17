import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { getSsiPqCore } from "../src/lib/ssi-pq";
import { generateSignerToken } from "../src/lib/signer-auth";
import { NextRequest } from "next/server";
import { POST } from "../src/app/api/dids/search/challenge/route";
import { GET } from "../src/app/api/dids/search/route";

async function runTest() {
  const core = getSsiPqCore();
  console.log("Starting test-did-search...");

  // Ensure SIGNER_SECRET is loaded
  if (!process.env.SIGNER_SECRET && !process.env.SIGNER_SECRETS) {
    throw new Error("SIGNER_SECRET or SIGNER_SECRETS must be set in .env");
  }

  // 1. Create a target user
  console.log("Creating target user...");
  const targetUserDidData = core.createDid({});
  const targetUser = await prisma.user.create({
    data: {
      email: "target@test.com",
      cpf: "12345678901",
      did: targetUserDidData.did,
      didPublicKey: targetUserDidData.didDocument.verificationMethod
        ? (targetUserDidData.didDocument.verificationMethod as any)[0].publicKeyMultibase
        : null,
      didDocument: targetUserDidData.didDocument as any,
    },
  });

  // 2. Create the requester (Mobile App) user
  console.log("Creating requester user...");
  const requesterDidData = core.createDid({});
  const requesterUser = await prisma.user.create({
    data: {
      email: "app@test.com",
      did: requesterDidData.did,
      didPublicKey: requesterDidData.didDocument.verificationMethod
        ? (requesterDidData.didDocument.verificationMethod as any)[0].publicKeyMultibase
        : null,
      didDocument: requesterDidData.didDocument as any,
    },
  });

  console.log("requesterUser:", requesterUser);

  try {
    // 3. Generate M2M token
    console.log("Generating M2M token...");
    const m2mToken = generateSignerToken(requesterUser.did!);

    // 4. Request Challenge
    console.log("Requesting challenge...");
    const challengeReq = new NextRequest("http://localhost/api/dids/search/challenge", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${m2mToken}`,
      },
      body: JSON.stringify({ requesterId: requesterUser.id }),
    });

    const challengeRes = await POST(challengeReq);
    const challengeData = await challengeRes.json();
    
    if (challengeRes.status !== 201) {
      throw new Error(`Failed to get challenge: ${JSON.stringify(challengeData)}`);
    }

    console.log("Challenge received:", challengeData);
    const nonceBuffer = Buffer.from(challengeData.nonce, "utf-8");

    // 5. Sign the challenge
    console.log("Signing challenge...");
    const signature = core.mldsaSign(
      "ML-DSA-65",
      requesterDidData.privateKeys.mldsaPrivateKey,
      nonceBuffer,
      "did-search-challenge"
    );

    // 6. Request Target User DID by CPF
    console.log("Requesting target DID by CPF...");
    const searchReq = new NextRequest(`http://localhost/api/dids/search?cpf=${targetUser.cpf}`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${m2mToken}`,
        "x-requester-id": requesterUser.id,
        "x-challenge-id": challengeData.id,
        "x-challenge-signature": signature,
      },
    });

    const searchRes = await GET(searchReq);
    const searchData = await searchRes.json();
    
    if (searchRes.status !== 200) {
      throw new Error(`Failed to search DID: ${JSON.stringify(searchData)}`);
    }

    console.log("Target DID received:", searchData);

    if (searchData.did === targetUser.did) {
      console.log("✅ Test Passed: DID matches");
    } else {
      console.log("❌ Test Failed: DID does not match");
    }
  } finally {
    // Cleanup
    console.log("Cleaning up DB...");
    await prisma.user.delete({ where: { id: targetUser.id } });
    await prisma.user.delete({ where: { id: requesterUser.id } });
    await prisma.$disconnect();
  }
}

runTest().catch((e) => {
  console.error("Test error:", e);
  process.exit(1);
});
