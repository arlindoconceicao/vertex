import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

type RouteContext = { params: Promise<{ id: string }> };

// PATCH /api/credentials/:id/accept
// Chamado pelo Holder para aceitar uma credencial pendente.
// Transição de status: PENDING → ACTIVE.
//
// Regras:
//   - Apenas o holderId pode aceitar
//   - A credencial precisa estar com status PENDING
export async function PATCH(
  _request: NextRequest,
  { params }: RouteContext
) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const credential = await prisma.verifiableCredential.findUnique({
    where: { id },
    select: { id: true, status: true, holderId: true },
  });

  if (!credential) {
    return NextResponse.json(
      { error: "Credential not found" },
      { status: 404 }
    );
  }

  // Apenas o destinatário (Holder) pode aceitar a credencial.
  if (credential.holderId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Só é possível aceitar credenciais que estão pendentes.
  // ACTIVE → já foi aceita; REVOKED → foi cancelada pelo Issuer.
  if (credential.status !== "PENDING") {
    return NextResponse.json(
      {
        error: "Cannot accept credential",
        details: `Current status is '${credential.status}'. Only credentials with status 'PENDING' can be accepted.`,
      },
      { status: 400 }
    );
  }

  try {
    await prisma.verifiableCredential.update({
      where: { id },
      data: { status: "ACTIVE" },
    });

    return NextResponse.json(
      { id: credential.id, status: "ACTIVE" },
      { status: 200 }
    );
  } catch (error) {
    console.error(
      "[PATCH /api/credentials/:id/accept] Unexpected error:",
      error
    );
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}