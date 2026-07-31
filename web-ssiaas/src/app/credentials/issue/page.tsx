import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import IssueCredentialClientView from "./IssueCredentialClientView";

type PageProps = {
  searchParams: Promise<{ holder?: string }>;
};

export default async function IssueCredentialPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!session.user.cpf) redirect("/complete-registration");

  const { holder } = await searchParams;

  const schemasRaw = await prisma.credentialSchema.findMany({
    where: { creatorId: session.user.id },
    select: {
      id: true,
      name: true,
      version: true,
      jsonSchema: true,
    },
    orderBy: { createdAt: "desc" },
  });

  const schemas = schemasRaw.map((s) => ({
    id: s.id,
    name: s.name,
    version: s.version,
    fields: ((s.jsonSchema as { fields: { name: string; type: string; required: boolean }[] })
      .fields ?? []),
  }));

  return <IssueCredentialClientView schemas={schemas} initialHolderEmail={holder} />;
}