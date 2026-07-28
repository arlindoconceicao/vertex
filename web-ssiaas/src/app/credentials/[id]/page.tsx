import { auth } from "@/auth";
import { redirect, notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import CredentialDetailClientView from "./CredentialDetailClientView";

type PageProps = { params: Promise<{ id: string }> };

export default async function CredentialDetailPage({ params }: PageProps) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!session.user.cpf) redirect("/complete-registration");

  const { id } = await params;

  const credential = await prisma.verifiableCredential.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      issuedAt: true,
      expiresAt: true,
      vcPayload: true,
      issuerId: true,
      holderId: true,
      issuer: { select: { id: true, name: true, email: true, image: true } },
      holder: { select: { id: true, name: true, email: true, image: true } },
    },
  });

  if (!credential) notFound();

  const isIssuer = credential.issuerId === session.user.id;
  const isHolder = credential.holderId === session.user.id;
  if (!isIssuer && !isHolder) notFound();

  return (
    <CredentialDetailClientView
      credential={credential}
      isIssuer={isIssuer}
      isHolder={isHolder}
    />
  );
}