import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSsiPqCore } from "@/lib/ssi-pq";
import { validateSignerToken } from "@/lib/signer-auth";

/**
 * POST /api/signer/requests/offered/batch-accept
 *
 * Consumido pelo aplicativo móvel do Titular (Holder).
 * Aceita múltiplas credenciais oferecidas de uma vez (por batchId ou lista de IDs),
 * movendo-as para PENDING para posterior assinatura do emissor.
 *
 * Payload JSON (opcional):
 *   { "batchId": "uuid-..." } ou { "credentialIds": ["id1", "id2"] }
 *   (Se nenhum filtro for enviado, aceita todas as ofertas do titular autenticado).
 *
 * Autenticação: M2M via Prova de Posse (ML-DSA) + Bearer Token (HMAC-SHA256).
 */
export async function POST(request: NextRequest) {
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
      console.warn("[POST /api/signer/requests/offered/batch-accept] Verification error:", err);
    }

    if (!isValid) {
      return NextResponse.json({ error: "Invalid cryptographic credential signature" }, { status: 401 });
    }

    // 4. Validação de validade temporal e ação esperada
    const disclosures = authCredential.attribute_disclosures || [];
    const timestampDisclosure = disclosures.find((d: any) => d.path === "subject.timestamp");
    const actionDisclosure = disclosures.find((d: any) => d.path === "subject.action");

    const validActions = [
      "accept_credential_auth",
      "offered_requests_auth",
      "batch_accept_auth",
      "accept_offered_auth",
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

    // Lê os filtros opcionais do corpo JSON
    let body: any = {};
    try {
      body = await request.json();
    } catch (_) {
      body = {};
    }

    const { batchId, credentialIds } = body;

    const whereClause: any = {
      status: "OFFERED",
      holder: { did: signerDid },
    };

    if (batchId) {
      whereClause.batchId = batchId;
    } else if (Array.isArray(credentialIds) && credentialIds.length > 0) {
      whereClause.id = { in: credentialIds };
    }

    const offeredToUpdate = await prisma.verifiableCredential.findMany({
      where: whereClause,
      select: { id: true },
    });

    if (offeredToUpdate.length === 0) {
      return NextResponse.json(
        {
          success: true,
          count: 0,
          message: "No OFFERED credentials matching criteria were found for this holder.",
        },
        { status: 200 }
      );
    }

    const idsToUpdate = offeredToUpdate.map((c) => c.id);

    const updateResult = await prisma.verifiableCredential.updateMany({
      where: {
        id: { in: idsToUpdate },
      },
      data: {
        status: "PENDING",
      },
    });

    return NextResponse.json(
      {
        success: true,
        count: updateResult.count,
        acceptedIds: idsToUpdate,
        message: `Successfully accepted ${updateResult.count} credentials into PENDING status.`,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[POST /api/signer/requests/offered/batch-accept] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
