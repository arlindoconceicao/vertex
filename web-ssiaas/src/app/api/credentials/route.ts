import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

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

  // ── Validação dos campos obrigatórios ──────────────────────
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

  // Validação opcional de expiresAt — se informado, deve ser uma data futura.
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

  // ── Busca do Schema ────────────────────────────────────────
  const schema = await prisma.credentialSchema.findUnique({
    where: { id: schemaId },
    select: { id: true, name: true, version: true },
  });

  if (!schema) {
    return NextResponse.json({ error: "Schema not found" }, { status: 404 });
  }

  // ── Busca do Issuer (usuário logado) ───────────────────────
  // Precisamos da DID para compor o campo "issuer" do payload W3C.
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

  // ── Busca do Holder ────────────────────────────────────────
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

  // Proteção contra auto-emissão — o issuer não pode emitir para si mesmo.
  if (holder.id === session.user.id) {
    return NextResponse.json(
      { error: "Cannot issue a credential to yourself" },
      { status: 400 }
    );
  }

  // ── Montagem do Payload W3C/JSON-LD ────────────────────────
  // Segue estritamente o formato documentado no api-architecture.md.
  // O "credentialSchema" dentro do payload é um snapshot —
  // não há JOIN no banco para credenciais, conforme a decisão
  // de desacoplamento feita na última refatoração.
  const issuanceDate = new Date().toISOString();

  // O "type" secundário é derivado do nome do schema em PascalCase,
  // removendo espaços e caracteres especiais.
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
      // Se o holder já tiver uma DID registrada, usamos ela.
      // Caso contrário, usamos um identificador interno da plataforma.
      id: holder.did ?? `urn:vertex:users:${holder.id}`,
      ...(credentialSubject as Record<string, unknown>),
    },
  };

  // ── Persistência no banco ──────────────────────────────────
  // Hack do MVP: salvamos o payload não-assinado diretamente na
  // tabela VerifiableCredential com status PENDING.
  // O id gerado serve como signingRequestId para o Mobile Signer.
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

    // Retorno 202 — o processo começou mas não terminou.
    // A credencial só será finalizada quando o Mobile Signer
    // chamar POST /api/signer/callback com a assinatura.
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