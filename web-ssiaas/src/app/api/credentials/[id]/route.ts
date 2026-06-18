import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/credentials/:id
// Retorna os detalhes completos de uma credencial, incluindo
// o payload W3C/JSON-LD inteiro.
//
// Regra de privacidade: apenas o Issuer ou o Holder daquela
// credencial específica podem acessá-la.
export async function GET(
  _request: NextRequest,
  { params }: RouteContext
) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const credential = await prisma.verifiableCredential.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        issuedAt: true,
        expiresAt: true,
        vcPayload: true,
        issuerId: true,
        holderId: true,
      },
    });

    if (!credential) {
      return NextResponse.json(
        { error: "Credential not found" },
        { status: 404 }
      );
    }

    // Apenas as duas partes envolvidas podem ver a credencial.
    // Retornamos 403 aqui (diferente do 404 que usamos em schemas
    // privados) porque o contexto é diferente: o usuário já sabe
    // que o recurso existe (ele tem o ID), esconder isso com 404
    // não agregaria segurança.
    const isIssuer = credential.issuerId === session.user.id;
    const isHolder = credential.holderId === session.user.id;

    if (!isIssuer && !isHolder) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    return NextResponse.json(
      {
        id: credential.id,
        status: credential.status,
        issuedAt: credential.issuedAt.toISOString(),
        expiresAt: credential.expiresAt?.toISOString() ?? null,
        vcPayload: credential.vcPayload,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[GET /api/credentials/:id] Unexpected error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}