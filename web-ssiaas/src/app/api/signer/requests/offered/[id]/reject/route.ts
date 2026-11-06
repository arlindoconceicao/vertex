import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSsiPqCore } from "@/lib/ssi-pq";
import { validateSignerToken } from "@/lib/signer-auth";

/**
 * POST /api/signer/requests/offered/[id]/reject
 *
 * Consumido pelo aplicativo móvel do Titular (Holder).
 * Rejeita uma credencial oferecida com status OFFERED, transacionando-a para REJECTED.
 *
 * Autenticação: M2M via Prova de Posse (ML-DSA) + Bearer Token (HMAC-SHA256).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const authCredentialBase64 = request.headers.get("x-signer-auth-credential");

  if (!authCredentialBase64) {
    return NextResponse.json(
      { error: "Missing required authentication header (x-signer-auth-credential)" },
      { status: 401 }
    );
  }

  try {
    const authCredentialJson = Buffer.from(authCredentialBase64, "base64").toString("utf-8");
    const authCredential = JSON.parse(authCredentialJson);

    if (!authCredential?.credential?.issuer_did) {
      return NextResponse.json({ error: "Invalid credential structure" }, { status: 401 });
    }

    const signerDid = authCredential.credential.issuer_did;

    // 1. Validação do Token Bearer HMAC M2M
    const authHeader = request.headers.get("authorization");
    if (!validateSignerToken(authHeader, signerDid)) {
      return NextResponse.json({ error: "Invalid or missing Bearer token (M2M)" }, { status: 401 });
    }

    // 2. Busca do usuário pelo DID para obter o DID Document
    const user = await prisma.user.findUnique({
      where: { did: signerDid },
      select: { id: true, didDocument: true },
    });

    if (!user || !user.didDocument) {
      return NextResponse.json({ error: "Signer DID not found or has no didDocument" }, { status: 401 });
    }

    // 3. Verificação criptográfica da credencial de autenticação pós-quântica
    const core = getSsiPqCore();
    let isValid = false;
    try {
      isValid = core.verifySignedCredential(authCredential, user.didDocument as object);
    } catch (err) {
      console.warn("[POST /api/signer/requests/offered/[id]/reject] Verification error:", err);
    }

    if (!isValid) {
      return NextResponse.json({ error: "Invalid cryptographic credential signature" }, { status: 401 });
    }

    // 4. Validação de validade temporal e ação esperada
    const disclosures = authCredential.attribute_disclosures || [];
    const timestampDisclosure = disclosures.find((d: any) => d.path === "subject.timestamp");
    const actionDisclosure = disclosures.find((d: any) => d.path === "subject.action");

    const validActions = [
      "reject_credential_auth",
      "accept_credential_auth",
      "offered_requests_auth",
      "reject_offered_auth",
    ];
    if (
      !timestampDisclosure ||
      !actionDisclosure ||
      !validActions.includes(actionDisclosure.value)
    ) {
      return NextResponse.json({ error: "Invalid auth credential action payload" }, { status: 401 });
    }

    const reqTime = new Date(timestampDisclosure.value).getTime();
    const now = Date.now();
    const diffMinutes = Math.abs(now - reqTime) / (1000 * 60);

    if (isNaN(reqTime) || diffMinutes > 2) {
      return NextResponse.json({ error: "Invalid or expired timestamp" }, { status: 401 });
    }

    // 5. Busca e validação da credencial
    const credential = await prisma.verifiableCredential.findUnique({
      where: { id },
      include: {
        holder: { select: { did: true, email: true } },
      },
    });

    if (!credential) {
      return NextResponse.json({ error: "Credential not found" }, { status: 404 });
    }

    if (credential.holder.did !== signerDid) {
      return NextResponse.json(
        { error: "Forbidden: Credential does not belong to this holder" },
        { status: 403 }
      );
    }

    if (credential.status !== "OFFERED") {
      return NextResponse.json(
        { error: `Credential is not in OFFERED status (current: ${credential.status})` },
        { status: 400 }
      );
    }

    // 6. Atualização de status para REJECTED
    const updated = await prisma.verifiableCredential.update({
      where: { id },
      data: {
        status: "REJECTED",
      },
      select: {
        id: true,
        status: true,
        batchId: true,
      },
    });

    return NextResponse.json(
      {
        success: true,
        message: "Credential rejected successfully and moved to REJECTED.",
        credential: updated,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[POST /api/signer/requests/offered/[id]/reject] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
