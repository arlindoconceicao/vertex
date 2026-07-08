import { auth } from "@/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import SchemaActions from "@/components/schemas/SchemaActions";

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

  // Schemas privados de outros usuários não são acessíveis
  if (schema.visibility === "PRIVATE" && schema.creatorId !== session.user.id) {
    notFound();
  }

  const isMine = schema.creatorId === session.user.id;
  const isPublished = schema.publishedAt !== null;
  const fields = (schema.jsonSchema as { fields: { name: string; type: string; required: boolean }[] }).fields ?? [];

  return (
    <div className="min-h-screen bg-gray-950 text-white">

      <header className="border-b border-gray-800 bg-gray-900">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center">
          <Link
            href="/schemas"
            className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
            All Schemas
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8">

        {/* Cabeçalho com badges */}
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <span
              className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                schema.visibility === "PUBLIC"
                  ? "bg-emerald-500/10 text-emerald-400"
                  : "bg-gray-700 text-gray-400"
              }`}
            >
              {schema.visibility === "PUBLIC" ? "Public" : "Private"}
            </span>
            {isPublished && (
              <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-indigo-500/10 text-indigo-400">
                Published to IPFS
              </span>
            )}
            <span className="text-xs text-gray-600">v{schema.version}</span>
          </div>
          <h1 className="text-2xl font-bold">{schema.name}</h1>
          <p className="text-gray-400 text-sm mt-2">{schema.description}</p>
          <p className="text-xs text-gray-600 mt-2">
            Created by {isMine ? "you" : schema.creator.name}
            {" · "}
            <span suppressHydrationWarning>
              {new Date(schema.createdAt).toLocaleDateString("en-US")}
            </span>
          </p>
        </div>

        {/* Botões de ação — só aparecem para o criador */}
        {isMine && (
          <SchemaActions
            schemaId={schema.id}
            visibility={schema.visibility}
            isPublished={isPublished}
          />
        )}

        {/* IPFS Info */}
        {schema.ipfsCid && (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
            <p className="text-xs text-gray-500 mb-1">IPFS CID</p>
            <p className="text-sm text-indigo-400 font-mono break-all">
              {schema.ipfsCid}
            </p>
            <p className="text-xs text-gray-600 mt-2" suppressHydrationWarning>
              Published on{" "}
              {new Date(schema.publishedAt!).toLocaleDateString("en-US")}
            </p>
          </div>
        )}

        {/* Campos do schema */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
          <h2 className="text-sm font-semibold text-gray-300 mb-4">
            Credential Fields ({fields.length})
          </h2>
          <div className="space-y-2">
            {fields.map((field, i) => (
              <div
                key={i}
                className="flex items-center justify-between bg-gray-800/60 rounded-xl px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <span className="text-sm text-white">{field.name}</span>
                  {field.required && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
                      required
                    </span>
                  )}
                </div>
                <span className="text-xs text-gray-500 font-mono">
                  {field.type}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* JSON bruto */}
        <div>
          <p className="text-xs text-gray-500 mb-2">Raw JSON Schema</p>
          <pre className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-xs text-gray-400 overflow-x-auto">
            {JSON.stringify(schema.jsonSchema, null, 2)}
          </pre>
        </div>

      </main>
    </div>
  );
}