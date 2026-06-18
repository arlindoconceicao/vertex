import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Prisma, SchemaVisibility } from "@prisma/client";

// No Next.js 15 com App Router, os parâmetros de rota dinâmica
// são entregues como uma Promise — por isso o tipo abaixo é assíncrono.
type RouteContext = { params: Promise<{ id: string }> };

// Campos retornados tanto no GET quanto no PATCH — espelha exatamente
// o contrato de resposta documentado em docs/api-architecture.md.
const SCHEMA_DETAIL_SELECT = {
  id: true,
  name: true,
  description: true,
  version: true,
  visibility: true,
  storageLocation: true,
  ipfsCid: true,
  publishedAt: true,
  jsonSchema: true,
  creator: {
    select: { id: true, name: true },
  },
} satisfies Prisma.CredentialSchemaSelect;

// GET /api/schemas/:id
// Retorna os detalhes completos de um único schema.
export async function GET(request: NextRequest, { params }: RouteContext) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const schema = await prisma.credentialSchema.findUnique({
      where: { id },
      select: SCHEMA_DETAIL_SELECT,
    });

    if (!schema) {
      return NextResponse.json({ error: "Schema not found" }, { status: 404 });
    }

    // Regra de privacidade: schemas PRIVATE só podem ser vistos pelo criador.
    // Retornamos 404 em vez de 403 propositalmente — não queremos revelar
    // para terceiros que um schema privado existe.
    if (
      schema.visibility === SchemaVisibility.PRIVATE &&
      schema.creator.id !== session.user.id
    ) {
      return NextResponse.json({ error: "Schema not found" }, { status: 404 });
    }

    return NextResponse.json(schema, { status: 200 });
  } catch (error) {
    console.error("[GET /api/schemas/:id] Unexpected error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// PATCH /api/schemas/:id
// Edição parcial de um schema.
// Campos de conteúdo (name, description, jsonSchema) são imutáveis
// após a publicação. O campo visibility pode ser trocado a qualquer momento.
// ============================================================
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  // Buscamos apenas os campos necessários para as validações de segurança,
  // antes de processar o body — evita trabalho desnecessário se falhar aqui.
  const existing = await prisma.credentialSchema.findUnique({
    where: { id },
    select: { creatorId: true, publishedAt: true },
  });

  if (!existing) {
    return NextResponse.json({ error: "Schema not found" }, { status: 404 });
  }

  // Segurança crítica: apenas o criador pode editar o próprio schema.
  if (existing.creatorId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { name, description, jsonSchema, visibility } = body as {
    name?: unknown;
    description?: unknown;
    jsonSchema?: unknown;
    visibility?: unknown;
  };

  const isPublished = existing.publishedAt !== null;

  // Regra de imutabilidade: name, description e jsonSchema só podem ser
  // alterados enquanto o schema ainda não foi publicado no IPFS.
  const hasMutableFieldChange =
    name !== undefined ||
    description !== undefined ||
    jsonSchema !== undefined;

  if (isPublished && hasMutableFieldChange) {
    return NextResponse.json(
      {
        error: "Cannot edit a published schema",
        details:
          "Fields 'name', 'description' and 'jsonSchema' are immutable after publishing. Only 'visibility' can be changed.",
      },
      { status: 400 }
    );
  }

  // Valida o valor de visibility caso tenha sido fornecido.
  if (
    visibility !== undefined &&
    !Object.values(SchemaVisibility).includes(visibility as SchemaVisibility)
  ) {
    return NextResponse.json(
      {
        error: "Invalid visibility value",
        allowed: Object.values(SchemaVisibility),
      },
      { status: 400 }
    );
  }

  // Monta o objeto de atualização apenas com os campos realmente enviados —
  // campos ausentes no body não são alterados no banco (PATCH semântico).
  const updateData: Prisma.CredentialSchemaUpdateInput = {};

  if (name !== undefined) {
    if (typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json({ error: "Invalid name" }, { status: 400 });
    }
    updateData.name = name.trim();
  }

  if (description !== undefined) {
    if (typeof description !== "string" || description.trim().length === 0) {
      return NextResponse.json(
        { error: "Invalid description" },
        { status: 400 }
      );
    }
    updateData.description = description.trim();
  }

  if (jsonSchema !== undefined) {
    if (
      typeof jsonSchema !== "object" ||
      jsonSchema === null ||
      Array.isArray(jsonSchema)
    ) {
      return NextResponse.json(
        { error: "Invalid jsonSchema: must be a JSON object" },
        { status: 400 }
      );
    }
    updateData.jsonSchema = jsonSchema as Prisma.InputJsonValue;
  }

  if (visibility !== undefined) {
    updateData.visibility = visibility as SchemaVisibility;
  }

  // Protege contra um body completamente vazio ou sem campos reconhecidos.
  if (Object.keys(updateData).length === 0) {
    return NextResponse.json(
      {
        error: "No valid fields to update",
        allowed: ["name", "description", "jsonSchema", "visibility"],
      },
      { status: 400 }
    );
  }

  try {
    const updated = await prisma.credentialSchema.update({
      where: { id },
      data: updateData,
      select: SCHEMA_DETAIL_SELECT,
    });

    return NextResponse.json(updated, { status: 200 });
  } catch (error) {
    console.error("[PATCH /api/schemas/:id] Unexpected error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}