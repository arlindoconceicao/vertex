import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import IssueCredentialForm from "@/components/credentials/IssueCredentialForm";

export default async function IssueCredentialPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!session.user.cpf) redirect("/complete-registration");

  // Busca os schemas do próprio usuário para popular o select.
  // Inclui o jsonSchema para renderizar os campos dinâmicos.
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

  return (
    <div className="min-h-screen bg-gray-950 text-white">

      <header className="border-b border-gray-800 bg-gray-900">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center">
          <Link
            href="/dashboard"
            className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
            Back to Dashboard
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-bold">Issue Credential</h1>
          <p className="text-gray-400 text-sm mt-1">
            Select a schema, fill in the data and issue a verifiable credential.
          </p>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 sm:p-8">
          <IssueCredentialForm schemas={schemas} />
        </div>
      </main>

    </div>
  );
}