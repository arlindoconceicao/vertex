import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateSignerToken } from "@/lib/signer-auth";

// POST /api/signer/callback
// Chamado pelo App Mobile Signer após assinar o payload.
//
// Fluxo:
//   1. Valida o token M2M
//   2. Verifica se a VC (requestId) existe e está PENDING
//   3. Substitui o vcPayload não-assinado pelo signedPayload
//   4. Mantém status PENDING (Holder ainda precisa aceitar)
//   5. Retorna 201 com credentialId e holderNotified: true
//
// Nota: o status permanece PENDING mesmo após a assinatura
// porque, conforme o contrato, o Holder ainda precisa aceitar
// a credencial via PATCH /api/credentials/:id/accept.
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");

  if (!validateSignerToken(authHeader)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Parse do body ──────────────────────────────────────────
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { requestId, signedPayload } = body as {
    requestId?: unknown;
    signedPayload?: unknown;
  };

  if (typeof requestId !== "string" || requestId.trim().length === 0) {
    return NextResponse.json(
      { error: "Missing or invalid field: requestId" },
      { status: 400 }
    );
  }

  // O signedPayload deve ser um objeto JSON contendo o payload W3C
  // completo, agora incluindo o campo "proof" com a assinatura.
  if (
    typeof signedPayload !== "object" ||
    signedPayload === null ||
    Array.isArray(signedPayload)
  ) {
    return NextResponse.json(
      { error: "Missing or invalid field: signedPayload" },
      { status: 400 }
    );
  }

  // Validação mínima: o payload assinado DEVE conter o campo "proof".
  // Sem ele, a credencial não tem valor criptográfico e não pode
  // ser verificada por terceiros.
  const payload = signedPayload as Record<string, unknown>;

  if (!payload.proof || typeof payload.proof !== "object") {
    return NextResponse.json(
      {
        error: "Invalid signedPayload: missing 'proof' field",
        details:
          "The signed payload must contain a 'proof' object with the cryptographic signature.",
      },
      { status: 400 }
    );
  }

  // ── Busca e validação da VC ────────────────────────────────
  const credential = await prisma.verifiableCredential.findUnique({
    where: { id: requestId },
    select: { id: true, status: true, holderId: true },
  });

  // Retornamos 404 tanto para "não existe" quanto para "já foi
  // processado" — não revelamos detalhes sobre registros que o
  // Signer não deveria conhecer.
  if (!credential) {
    return NextResponse.json(
      { error: "Signing request not found" },
      { status: 404 }
    );
  }

  // Se o status não é PENDING, a credencial já foi assinada
  // anteriormente ou foi revogada — impede reprocessamento.
  if (credential.status !== "PENDING") {
    return NextResponse.json(
      {
        error: "Request already processed",
        currentStatus: credential.status,
      },
      { status: 409 }
    );
  }

  // ── Atualização no banco ───────────────────────────────────
  try {
    // Substitui o payload não-assinado pelo assinado.
    // O status permanece PENDING — conforme a documentação,
    // o Holder ainda precisa aceitar.
    await prisma.verifiableCredential.update({
      where: { id: requestId },
      data: {
        vcPayload: signedPayload as object,
      },
    });

    // TODO Sprint futura: disparar e-mail real para o Holder
    // usando notifyNewCredential() do emailService.
    // Por enquanto, logamos e retornamos holderNotified: true.
    console.log(
      `[POST /api/signer/callback] Credential ${requestId} signed. Holder ${credential.holderId} would be notified.`
    );

    return NextResponse.json(
      {
        credentialId: requestId,
        status: "PENDING",
        holderNotified: true,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("[POST /api/signer/callback] Unexpected error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}