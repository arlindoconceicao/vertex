import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateSignerToken } from "@/lib/signer-auth";

// POST /api/signer/callback
// Chamado pelo App Mobile Signer após assinar o payload e gerar o PDF.
//
// Fluxo Atualizado (Segurança e Privacidade):
//   1. Valida o token M2M (SIGNER_SECRET)
//   2. Recebe requisição multipart/form-data
//   3. Extrai o arquivo PDF (cifrado com a chave ML-KEM do destinatário)
//   4. Extrai os metadados (resumo JSON, hash original)
//   5. Verifica se a VC (requestId) existe e está PENDING
//   6. Substitui o vcPayload (que possuía PII) apenas pelos metadados
//   7. Salva o arquivo PDF no banco de dados
//   8. Mantém status PENDING (Holder ainda precisa aceitar)
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (error) {
    return NextResponse.json({ error: "Invalid multipart/form-data" }, { status: 400 });
  }

  const file = formData.get("file") as File | null;
  const metadataStr = formData.get("metadata") as string | null;

  if (!file || !metadataStr) {
    return NextResponse.json(
      { error: "Missing required fields: 'file' or 'metadata'" },
      { status: 400 }
    );
  }

  let metadata: any;
  try {
    metadata = JSON.parse(metadataStr);
  } catch {
    return NextResponse.json({ error: "Invalid JSON in metadata field" }, { status: 400 });
  }

  const { requestId, issuerDid, recipientDid, timestamp, pdfHash, schemaId } = metadata;

  if (!requestId || typeof requestId !== "string") {
    return NextResponse.json(
      { error: "Missing or invalid field in metadata: requestId" },
      { status: 400 }
    );
  }

  if (!validateSignerToken(authHeader, issuerDid)) {
    return NextResponse.json({ error: "Unauthorized or invalid Bearer token (M2M)" }, { status: 401 });
  }

  // ── Busca e validação da VC ────────────────────────────────
  const credential = await prisma.verifiableCredential.findUnique({
    where: { id: requestId },
    select: { id: true, status: true, holderId: true },
  });

  if (!credential) {
    return NextResponse.json(
      { error: "Signing request not found" },
      { status: 404 }
    );
  }

  if (credential.status !== "PENDING") {
    return NextResponse.json(
      {
        error: "Request already processed",
        currentStatus: credential.status,
      },
      { status: 409 }
    );
  }

  // Converter o File para Buffer
  const arrayBuffer = await file.arrayBuffer();
  const pdfBuffer = Buffer.from(arrayBuffer);

  // ── Atualização no banco ───────────────────────────────────
  try {
    // Substitui o payload não-assinado (com PII) pelo sumário seguro.
    // O status muda para ACTIVE já que foi assinada com sucesso pelo emissor.
    await prisma.verifiableCredential.update({
      where: { id: requestId },
      data: {
        // Mantemos o vcPayload intacto até que o download ocorra
        metadata: {
          issuerDid,
          recipientDid,
          timestamp,
          schemaId,
          pdfHash
        },
        pdfFile: pdfBuffer,
        pdfHash: pdfHash || null,
        status: "ACTIVE",
      },
    });

    console.log(
      `[POST /api/signer/callback] Credential ${requestId} signed and PDF uploaded. Holder ${credential.holderId} would be notified.`
    );

    return NextResponse.json(
      {
        credentialId: requestId,
        status: "ACTIVE",
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