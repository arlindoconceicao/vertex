import { auth } from "@/auth";
import { redirect, notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import CredentialDetailClientView from "./CredentialDetailClientView";

type PageProps = { 
  params: Promise<{ id: string }>,
  searchParams: Promise<{ view?: string }>
};

export default async function CredentialDetailPage({ params, searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!session.user.cpf) redirect("/complete-registration");

  const { id } = await params;
  const { view } = await searchParams;

  const credential = await prisma.verifiableCredential.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      issuedAt: true,
      expiresAt: true,
      vcPayload: true,
      pdfHash: true,
      pdfDownloadedAt: true,
      revokedAt: true,
      issuerId: true,
      holderId: true,
      issuer: { select: { id: true, name: true, email: true, image: true } },
      holder: { select: { id: true, name: true, email: true, image: true } },
    },
  });

  if (!credential) notFound();

  let isIssuer = credential.issuerId === session.user.id;
  let isHolder = credential.holderId === session.user.id;

  // Se o usuário for os dois (para testes locais), a query param "view" define a perspectiva forçada
  if (isIssuer && isHolder && view) {
    if (view === "issued") {
      isHolder = false;
    } else if (view === "received") {
      isIssuer = false;
    }
  }

  if (!isIssuer && !isHolder) notFound();

  return (
    <CredentialDetailClientView
      credential={credential}
      isIssuer={isIssuer}
      isHolder={isHolder}
    />
  );
}