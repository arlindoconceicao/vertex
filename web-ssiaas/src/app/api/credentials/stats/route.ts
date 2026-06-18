import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { VCStatus } from "@prisma/client";

// Tipo que representa a estrutura de contagem por status,
// espelhando o contrato do api-architecture.md.
type StatusBreakdown = Record<VCStatus, number>;

// Inicializa o objeto com todos os status em zero —
// garante que o JSON de retorno sempre contém as três chaves,
// mesmo que o banco não tenha nenhuma VC daquele status.
function emptyBreakdown(): StatusBreakdown {
  return { PENDING: 0, ACTIVE: 0, REVOKED: 0 };
}

// GET /api/credentials/stats
// Retorna o balanço de credenciais do usuário logado,
// dividido por papel (issuer / holder) e por status.
//
// Executamos duas queries groupBy em paralelo para calcular
// tudo em uma única ida ao banco (uma para emitidas, outra
// para recebidas). O groupBy do Prisma gera um SQL eficiente
// com COUNT + GROUP BY, sem trazer os registros individuais.
export async function GET() {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Dispara as duas queries ao mesmo tempo — não faz sentido
    // esperar uma terminar para só então começar a outra.
    const [issuedGroups, receivedGroups] = await Promise.all([
      prisma.verifiableCredential.groupBy({
        by: ["status"],
        where: { issuerId: session.user.id },
        _count: { _all: true },
      }),
      prisma.verifiableCredential.groupBy({
        by: ["status"],
        where: { holderId: session.user.id },
        _count: { _all: true },
      }),
    ]);

    // Converte o resultado do groupBy para o formato do contrato.
    // O Prisma retorna um array de objetos:
    //   [{ status: "ACTIVE", _count: { _all: 5 } }, ...]
    // Precisamos transformar em:
    //   { PENDING: 0, ACTIVE: 5, REVOKED: 0 }
    const issuedByStatus = emptyBreakdown();
    let issuedCount = 0;

    for (const group of issuedGroups) {
      issuedByStatus[group.status] = group._count._all;
      issuedCount += group._count._all;
    }

    const receivedByStatus = emptyBreakdown();
    let receivedCount = 0;

    for (const group of receivedGroups) {
      receivedByStatus[group.status] = group._count._all;
      receivedCount += group._count._all;
    }

    return NextResponse.json(
      {
        issuedCount,
        receivedCount,
        issuedByStatus,
        receivedByStatus,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[GET /api/credentials/stats] Unexpected error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}