import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

// POST /api/dids
// Registra a DID e a chave pública do usuário logado.
// Permitido apenas uma vez — re-registrar retorna 409 Conflict.
export async function POST(request: NextRequest) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { did, publicKey } = body as {
    did?: unknown;
    publicKey?: unknown;
  };

  // Validação dos dois campos obrigatórios
  if (typeof did !== "string" || did.trim().length === 0) {
    return NextResponse.json(
      { error: "Missing or invalid field: did" },
      { status: 400 }
    );
  }

  if (typeof publicKey !== "string" || publicKey.trim().length === 0) {
    return NextResponse.json(
      { error: "Missing or invalid field: publicKey" },
      { status: 400 }
    );
  }

  // Validação de formato básico — DIDs devem começar com "did:"
  // conforme a especificação W3C DID Core (https://www.w3.org/TR/did-core/)
  if (!did.startsWith("did:")) {
    return NextResponse.json(
      { error: "Invalid DID format: must start with 'did:'" },
      { status: 400 }
    );
  }

  // Verifica se o usuário já registrou uma DID anteriormente.
  // Nesta fase do MVP, não permitimos troca de DID.
  const existingUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { did: true },
  });

  if (existingUser?.did) {
    return NextResponse.json(
      {
        error: "DID already registered",
        details:
          "This account already has a DID. Re-registration is not allowed in the current version.",
      },
      { status: 409 }
    );
  }

  try {
    const updated = await prisma.user.update({
      where: { id: session.user.id },
      data: {
        did: did.trim(),
        didPublicKey: publicKey.trim(),
      },
      select: {
        id: true,
        did: true,
        updatedAt: true,
      },
    });

    // O contrato usa "registeredAt" — como não temos esse campo
    // no banco, usamos updatedAt que acaba de ser atualizado.
    return NextResponse.json(
      {
        id: updated.id,
        did: updated.did,
        registeredAt: updated.updatedAt.toISOString(),
      },
      { status: 201 }
    );
  } catch (error) {
    // P2002 = violação de constraint unique — outra conta já
    // registrou esse mesmo DID ou essa mesma chave pública.
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

    console.error("[POST /api/dids] Unexpected error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}