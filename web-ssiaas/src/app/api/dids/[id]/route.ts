import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/dids/:id
// Resolve uma DID e retorna o W3C DID Document correspondente.
// O ":id" na URL é o ID interno do usuário na plataforma —
// usamos ele para buscar no banco e montar o documento.
//
// Qualquer usuário autenticado pode resolver qualquer DID,
// pois DID Documents são públicos por design no modelo SSI.
export async function GET(
  _request: NextRequest,
  { params }: RouteContext
) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      did: true,
      didDocument: true,
      didPublicKey: true,
    },
  });

  // Retornamos 404 em duas situações: usuário não existe,
  // ou o usuário existe mas não registrou DID/documento público.
  // Não diferenciamos os casos propositalmente — sem vazamento
  // de informação sobre quais IDs existem na plataforma.
  if (!user || !user.did) {
    return NextResponse.json(
      { error: "DID not found" },
      { status: 404 }
    );
  }

  const storedDidDocument = user.didDocument;

  const didDocument =
    storedDidDocument && typeof storedDidDocument === "object"
      ? storedDidDocument
      : {
          "@context": ["https://www.w3.org/ns/did/v1"],
          id: user.did,
          verificationMethod: [
            {
              id: `${user.did}#key-1`,
              type: "Ed25519VerificationKey2020",
              controller: user.did,
              publicKeyMultibase: user.didPublicKey,
            },
          ],
          authentication: [`${user.did}#key-1`],
        };

  // O content-type ideal seria "application/did+ld+json" conforme
  // a spec W3C, mas usamos JSON padrão para simplicidade do MVP.
  return NextResponse.json(didDocument, { status: 200 });
}