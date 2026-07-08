import Link from "next/link";
import type { DashboardCredential } from "@/lib/types";

type Props = {
  credential: DashboardCredential;
  perspective: "issued" | "received";
};

const statusConfig = {
  ACTIVE:  { label: "Active",  classes: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  PENDING: { label: "Pending", classes: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20" },
  REVOKED: { label: "Revoked", classes: "bg-red-500/10 text-red-400 border-red-500/20" },
} as const;

export default function CredentialCard({ credential, perspective }: Props) {
  const { label, classes } = statusConfig[credential.status];

  // Determina quem exibir como "a outra parte" da credencial.
  // Se estou na aba de recebidas, mostro o emissor.
  // Se estou na aba de emitidas, mostro o destinatário.
  const counterpart =
    perspective === "received" ? credential.issuer : credential.holder;

  const counterpartLabel =
    perspective === "received" ? "Issued by" : "Issued to";

  return (
    <Link
      href={`/credentials/${credential.id}`}
      className="block bg-gray-900 border border-gray-800 rounded-2xl p-5 flex flex-col gap-4 hover:border-gray-700 transition-colors"
    >
      {/* Cabeçalho: tipo da credencial + status */}
      <div className="flex items-start justify-between gap-2">
        <div>
          {credential.schemaSnapshot && (
            <p className="text-xs text-gray-500 mb-1">
              {credential.schemaSnapshot.name}
              <span className="ml-1 text-gray-600">
                v{credential.schemaSnapshot.version}
              </span>
            </p>
          )}
          <p className="text-sm font-semibold text-white leading-tight">
            {credential.credentialType}
          </p>
        </div>
        <span
          className={`shrink-0 text-xs font-medium px-2.5 py-1 rounded-full border ${classes}`}
        >
          {label}
        </span>
      </div>

      {/* Contraparte */}
      <div className="flex items-center gap-2 bg-gray-800/60 rounded-xl px-3 py-2.5">
        <div className="w-7 h-7 rounded-full bg-indigo-700 flex items-center justify-center shrink-0">
          <span className="text-white text-xs font-medium">
            {counterpart.name?.[0]?.toUpperCase() ?? "?"}
          </span>
        </div>
        <div className="min-w-0">
          <p className="text-xs text-gray-500">{counterpartLabel}</p>
          <p className="text-sm text-white truncate">
            {counterpart.name ?? counterpart.email}
          </p>
        </div>
      </div>

      {/* Datas */}
      <div className="flex items-center justify-between text-xs text-gray-500">
        <span suppressHydrationWarning>
          Issued on{" "}
          {new Date(credential.issuedAt).toLocaleDateString("en-US")}
        </span>
        {credential.expiresAt ? (
          <span suppressHydrationWarning>
            Expires on{" "}
            {new Date(credential.expiresAt).toLocaleDateString("en-US")}
          </span>
        ) : (
          <span className="text-gray-600">No expiration</span>
        )}
      </div>
    </Link>
  );
}
