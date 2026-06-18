import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateSignerToken } from "@/lib/signer-auth";

// GET /api/signer/requests/pending
// Consumido pelo App Mobile Signer via polling.
// Retorna todas as VCs com status PENDING aguardando assinatura.
//
// Autenticação: Bearer token (M2M), não Auth.js.
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");

  if (!validateSignerToken(authHeader)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Buscamos todas as VCs pendentes — o Signer decidirá quais assinar.
    // Incluímos os dados do issuer para o app mobile exibir quem está
    // solicitando a assinatura e qual DID será usada.
    const pendingCredentials = await prisma.verifiableCredential.findMany({
      where: { status: "PENDING" },
      select: {
        id: true,
        issuedAt: true,
        vcPayload: true,
        issuer: {
          select: { did: true, name: true },
        },
      },
      orderBy: { issuedAt: "asc" },
    });

    // Mapeia para o formato exato do contrato em api-architecture.md.
    // O campo "requestId" é o id da VC (hack do MVP sem tabela SigningRequest).
    // O "unsignedPayload" é extraído de vcPayload, que armazenamos na etapa
    // anterior (POST /api/credentials).
    const response = pendingCredentials.map((vc) => ({
      requestId: vc.id,
      createdAt: vc.issuedAt.toISOString(),
      issuer: {
        did: vc.issuer.did,
        name: vc.issuer.name,
      },
      unsignedPayload: vc.vcPayload,
    }));

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error(
      "[GET /api/signer/requests/pending] Unexpected error:",
      error
    );
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}