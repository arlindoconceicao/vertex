import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { DidPairingStatus } from "@prisma/client";
import {
  verifyDidDocument,
  verifyPairingChallengeProof,
} from "@/lib/ssi-pq";

interface CompletePairingBody {
  id?: string;
  pairingId?: string;
  nonce?: string;
  expiresAt?: string;
  userId?: string;
  email?: string;
  did?: string;
  mlDsaPublicKey?: string;
  mlKemPublicKey?: string;
  didDocument?: Record<string, unknown>;
  proof?: {
    type?: string;
    created?: string;
    verificationMethod?: string;
    proofValue?: string;
  };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ pairingId: string }> }
) {
  const session = await auth();
  const sessionUserId = session?.user?.id;

  const { pairingId } = await params;

  if (!pairingId) {
    return NextResponse.json(
      { error: "Missing required parameter: pairingId" },
      { status: 400 }
    );
  }

  let body: CompletePairingBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    did,
    nonce,
    didDocument,
    mlDsaPublicKey,
    mlKemPublicKey,
    pairingId: bodyPairingId,
    userId: bodyUserId,
    email: bodyEmail,
    proof,
  } = body;

  // 1. Validação do DID
  const targetDid = did?.trim() || (didDocument?.id as string | undefined)?.trim();
  if (!targetDid || !targetDid.startsWith("did:")) {
    return NextResponse.json(
      { error: "Invalid or missing DID in payload. Must start with 'did:'." },
      { status: 400 }
    );
  }

  // 2. Validação do pairingId do body se fornecido
  if (bodyPairingId && bodyPairingId !== pairingId) {
    return NextResponse.json(
      { error: "Mismatched pairingId between URL and payload" },
      { status: 400 }
    );
  }

  try {
    // 3. Busca o desafio de pareamento no banco
    const challenge = await prisma.didPairingChallenge.findUnique({
      where: { pairingId },
    });

    if (!challenge) {
      return NextResponse.json(
        { error: "Pairing challenge not found" },
        { status: 404 }
      );
    }

    // 4. Validação de Autorização e Correspondência da Conta
    if (sessionUserId && sessionUserId !== challenge.userId) {
      return NextResponse.json(
        { error: "Forbidden: challenge does not belong to user" },
        { status: 403 }
      );
    }

    if (!sessionUserId) {
      const emailMatches =
        bodyEmail && bodyEmail.trim().toLowerCase() === challenge.email.toLowerCase();
      const userIdMatches = bodyUserId && bodyUserId.trim() === challenge.userId;

      if (!emailMatches && !userIdMatches) {
        return NextResponse.json(
          {
            error: "Unauthorized",
            details: `Mobile app must specify the matching Google account email (${challenge.email}) or userId.`,
          },
          { status: 401 }
        );
      }
    }

    if (bodyEmail && bodyEmail.trim().toLowerCase() !== challenge.email.toLowerCase()) {
      return NextResponse.json(
        {
          error: "Google account mismatch",
          details: `Mobile app must be logged into the same account (${challenge.email}).`,
        },
        { status: 403 }
      );
    }

    if (bodyUserId && bodyUserId.trim() !== challenge.userId) {
      return NextResponse.json(
        {
          error: "User ID mismatch",
          details: "Mobile app user ID does not match the pairing challenge owner.",
        },
        { status: 403 }
      );
    }

    // 5. Valida status do desafio
    if (challenge.status !== DidPairingStatus.PENDING) {
      return NextResponse.json(
        {
          error: `Invalid challenge status: ${challenge.status}`,
          details: "Challenge is no longer pending.",
        },
        { status: 409 }
      );
    }

    // 6. Valida expiração do desafio
    if (new Date() > challenge.expiresAt) {
      await prisma.didPairingChallenge.update({
        where: { id: challenge.id },
        data: { status: DidPairingStatus.EXPIRED },
      });

      return NextResponse.json(
        { error: "Challenge expired" },
        { status: 410 }
      );
    }

    // 7. Valida o nonce se fornecido no payload
    if (nonce && nonce !== challenge.nonce) {
      return NextResponse.json(
        { error: "Invalid nonce" },
        { status: 400 }
      );
    }

    const targetUserId = challenge.userId;

    // 8. Verifica se o usuário já possui DID pareado
    const user = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { did: true },
    });

    if (user?.did) {
      return NextResponse.json(
        { error: "User already has a paired DID" },
        { status: 409 }
      );
    }

    // 9. Constrói e valida o DID Document se fornecido
    const finalDidDocument = didDocument || {
      "@context": ["https://www.w3.org/ns/did/v1"],
      id: targetDid,
      verificationMethod: [
        {
          id: `${targetDid}#key-1`,
          type: "ML-DSA",
          controller: targetDid,
          publicKeyMultibase: mlDsaPublicKey || "",
        },
        ...(mlKemPublicKey
          ? [
              {
                id: `${targetDid}#key-2`,
                type: "ML-KEM",
                controller: targetDid,
                publicKeyMultibase: mlKemPublicKey,
              },
            ]
          : []),
      ],
      authentication: [`${targetDid}#key-1`],
    };

    // Tenta extrair a chave pública ML-DSA para verificação de assinaturas
    let extractedMldsaPubKey = mlDsaPublicKey || "";

    if (!extractedMldsaPubKey && finalDidDocument && typeof finalDidDocument === "object") {
      if (Array.isArray((finalDidDocument as any).keys)) {
        const k = ((finalDidDocument as any).keys as any[]).find(
          (key) =>
            key.type === "ML-DSA-65" ||
            key.type === "ML-DSA" ||
            key.id?.includes("mldsa")
        );
        if (k?.public_key_multibase || k?.publicKeyMultibase) {
          extractedMldsaPubKey = k.public_key_multibase || k.publicKeyMultibase;
        }
      }

      if (!extractedMldsaPubKey && Array.isArray((finalDidDocument as any).verificationMethod)) {
        const vm = ((finalDidDocument as any).verificationMethod as any[]).find(
          (m) =>
            m.type === "ML-DSA" ||
            m.type === "ML-DSA-65" ||
            m.id?.includes("mldsa")
        );
        if (vm?.publicKeyMultibase || vm?.public_key_multibase) {
          extractedMldsaPubKey = vm.publicKeyMultibase || vm.public_key_multibase;
        }
      }
    }

    // Tenta extrair a chave pública ML-KEM para armazenar na coluna didMlkemKey (usada para cifragem)
    let extractedMlkemPubKey = mlKemPublicKey || "";

    if (!extractedMlkemPubKey && finalDidDocument && typeof finalDidDocument === "object") {
      if (Array.isArray((finalDidDocument as any).keys)) {
        const k = ((finalDidDocument as any).keys as any[]).find(
          (key) =>
            key.type === "ML-KEM-768" ||
            key.type === "ML-KEM-512" ||
            key.type === "ML-KEM-1024" ||
            key.type === "ML-KEM" ||
            key.id?.includes("mlkem")
        );
        if (k?.public_key_multibase || k?.publicKeyMultibase) {
          extractedMlkemPubKey = k.public_key_multibase || k.publicKeyMultibase;
        }
      }

      if (!extractedMlkemPubKey && Array.isArray((finalDidDocument as any).verificationMethod)) {
        const vm = ((finalDidDocument as any).verificationMethod as any[]).find(
          (m) =>
            m.type === "ML-KEM" ||
            m.type === "ML-KEM-768" ||
            m.type === "ML-KEM-512" ||
            m.type === "ML-KEM-1024" ||
            m.id?.includes("mlkem")
        );
        if (vm?.publicKeyMultibase || vm?.public_key_multibase) {
          extractedMlkemPubKey = vm.publicKeyMultibase || vm.public_key_multibase;
        }
      }
    }

    // 10. Validação Criptográfica do DID Document se contiver estrutura completa
    if (didDocument && typeof didDocument === "object") {
      try {
        const isDidDocValid = verifyDidDocument(didDocument);
        if (!isDidDocValid) {
          return NextResponse.json(
            { error: "Invalid DID Document cryptographic structure or key mismatch" },
            { status: 400 }
          );
        }
      } catch (err) {
        console.warn("[POST /complete] Warning during DID Document verification:", err);
      }
    }

    // 11. Validação Criptográfica da Prova ML-DSA se o proofValue foi enviado
    if (proof?.proofValue && extractedMldsaPubKey) {
      const challengePayload = {
        pairingId: challenge.pairingId,
        nonce: challenge.nonce,
        expiresAt: challenge.expiresAt.toISOString(),
        did: targetDid,
      };

      const isProofValid = verifyPairingChallengeProof({
        challengeData: challengePayload,
        signature: proof.proofValue,
        publicKey: extractedMldsaPubKey,
        context: "did-pairing-challenge",
      });

      if (!isProofValid) {
        return NextResponse.json(
          { error: "Invalid cryptographic proof signature" },
          { status: 400 }
        );
      }
    }

    const pairedAt = new Date();

    // 12. Transação atômica para concluir o pareamento gravando DID e ambas as chaves (ML-DSA e ML-KEM)
    const result = await prisma.$transaction(async (tx) => {
      await tx.didPairingChallenge.update({
        where: { id: challenge.id },
        data: {
          status: DidPairingStatus.COMPLETED,
          usedAt: pairedAt,
        },
      });

      const updatedUser = await tx.user.update({
        where: { id: targetUserId },
        data: {
          did: targetDid,
          didPublicKey: extractedMldsaPubKey || null,
          didMlkemKey: extractedMlkemPubKey || null,
          didDocument: finalDidDocument as any,
          didPairedAt: pairedAt,
        },
        select: {
          did: true,
          didPublicKey: true,
          didMlkemKey: true,
          didPairedAt: true,
        },
      });

      return updatedUser;
    });

    return NextResponse.json(
      {
        paired: true,
        did: result.did,
        status: "ACTIVE",
        pairedAt: result.didPairedAt?.toISOString() || pairedAt.toISOString(),
      },
      { status: 200 }
    );
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code: string }).code === "P2002"
    ) {
      return NextResponse.json(
        { error: "This DID is already registered to another account" },
        { status: 409 }
      );
    }

    console.error("[POST /api/v1/did-pairings/[pairingId]/complete] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
