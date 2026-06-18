import { NextRequest, NextResponse } from "next/server";

// POST /api/verifier/verify
// Verifica uma Credencial Verificável assinada.
//
// Endpoint público — não exige Auth.js. Qualquer parte externa
// pode submeter um payload para verificação, pois esse é o
// propósito do papel de Verifier no triângulo SSI.
//
// Nesta versão do MVP, sem bibliotecas criptográficas pesadas,
// realizamos uma validação estrutural simulada:
//   1. Verifica se o payload contém os campos W3C obrigatórios
//   2. Verifica se existe o campo "proof"
//   3. Verifica se a credencial não está expirada
//
// TODO Sprint futura:
//   - Resolver a DID do issuer via GET /api/dids/:id
//   - Buscar a chave pública do DID Document
//   - Validar a assinatura criptográfica com Ed25519
export async function POST(request: NextRequest) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { vcPayload } = body as { vcPayload?: unknown };

  if (
    typeof vcPayload !== "object" ||
    vcPayload === null ||
    Array.isArray(vcPayload)
  ) {
    return NextResponse.json(
      { error: "Missing or invalid field: vcPayload" },
      { status: 400 }
    );
  }

  const payload = vcPayload as Record<string, unknown>;
  const errors: string[] = [];

  // ── Verificação 1: Campos W3C obrigatórios ─────────────────
  // Conforme a especificação W3C Verifiable Credentials Data Model,
  // estes campos são obrigatórios em qualquer VC válida.
  const requiredFields = [
    "@context",
    "type",
    "issuer",
    "issuanceDate",
    "credentialSubject",
  ];

  for (const field of requiredFields) {
    if (!(field in payload)) {
      errors.push(`Missing required W3C field: '${field}'`);
    }
  }

  // Valida que @context contém o contexto base do W3C
  if (Array.isArray(payload["@context"])) {
    const baseContext = "https://www.w3.org/2018/credentials/v1";
    if (!payload["@context"].includes(baseContext)) {
      errors.push(
        `Invalid @context: must include '${baseContext}'`
      );
    }
  }

  // Valida que type contém "VerifiableCredential"
  if (Array.isArray(payload.type)) {
    if (!payload.type.includes("VerifiableCredential")) {
      errors.push("Invalid type: must include 'VerifiableCredential'");
    }
  }

  // ── Verificação 2: Campo proof ─────────────────────────────
  // O proof é onde a assinatura criptográfica vive.
  // Sem ele, a credencial não tem valor de verificação.
  if (!payload.proof || typeof payload.proof !== "object") {
    errors.push("Missing or invalid 'proof' field: credential is unsigned");
  } else {
    const proof = payload.proof as Record<string, unknown>;

    // Subcampos mínimos esperados dentro do proof
    if (typeof proof.type !== "string") {
      errors.push("Missing 'proof.type': must specify the signature algorithm");
    }

    if (typeof proof.proofValue !== "string") {
      errors.push("Missing 'proof.proofValue': must contain the signature");
    }

    if (typeof proof.verificationMethod !== "string") {
      errors.push(
        "Missing 'proof.verificationMethod': must reference the signer's key"
      );
    }

    // TODO Sprint futura: resolver a DID em proof.verificationMethod,
    // buscar a chave pública e verificar a assinatura real com Ed25519.
    // Por enquanto, se os campos existem, consideramos a assinatura
    // "estruturalmente presente" (mas não criptograficamente validada).
  }

  // ── Verificação 3: Expiração ───────────────────────────────
  if (typeof payload.expirationDate === "string") {
    const expiration = new Date(payload.expirationDate);

    if (isNaN(expiration.getTime())) {
      errors.push("Invalid 'expirationDate': not a valid ISO 8601 date");
    } else if (expiration <= new Date()) {
      errors.push("Credential has expired");
    }
  }

  // ── Resultado ──────────────────────────────────────────────
  const valid = errors.length === 0;

  return NextResponse.json({ valid, errors }, { status: 200 });
}