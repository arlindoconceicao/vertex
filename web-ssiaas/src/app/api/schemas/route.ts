import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Prisma, SchemaVisibility } from "@prisma/client";

// Campos retornados na listagem (GET) — espelha exatamente o contrato
// documentado em docs/api-architecture.md, seção "1. Schemas"
const SCHEMA_LIST_SELECT = {
  id: true,
  name: true,
  version: true,
  visibility: true,
  storageLocation: true,
  ipfsCid: true,
  publishedAt: true,
  createdAt: true,
} satisfies Prisma.CredentialSchemaSelect;


// GET /api/schemas
// Lista os schemas visíveis ao usuário logado.
export async function GET(request: NextRequest) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const mine = searchParams.get("mine") === "true";
  const visibilityParam = searchParams.get("visibility");

  // Valida o valor de "visibility" antes de usá-lo na query,
  // pois ele vem como string livre da URL.
  if (
    visibilityParam !== null &&
    !Object.values(SchemaVisibility).includes(
      visibilityParam as SchemaVisibility
    )
  ) {
    return NextResponse.json(
      { error: "Invalid visibility value" },
      { status: 400 }
    );
  }

  const visibility = visibilityParam as SchemaVisibility | null;

  // Monta o filtro do Prisma de acordo com a combinação de query params.
  // Regra de segurança: um usuário NUNCA pode ver o schema PRIVATE de outro.
  let where: Prisma.CredentialSchemaWhereInput;

  if (mine) {
    // "mine=true" → apenas os schemas criados pelo próprio usuário.
    // Se "visibility" também for informado, refina ainda mais o filtro.
    where = {
      creatorId: session.user.id,
      ...(visibility ? { visibility } : {}),
    };
  } else if (visibility === SchemaVisibility.PUBLIC) {
    // "visibility=PUBLIC" → schemas públicos da comunidade (de qualquer criador).
    where = { visibility: SchemaVisibility.PUBLIC };
  } else if (visibility === SchemaVisibility.PRIVATE) {
    // "visibility=PRIVATE" sem "mine" → por segurança, restringe sempre
    // aos PRIVATE do próprio usuário, nunca de terceiros.
    where = {
      visibility: SchemaVisibility.PRIVATE,
      creatorId: session.user.id,
    };
  } else {
    // Nenhum filtro informado → comportamento padrão da documentação:
    // schemas do próprio usuário + todos os PUBLIC da comunidade.
    where = {
      OR: [{ creatorId: session.user.id }, { visibility: SchemaVisibility.PUBLIC }],
    };
  }

  try {
    const schemas = await prisma.credentialSchema.findMany({
      where,
      select: SCHEMA_LIST_SELECT,
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(schemas, { status: 200 });
  } catch (error) {
    console.error("[GET /api/schemas] Unexpected error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}


// POST /api/schemas
// Cria um novo schema. Nasce sempre como PRIVATE.
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

  // Validação manual dos campos — sem biblioteca externa nesta etapa do MVP.
  const { name, description, jsonSchema } = body as {
    name?: unknown;
    description?: unknown;
    jsonSchema?: unknown;
  };

  const isValidName = typeof name === "string" && name.trim().length > 0;
  const isValidDescription =
    typeof description === "string" && description.trim().length > 0;
  const isValidJsonSchema =
    typeof jsonSchema === "object" &&
    jsonSchema !== null &&
    !Array.isArray(jsonSchema);

  if (!isValidName || !isValidDescription || !isValidJsonSchema) {
    return NextResponse.json(
      { error: "Missing fields", required: ["name", "description", "jsonSchema"] },
      { status: 400 }
    );
  }

  try {
    // visibility e storageLocation usam o default do schema.prisma
    // (PRIVATE e LOCAL, respectivamente) — não precisamos declará-los aqui.
    const schema = await prisma.credentialSchema.create({
      data: {
        name: name.trim(),
        description: description.trim(),
        jsonSchema: jsonSchema as Prisma.InputJsonValue,
        creatorId: session.user.id,
      },
      select: {
        id: true,
        name: true,
        version: true,
        visibility: true,
      },
    });

    return NextResponse.json(schema, { status: 201 });
  } catch (error) {
    console.error("[POST /api/schemas] Unexpected error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}