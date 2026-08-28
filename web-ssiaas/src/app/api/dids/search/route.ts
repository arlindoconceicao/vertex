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
    const authCredentialBase64 = request.headers.get("x-signer-auth-credential");

    const cpf = request.nextUrl.searchParams.get("cpf");
    const email = request.nextUrl.searchParams.get("email");
    const did = request.nextUrl.searchParams.get("did");

    if (!requesterId || !challengeId || !authCredentialBase64) {
      return NextResponse.json(
        { error: "Missing required headers (x-requester-id, x-challenge-id, x-signer-auth-credential)" },
        { status: 400 }
      );
    }

    if (!cpf && !email && !did) {
      return NextResponse.json(
        { error: "Missing required query parameter (cpf, email or did)" },
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

    // 4. Decode and Verify the Proof of Possession (VC)
    const authCredentialJson = Buffer.from(authCredentialBase64, 'base64').toString('utf-8');
    const authCredential = JSON.parse(authCredentialJson);

    if (!authCredential || !authCredential.credential || !authCredential.credential.issuer_did) {
      return NextResponse.json({ error: "Invalid auth credential structure" }, { status: 400 });
    }

    if (authCredential.credential.issuer_did !== requester.did) {
      return NextResponse.json({ error: "Credential issuer does not match requester DID" }, { status: 403 });
    }

    if (!requester.didDocument) {
      return NextResponse.json({ error: "Requester has no DID document registered" }, { status: 400 });
    }

    const core = getSsiPqCore();
    let isValidSignature = false;
    try {
      isValidSignature = core.verifySignedCredential(authCredential, requester.didDocument as object);
    } catch (err) {
      console.warn("Credential verification threw error:", err);
    }

    if (!isValidSignature) {
      return NextResponse.json({ error: "Invalid challenge credential signature" }, { status: 401 });
    }

    // 4.1. Validate the VC payload (action and nonce)
    const disclosures = authCredential.attribute_disclosures || [];
    const actionDisclosure = disclosures.find((d: any) => d.path === 'subject.action');
    const nonceDisclosure = disclosures.find((d: any) => d.path === 'subject.nonce');

    if (!actionDisclosure || actionDisclosure.value !== 'did_search_auth') {
      return NextResponse.json({ error: "Invalid action in auth credential" }, { status: 401 });
    }

    if (!nonceDisclosure || nonceDisclosure.value !== challenge.nonce) {
      return NextResponse.json({ error: "Nonce mismatch in auth credential" }, { status: 401 });
    }

    // 5. Mark challenge as COMPLETED
    await prisma.didSearchChallenge.update({
      where: { id: challengeId },
      data: { status: DidSearchStatus.COMPLETED, usedAt: new Date() },
    });

    // 6. Search for the target user's DID
    const whereClause = cpf ? { cpf: cpf.replace(/\D/g, "") } : (did ? { did } : { email: email as string });

    const targetUser = await prisma.user.findFirst({
      where: whereClause,
      select: {
        did: true,
        didPublicKey: true,
        didDocument: true,
        didIpfsCid: true,
        didPinataFileId: true,
        didPublishedAt: true,
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
          keys: [
            {
              id: "#mldsa-1",
              type: "ML-DSA-65",
              usage: ["authentication", "assertionMethod"],
              public_key_multibase: targetUser.didPublicKey
            }
          ],
          signature: {
            alg: "ML-DSA-65",
            key_id: "#mldsa-1",
            value: "mock-signature"
          },
          status: "active",
          type: "ssi_pq_did_document_v1"
        };

    const gateway = process.env.GATEWAY_PINATA;
    const ipfsUrl = targetUser.didIpfsCid && gateway ? `https://${gateway}/ipfs/${targetUser.didIpfsCid}` : null;

    return NextResponse.json({
      did: targetUser.did,
      didDocument,
      ipfsCid: targetUser.didIpfsCid,
      pinataFileId: targetUser.didPinataFileId,
      publishedAt: targetUser.didPublishedAt,
      ipfsUrl
    }, { status: 200 });
  } catch (error) {
    console.error("[GET /api/dids/search] Unexpected error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
