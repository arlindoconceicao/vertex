// src/app/api/credentials/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { VCStatus, Prisma } from "@prisma/client";

// ============================================================
// GET /api/credentials
// Lista credenciais do usuário logado, filtrando por papel e status.
// O campo schemaSnapshot é extraído de dentro do vcPayload
// em memória, pois não há relação no banco (desacoplamento).
// ============================================================
export async function GET(request: NextRequest) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const role = searchParams.get("role");
  const statusParam = searchParams.get("status");

  // Valida o parâmetro role — aceita apenas "issued" e "received"
  if (role !== null && role !== "issued" && role !== "received") {
    return NextResponse.json(
      { error: "Invalid role: must be 'issued' or 'received'" },
      { status: 400 }
    );
  }

  // Valida o parâmetro status contra o enum do Prisma
  if (
    statusParam !== null &&
    !Object.values(VCStatus).includes(statusParam as VCStatus)
  ) {
    return NextResponse.json(
      { error: "Invalid status value", allowed: Object.values(VCStatus) },
      { status: 400 }
    );
  }

  const status = statusParam as VCStatus | null;

  // Monta o filtro de papel. Se nenhum role for informado,
  // retornamos todas onde o usuário é issuer OU holder.
  let roleFilter: Prisma.VerifiableCredentialWhereInput;

  if (role === "issued") {
    roleFilter = { issuerId: session.user.id };
  } else if (role === "received") {
    roleFilter = { holderId: session.user.id };
  } else {
    roleFilter = {
      OR: [
        { issuerId: session.user.id },
        { holderId: session.user.id },
      ],
    };
  }

  const where: Prisma.VerifiableCredentialWhereInput = {
    ...roleFilter,
    ...(status ? { status } : {}),
  };

  try {
    const credentials = await prisma.verifiableCredential.findMany({
      where,
      select: {
        id: true,
        status: true,
        issuedAt: true,
        expiresAt: true,
        vcPayload: true,
        issuer: { select: { id: true, name: true, email: true } },
        holder: { select: { id: true, name: true, email: true } },
      },
      orderBy: { issuedAt: "desc" },
    });

    // Mapeia para o formato do contrato, extraindo schemaSnapshot
    // de dentro do vcPayload em vez de fazer JOIN no banco.
    const response = credentials.map((vc) => {
      const payload = vc.vcPayload as Record<string, unknown>;
      const schemaSnapshot = payload.credentialSchema ?? null;

      return {
        id: vc.id,
        status: vc.status,
        issuedAt: vc.issuedAt.toISOString(),
        expiresAt: vc.expiresAt?.toISOString() ?? null,
        issuer: vc.issuer,
        holder: vc.holder,
        schemaSnapshot,
      };
    });

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error("[GET /api/credentials] Unexpected error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// POST /api/credentials
// Inicia a emissão de uma Credencial Verificável.
// Monta o payload W3C/JSON-LD não-assinado, salva como VC com
// status PENDING no banco e retorna 202 Accepted.
//
// Sem a tabela SigningRequest, usamos o próprio
// registro de VerifiableCredential para armazenar o payload
// não-assinado. O id gerado funciona como signingRequestId.
// Na Sprint futura, o Mobile Signer consumirá esse registro,
// assinará o payload e chamará o callback para finalizá-lo.
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

  const { schemaId, holderEmail, expiresAt, credentialSubject } = body as {
    schemaId?: unknown;
    holderEmail?: unknown;
    expiresAt?: unknown;
    credentialSubject?: unknown;
  };

  if (typeof schemaId !== "string" || schemaId.trim().length === 0) {
    return NextResponse.json(
      { error: "Missing or invalid field: schemaId" },
      { status: 400 }
    );
  }

  if (typeof holderEmail !== "string" || holderEmail.trim().length === 0) {
    return NextResponse.json(
      { error: "Missing or invalid field: holderEmail" },
      { status: 400 }
    );
  }

  if (
    typeof credentialSubject !== "object" ||
    credentialSubject === null ||
    Array.isArray(credentialSubject)
  ) {
    return NextResponse.json(
      { error: "Missing or invalid field: credentialSubject" },
      { status: 400 }
    );
  }

  let parsedExpiresAt: Date | null = null;

  if (expiresAt !== undefined) {
    const date = new Date(expiresAt as string);

    if (isNaN(date.getTime())) {
      return NextResponse.json(
        { error: "Invalid expiresAt: must be a valid ISO 8601 date" },
        { status: 400 }
      );
    }

    if (date <= new Date()) {
      return NextResponse.json(
        { error: "Invalid expiresAt: must be a future date" },
        { status: 400 }
      );
    }

    parsedExpiresAt = date;
  }

  const schema = await prisma.credentialSchema.findUnique({
    where: { id: schemaId },
    select: { id: true, name: true, version: true },
  });

  if (!schema) {
    return NextResponse.json({ error: "Schema not found" }, { status: 404 });
  }

  const issuer = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, did: true, name: true },
  });

  if (!issuer?.did) {
    return NextResponse.json(
      {
        error: "Issuer DID not registered",
        details:
          "You must register a Decentralized Identifier (DID) before issuing credentials. Use POST /api/dids to register.",
      },
      { status: 400 }
    );
  }

  const holder = await prisma.user.findUnique({
    where: { email: holderEmail.trim() },
    select: { id: true, did: true },
  });

  if (!holder) {
    return NextResponse.json(
      { error: "Holder not found: no user registered with this email" },
      { status: 404 }
    );
  }

  if (holder.id === session.user.id) {
    return NextResponse.json(
      { error: "Cannot issue a credential to yourself" },
      { status: 400 }
    );
  }

  const issuanceDate = new Date().toISOString();

  const credentialTypeName = schema.name
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");

  const unsignedPayload = {
    "@context": ["https://www.w3.org/2018/credentials/v1"],
    type: ["VerifiableCredential", credentialTypeName],
    issuer: issuer.did,
    issuanceDate,
    ...(parsedExpiresAt
      ? { expirationDate: parsedExpiresAt.toISOString() }
      : {}),
    credentialSchema: {
      id: schema.id,
      name: schema.name,
      version: schema.version,
    },
    credentialSubject: {
      id: holder.did ?? `urn:vertex:users:${holder.id}`,
      ...(credentialSubject as Record<string, unknown>),
    },
  };

  try {
    const credential = await prisma.verifiableCredential.create({
      data: {
        vcPayload: unsignedPayload,
        status: "PENDING",
        expiresAt: parsedExpiresAt,
        issuerId: issuer.id,
        holderId: holder.id,
      },
      select: { id: true },
    });

    return NextResponse.json(
      {
        signingRequestId: credential.id,
        status: "PENDING_SIGNATURE",
        unsignedPayload,
      },
      { status: 202 }
    );
  } catch (error) {
    console.error("[POST /api/credentials] Unexpected error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}