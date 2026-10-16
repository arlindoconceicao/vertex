import { auth } from "@/auth";
import { redirect, notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import BatchDetailClientView from "./BatchDetailClientView";

type PageProps = { 
  params: Promise<{ batchId: string }>
};

export default async function BatchDetailPage({ params }: PageProps) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!session.user.cpf) redirect("/complete-registration");

  const { batchId } = await params;

  const credentials = await prisma.verifiableCredential.findMany({
    where: { batchId, issuerId: session.user.id },
    select: {
      id: true,
      status: true,
      issuedAt: true,
      expiresAt: true,
      vcPayload: true,
      metadata: true,
      pdfHash: true,
      holder: { select: { id: true, name: true, email: true, image: true } }
    },
    orderBy: { issuedAt: "desc" }
  });

  if (!credentials || credentials.length === 0) {
    notFound();
  }

  const firstCredMetadata = credentials[0].metadata as Record<string, any>;
  const schemaSnapshot = {
    name: firstCredMetadata?.schemaName || "Credential",
    version: firstCredMetadata?.schemaVersion || "1.0",
  };

  return (
    <div className="min-h-[calc(100vh-64px)] p-6 flex justify-center">
      <div className="w-full max-w-5xl min-w-0">
        <BatchDetailClientView batchId={batchId} credentials={credentials} schemaSnapshot={schemaSnapshot} />
      </div>
    </div>
  );
}
