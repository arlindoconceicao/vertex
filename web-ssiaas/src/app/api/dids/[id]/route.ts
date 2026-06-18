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
      didPublicKey: true,
    },
  });

  // Retornamos 404 em duas situações: usuário não existe,
  // ou o usuário existe mas não registrou DID/chave pública.
  // Não diferenciamos os casos propositalmente — sem vazamento
  // de informação sobre quais IDs existem na plataforma.
  if (!user || !user.did || !user.didPublicKey) {
    return NextResponse.json(
      { error: "DID not found" },
      { status: 404 }
    );
  }

  // Monta o DID Document seguindo estritamente a especificação W3C
  // e o contrato do docs/api-architecture.md.
  // A chave de verificação recebe o sufixo "#key-1" por convenção —
  // suportamos apenas uma chave por DID nesta fase do MVP.
  const keyId = `${user.did}#key-1`;

  const didDocument = {
    "@context": ["https://www.w3.org/ns/did/v1"],
    id: user.did,
    verificationMethod: [
      {
        id: keyId,
        type: "Ed25519VerificationKey2020",
        controller: user.did,
        publicKeyMultibase: user.didPublicKey,
      },
    ],
    authentication: [keyId],
  };

  // O content-type ideal seria "application/did+ld+json" conforme
  // a spec W3C, mas usamos JSON padrão para simplicidade do MVP.
  return NextResponse.json(didDocument, { status: 200 });
}