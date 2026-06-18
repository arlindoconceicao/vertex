import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

type RouteContext = { params: Promise<{ id: string }> };

// PATCH /api/credentials/:id/revoke
// Chamado pelo Issuer para revogar uma credencial ativa.
// Transição de status: ACTIVE → REVOKED.
//
// Regras:
//   - Apenas o issuerId pode revogar
//   - A credencial precisa estar com status ACTIVE
export async function PATCH(
  request: NextRequest,
  { params }: RouteContext
) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  // Lemos o body para capturar o motivo da revogação.
  // O campo "reason" não é salvo no banco nesta versão do MVP,
  // mas é logado para auditoria e retornado na resposta.
  let reason: string | undefined;

  try {
    const body = await request.json();
    reason = typeof body.reason === "string" ? body.reason : undefined;
  } catch {
    // Body vazio é aceitável — o motivo é opcional.
  }

  const credential = await prisma.verifiableCredential.findUnique({
    where: { id },
    select: { id: true, status: true, issuerId: true },
  });

  if (!credential) {
    return NextResponse.json(
      { error: "Credential not found" },
      { status: 404 }
    );
  }

  // Apenas quem emitiu pode revogar — o Holder não tem esse poder.
  if (credential.issuerId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Só é possível revogar credenciais ativas.
  // PENDING → ainda não foi aceita (pode ser cancelada de outra forma);
  // REVOKED → já foi revogada.
  if (credential.status !== "ACTIVE") {
    return NextResponse.json(
      {
        error: "Cannot revoke credential",
        details: `Current status is '${credential.status}'. Only credentials with status 'ACTIVE' can be revoked.`,
      },
      { status: 400 }
    );
  }

  try {
    await prisma.verifiableCredential.update({
      where: { id },
      data: { status: "REVOKED" },
    });

    // Log de auditoria — útil para rastreamento mesmo sem campo no banco.
    console.log(
      `[PATCH /api/credentials/:id/revoke] Credential ${id} revoked.`,
      reason ? `Reason: "${reason}"` : "No reason provided."
    );

    return NextResponse.json(
      { id: credential.id, status: "REVOKED" },
      { status: 200 }
    );
  } catch (error) {
    console.error(
      "[PATCH /api/credentials/:id/revoke] Unexpected error:",
      error
    );
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}