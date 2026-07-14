import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";

export default async function SchemasPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!session.user.cpf) redirect("/complete-registration");

  // Busca os schemas do próprio usuário + todos os públicos
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

  return (
    <div className="min-h-screen bg-gray-950 text-white">

      <header className="border-b border-gray-800 bg-gray-900">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <Link
            href="/dashboard"
            className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
            Dashboard
          </Link>
          <Link
            href="/schemas/new"
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-4 py-2 rounded-xl transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            New Schema
          </Link>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10">

        <div className="mb-8">
          <h1 className="text-2xl font-bold">Schemas</h1>
          <p className="text-gray-400 text-sm mt-1">
            Your credential templates and public community schemas.
          </p>
        </div>

        {schemas.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center bg-gray-900 border border-gray-800 rounded-2xl">
            <svg className="w-10 h-10 text-gray-700 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
            <p className="text-gray-500 text-sm">No schemas yet.</p>
            <Link href="/schemas/new" className="text-indigo-400 hover:text-indigo-300 text-sm mt-2">
              Create your first schema →
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {schemas.map((schema) => {
              const isMine = schema.creator.id === session.user.id;
              return (
                <Link
                  key={schema.id}
                  href={`/schemas/${schema.id}`}
                  className="bg-gray-900 border border-gray-800 rounded-2xl p-5 hover:border-gray-700 transition-colors flex flex-col gap-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-white">{schema.name}</p>
                      <p className="text-xs text-gray-500 mt-0.5">v{schema.version}</p>
                    </div>
                    <div className="flex gap-1.5">
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          schema.visibility === "PUBLIC"
                            ? "bg-emerald-500/10 text-emerald-400"
                            : "bg-gray-700 text-gray-400"
                        }`}
                      >
                        {schema.visibility === "PUBLIC" ? "Public" : "Private"}
                      </span>
                      {schema.storageLocation === "IPFS" && (
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-indigo-500/10 text-indigo-400">
                          IPFS
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs text-gray-500 mt-auto">
                    <span>{isMine ? "Created by you" : `By ${schema.creator.name}`}</span>
                    <span suppressHydrationWarning>
                      {new Date(schema.createdAt).toLocaleDateString("en-US")}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}

      </main>
    </div>
  );
}