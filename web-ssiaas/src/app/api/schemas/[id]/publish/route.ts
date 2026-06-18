import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { StorageLocation } from "@prisma/client";

type RouteContext = { params: Promise<{ id: string }> };

// FUNÇÃO AUXILIAR: Gerador de CID fictício
//
// Um CID real do IPFS (versão 0) começa com "Qm" e é seguido
// de 44 caracteres no alfabeto Base58 — totalizando 46 caracteres.
// Esse alfabeto exclui 0, O, I e l para evitar ambiguidade visual.
//
// TODO Sprint 2: substituir por chamada real ao SDK do IPFS
// (ex: @helia/unixfs, Pinata, Infura IPFS ou nó próprio).
function generateMockIpfsCid(): string {
  const base58Alphabet =
    "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

  // Gera 44 caracteres aleatórios do alfabeto Base58
  let cid = "Qm";
  for (let i = 0; i < 44; i++) {
    cid += base58Alphabet[Math.floor(Math.random() * base58Alphabet.length)];
  }

  return cid;
}

// POST /api/schemas/:id/publish
// Publica um schema LOCAL no IPFS, tornando-o imutável.
// O corpo da requisição é ignorado (contrato define body vazio).
export async function POST(
  _request: NextRequest,
  { params }: RouteContext
) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  // Buscamos apenas os campos necessários para as validações —
  // evita trazer jsonSchema (potencialmente grande) antes de saber
  // se a operação será permitida.
  const existing = await prisma.credentialSchema.findUnique({
    where: { id },
    select: { creatorId: true, publishedAt: true },
  });

  if (!existing) {
    return NextResponse.json({ error: "Schema not found" }, { status: 404 });
  }

  // Apenas o criador pode publicar o próprio schema.
  if (existing.creatorId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Um schema já publicado é imutável — publicar novamente não faz sentido.
  // O usuário deve criar um novo schema se quiser alterar o conteúdo.
  if (existing.publishedAt !== null) {
    return NextResponse.json(
      {
        error: "Already published",
        details:
          "This schema is immutable and already pinned to IPFS. To make changes, create a new schema.",
      },
      { status: 400 }
    );
  }

  // Gera o CID antes de qualquer operação no banco — se a geração falhar
  // (na Sprint 2, uma chamada real ao IPFS), nada é persistido.
  const ipfsCid = generateMockIpfsCid();
  const publishedAt = new Date();

  try {
    const updated = await prisma.credentialSchema.update({
      where: { id },
      data: {
        ipfsCid,
        storageLocation: StorageLocation.IPFS,
        publishedAt,
      },
      // Retorna exatamente os campos documentados no api-architecture.md
      select: {
        id: true,
        ipfsCid: true,
        storageLocation: true,
        publishedAt: true,
      },
    });

    return NextResponse.json(updated, { status: 200 });
  } catch (error) {
    console.error("[POST /api/schemas/:id/publish] Unexpected error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}