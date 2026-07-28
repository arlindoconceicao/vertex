import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import SchemasClientView from "./SchemasClientView";

export default async function SchemasPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!session.user.cpf) redirect("/complete-registration");

  const schemas = await prisma.credentialSchema.findMany({
    where: {
      OR: [
        { creatorId: session.user.id },
        { visibility: "PUBLIC" },
      ],
    },
    select: {
      id: true,
      name: true,
      version: true,
      visibility: true,
      storageLocation: true,
      publishedAt: true,
      createdAt: true,
      creator: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return <SchemasClientView schemas={schemas} userId={session.user.id} />;
}