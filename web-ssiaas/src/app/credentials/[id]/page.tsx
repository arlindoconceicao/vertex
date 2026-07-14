import { auth } from "@/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import CredentialActions from "@/components/credentials/CredentialActions";

type PageProps = { params: Promise<{ id: string }> };

const statusStyles = {
  ACTIVE:  { label: "Active",  classes: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  PENDING: { label: "Pending", classes: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20" },
  REVOKED: { label: "Revoked", classes: "bg-red-500/10 text-red-400 border-red-500/20" },
} as const;

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

  // Apenas issuer ou holder podem ver a credencial
  const isIssuer = credential.issuerId === session.user.id;
  const isHolder = credential.holderId === session.user.id;
  if (!isIssuer && !isHolder) notFound();

  const { label, classes } = statusStyles[credential.status];
  const payload = credential.vcPayload as Record<string, unknown>;
  const schemaSnapshot = payload.credentialSchema as {
    id: string;
    name: string;
    version: string;
  } | undefined;
  const credentialSubject = payload.credentialSubject as Record<string, unknown> | undefined;
  const types = (payload.type as string[]) ?? [];
  const credentialType = types.find((t) => t !== "VerifiableCredential") ?? "Credential";
  const hasProof = !!payload.proof;

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
            Dashboard
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8">

        {/* Cabeçalho */}
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <span className={`text-xs px-2.5 py-1 rounded-full font-medium border ${classes}`}>
              {label}
            </span>
            {hasProof && (
              <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-indigo-500/10 text-indigo-400">
                Signed
              </span>
            )}
            {!hasProof && (
              <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-gray-700 text-gray-400">
                Unsigned
              </span>
            )}
          </div>
          <h1 className="text-2xl font-bold">{credentialType}</h1>
          {schemaSnapshot && (
            <p className="text-gray-500 text-sm mt-1">
              Schema: {schemaSnapshot.name} v{schemaSnapshot.version}
            </p>
          )}
        </div>

        {/* Ações — renderiza condicionalmente com base no papel e status */}
        <CredentialActions
          credentialId={credential.id}
          status={credential.status}
          role={isIssuer ? "issuer" : "holder"}
        />

        {/* Partes envolvidas */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <PartyCard
            label="Issuer"
            user={credential.issuer}
            isYou={isIssuer}
          />
          <PartyCard
            label="Holder"
            user={credential.holder}
            isYou={isHolder}
          />
        </div>

        {/* Dados da credencial */}
        {credentialSubject && (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
            <h2 className="text-sm font-semibold text-gray-300 mb-4">
              Credential Data
            </h2>
            <div className="space-y-2">
              {Object.entries(credentialSubject)
                .filter(([key]) => key !== "id")
                .map(([key, value]) => (
                  <div
                    key={key}
                    className="flex items-center justify-between bg-gray-800/60 rounded-xl px-4 py-3"
                  >
                    <span className="text-sm text-gray-400">{key}</span>
                    <span className="text-sm text-white font-medium">
                      {String(value)}
                    </span>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Datas */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl px-5 py-4">
            <p className="text-xs text-gray-500 mb-1">Issued On</p>
            <p className="text-sm text-white" suppressHydrationWarning>
              {new Date(credential.issuedAt).toLocaleDateString("en-US", {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </p>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-2xl px-5 py-4">
            <p className="text-xs text-gray-500 mb-1">Expires On</p>
            <p className="text-sm text-white" suppressHydrationWarning>
              {credential.expiresAt
                ? new Date(credential.expiresAt).toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })
                : "No expiration"}
            </p>
          </div>
        </div>

        {/* Payload W3C completo */}
        <div>
          <p className="text-xs text-gray-500 mb-2">W3C Verifiable Credential Payload</p>
          <pre className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-xs text-gray-400 overflow-x-auto">
            {JSON.stringify(credential.vcPayload, null, 2)}
          </pre>
        </div>

      </main>
    </div>
  );
}

// ── Componente auxiliar: card da parte envolvida ──────────────

function PartyCard({
  label,
  user,
  isYou,
}: {
  label: string;
  user: { name: string | null; email: string | null; image: string | null };
  isYou: boolean;
}) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
      <p className="text-xs text-gray-500 mb-3">
        {label}
        {isYou && (
          <span className="ml-1.5 text-indigo-400">(You)</span>
        )}
      </p>
      <div className="flex items-center gap-3">
        {user.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.image}
            alt={user.name ?? "User"}
            className="w-9 h-9 rounded-full"
          />
        ) : (
          <div className="w-9 h-9 rounded-full bg-indigo-700 flex items-center justify-center">
            <span className="text-white text-xs font-medium">
              {user.name?.[0]?.toUpperCase() ?? "?"}
            </span>
          </div>
        )}
        <div className="min-w-0">
          <p className="text-sm font-medium text-white truncate">
            {user.name ?? "No name"}
          </p>
          <p className="text-xs text-gray-400 truncate">{user.email}</p>
        </div>
      </div>
    </div>
  );
}