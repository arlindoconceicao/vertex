import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

// GET /api/users/search?cpf=...
// Busca estrita por CPF exato. Retorna um array com 0 ou 1 resultado.
// O próprio usuário logado é sempre excluído da resposta.
export async function GET(request: NextRequest) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cpf = request.nextUrl.searchParams.get("cpf");

  // O CPF é obrigatório neste endpoint — diferente da busca antiga
  // por nome/email, aqui exigimos um identificador exato.
  if (!cpf) {
    return NextResponse.json(
      { error: "Missing required query parameter: cpf" },
      { status: 400 }
    );
  }

  // Remove formatação (pontos e traço) caso o frontend envie assim
  const cleanedCpf = cpf.replace(/\D/g, "");

  // Valida comprimento mínimo — rejeita buscas parciais
  if (cleanedCpf.length !== 11) {
    return NextResponse.json(
      { error: "Invalid CPF: must contain exactly 11 digits" },
      { status: 400 }
    );
  }

  try {
    // findFirst com exclusão do próprio usuário — busca exata pelo CPF.
    // Usamos findFirst em vez de findUnique porque adicionamos a condição
    // de exclusão do id (o Prisma exige que findUnique use apenas
    // campos @unique isolados, sem filtros adicionais em "AND").
    const user = await prisma.user.findFirst({
      where: {
        cpf: cleanedCpf,
        id: { not: session.user.id },
      },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        cpf: true,
      },
    });

    // Retorna sempre um array para consistência com o contrato —
    // o frontend pode iterar sem checar se é objeto ou array.
    const results = user ? [user] : [];

    return NextResponse.json(results, { status: 200 });
  } catch (error) {
    console.error("[GET /api/users/search] Unexpected error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}