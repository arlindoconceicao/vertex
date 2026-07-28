import { auth } from "@/auth";
import { redirect, notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import SchemaDetailClientView from "./SchemaDetailClientView";

type PageProps = { params: Promise<{ id: string }> };

export default async function SchemaDetailPage({ params }: PageProps) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!session.user.cpf) redirect("/complete-registration");

  const { id } = await params;

  const schema = await prisma.credentialSchema.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      description: true,
      version: true,
      visibility: true,
      storageLocation: true,
      ipfsCid: true,
      publishedAt: true,
      jsonSchema: true,
      createdAt: true,
      creatorId: true,
      creator: { select: { id: true, name: true } },
    },
  });

  if (!schema) notFound();

  if (schema.visibility === "PRIVATE" && schema.creatorId !== session.user.id) {
    notFound();
  }

  const isMine = schema.creatorId === session.user.id;

  return (
    <SchemaDetailClientView
      schema={schema}
      isMine={isMine}
    />
  );
}