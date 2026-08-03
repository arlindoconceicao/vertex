import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import type { DashboardCredential, CredentialStats } from "@/lib/types";
import CredentialTabs from "@/components/dashboard/CredentialTabs";
import StatsWidgets from "@/components/dashboard/StatsWidgets";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!session.user.cpf) redirect("/complete-registration");

  // Limpeza Pessoal: Aplica a preferência de retenção individual do usuário ativo (ex: 7 dias)
  const userPrefs = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { pdfRetentionDays: true }
  });

  if (userPrefs?.pdfRetentionDays) {
    const expirationThreshold = new Date();
    expirationThreshold.setDate(expirationThreshold.getDate() - userPrefs.pdfRetentionDays);

    await prisma.verifiableCredential.updateMany({
      where: {
        issuerId: session.user.id,
        pdfFile: { not: null },
        pdfDownloadedAt: {
          not: null,
          lt: expirationThreshold
        }
      },
      data: {
        pdfFile: null
      }
    });
  }

  // Busca paralela: credenciais emitidas, recebidas e métricas
  const [issuedRaw, receivedRaw, issuedGroups, receivedGroups] =
    await Promise.all([
      prisma.verifiableCredential.findMany({
        where: { issuerId: session.user.id },
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
      }),
      prisma.verifiableCredential.findMany({
        where: {
          holderId: session.user.id,
          status: { not: "PENDING" },
        },
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
      }),
      prisma.verifiableCredential.groupBy({
        by: ["status"],
        where: { issuerId: session.user.id },
        _count: { _all: true },
      }),
      prisma.verifiableCredential.groupBy({
        by: ["status"],
        where: {
          holderId: session.user.id,
          status: { not: "PENDING" },
        },
        _count: { _all: true },
      }),
    ]);

  function safeIsoString(dateVal: Date | string | null | undefined): string | null {
    if (!dateVal) return null;
    const d = new Date(dateVal);
    return !isNaN(d.getTime()) ? d.toISOString() : null;
  }

  function mapCredentials(
    rawList: typeof issuedRaw
  ): DashboardCredential[] {
    return rawList.map((vc) => {
      const payload = vc.vcPayload as Record<string, unknown>;
      const schema = payload.credentialSchema as {
        id: string;
        name: string;
        version: string;
      } | undefined;

      const types = (payload.type as string[]) ?? [];
      const credentialType =
        types.find((t) => t !== "VerifiableCredential") ?? "Credential";

      return {
        id: vc.id,
        status: vc.status,
        issuedAt: safeIsoString(vc.issuedAt) ?? new Date().toISOString(),
        expiresAt: safeIsoString(vc.expiresAt),
        issuer: vc.issuer,
        holder: vc.holder,
        schemaSnapshot: schema ?? null,
        credentialType,
      };
    });
  }

  const issued = mapCredentials(issuedRaw);
  const received = mapCredentials(receivedRaw);

  const emptyBreakdown = { PENDING: 0, ACTIVE: 0, REVOKED: 0 };

  const issuedByStatus = { ...emptyBreakdown };
  let issuedCount = 0;
  for (const g of issuedGroups) {
    issuedByStatus[g.status] = g._count._all;
    issuedCount += g._count._all;
  }

  const receivedByStatus = { ...emptyBreakdown };
  let receivedCount = 0;
  for (const g of receivedGroups) {
    receivedByStatus[g.status] = g._count._all;
    receivedCount += g._count._all;
  }

  const stats: CredentialStats = {
    issuedCount,
    receivedCount,
    issuedByStatus,
    receivedByStatus,
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col justify-between">
      <div>
        <Navbar userName={session.user.name} userImage={session.user.image} />

        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8">
          <DashboardHeader userName={session.user.name} />
          <StatsWidgets stats={stats} />
          <CredentialTabs issued={issued} received={received} />
        </main>
      </div>

      <Footer />
    </div>
  );
}