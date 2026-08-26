import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateSignerToken } from "@/lib/signer-auth";
import { DidSearchStatus } from "@prisma/client";
import { getSsiPqCore, normalizeMldsaPublicKey } from "@/lib/ssi-pq";

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    const requesterId = request.headers.get("x-requester-id");
    const challengeId = request.headers.get("x-challenge-id");
    const signature = request.headers.get("x-challenge-signature");

    const cpf = request.nextUrl.searchParams.get("cpf");
    const email = request.nextUrl.searchParams.get("email");

    if (!requesterId || !challengeId || !signature) {
      return NextResponse.json(
        { error: "Missing required headers (x-requester-id, x-challenge-id, x-challenge-signature)" },
        { status: 400 }
      );
    }

    if (!cpf && !email) {
      return NextResponse.json(
        { error: "Missing required query parameter (cpf or email)" },
        { status: 400 }
      );
    }

    // 1. Verify the requester
    const requester = await prisma.user.findUnique({
      where: { id: requesterId },
      select: { id: true, did: true, didPublicKey: true, didDocument: true },
    });

    if (!requester || !requester.did) {
      return NextResponse.json({ error: "Requester or requester's DID not found" }, { status: 404 });
    }

    // 2. Validate the M2M token
    if (!validateSignerToken(authHeader, requester.did)) {
      return NextResponse.json({ error: "Unauthorized M2M token" }, { status: 401 });
    }

    // 3. Verify the challenge exists and is pending
    const challenge = await prisma.didSearchChallenge.findUnique({
      where: { id: challengeId },
    });

    if (!challenge) {
      return NextResponse.json({ error: "Challenge not found" }, { status: 404 });
    }

    if (challenge.requesterId !== requester.id) {
      return NextResponse.json({ error: "Challenge does not belong to the requester" }, { status: 403 });
    }

    if (challenge.status !== DidSearchStatus.PENDING) {
      return NextResponse.json({ error: "Challenge is no longer pending" }, { status: 400 });
    }

    if (new Date() > challenge.expiresAt) {
      await prisma.didSearchChallenge.update({
        where: { id: challengeId },
        data: { status: DidSearchStatus.EXPIRED },
      });
      return NextResponse.json({ error: "Challenge has expired" }, { status: 400 });
    }

    // 4. Verify the cryptographic signature of the nonce
    // Extrai a chave ML-DSA do documento DID do solicitante
    let requesterPublicKey = requester.didPublicKey;
    if (!requesterPublicKey && requester.didDocument) {
      const doc = requester.didDocument as any;
      
      // Formato SSI-PQ (keys array)
      if (Array.isArray(doc.keys)) {
        const k = doc.keys.find((key: any) => key.type === "mldsa" || key.type === "ML-DSA-65" || key.use === "sig");
        if (k && (k.public_key_multibase || k.publicKeyMultibase)) {
          requesterPublicKey = k.public_key_multibase || k.publicKeyMultibase;
        }
      }
      
      // Formato W3C (verificationMethod array)
      if (!requesterPublicKey && Array.isArray(doc.verificationMethod)) {
        for (const vm of doc.verificationMethod) {
          if (vm.type === "Ed25519VerificationKey2020" && vm.publicKeyMultibase) {
            requesterPublicKey = vm.publicKeyMultibase;
            break;
          }
        }
      }
    }

    if (!requesterPublicKey) {
      return NextResponse.json({ error: "Requester does not have a public key to verify signature" }, { status: 400 });
    }

    const core = getSsiPqCore();
    const normalizedPubKey = normalizeMldsaPublicKey(requesterPublicKey);
    const messageBuffer = Buffer.from(challenge.nonce, "utf-8");

    // "did-search-challenge" context or similar
    const isValidSignature = core.mldsaVerify(
      "ML-DSA-65",
      normalizedPubKey,
      messageBuffer,
      "did-search-challenge",
      signature
    );

    if (!isValidSignature) {
      return NextResponse.json({ error: "Invalid challenge signature" }, { status: 401 });
    }

    // 5. Mark challenge as COMPLETED
    await prisma.didSearchChallenge.update({
      where: { id: challengeId },
      data: { status: DidSearchStatus.COMPLETED, usedAt: new Date() },
    });

    // 6. Search for the target user's DID
    const whereClause = cpf ? { cpf: cpf.replace(/\D/g, "") } : { email: email as string };

    const targetUser = await prisma.user.findFirst({
      where: whereClause,
      select: {
        did: true,
        didPublicKey: true,
        didDocument: true,
      },
    });

    if (!targetUser || !targetUser.did) {
      return NextResponse.json({ error: "Target user or DID not found" }, { status: 404 });
    }

    // Resolves the didDocument properly
    const didDocument = targetUser.didDocument && typeof targetUser.didDocument === "object"
      ? targetUser.didDocument
      : {
          "@context": ["https://www.w3.org/ns/did/v1"],
          id: targetUser.did,
          verificationMethod: [
            {
              id: `${targetUser.did}#key-1`,
              type: "Ed25519VerificationKey2020",
              controller: targetUser.did,
              publicKeyMultibase: targetUser.didPublicKey,
            },
          ],
          authentication: [`${targetUser.did}#key-1`],
        };

    return NextResponse.json({ did: targetUser.did, didDocument }, { status: 200 });
  } catch (error) {
    console.error("[GET /api/dids/search] Unexpected error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
