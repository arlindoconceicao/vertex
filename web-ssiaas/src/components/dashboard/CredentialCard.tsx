import type { VerifiableCredential, VCStatus } from "@/services/credentialService";

type Props = {
  credential: VerifiableCredential;
  perspective: "issued" | "received";
};

const statusConfig: Record<VCStatus, { label: string; classes: string }> = {
  ACTIVE:  { label: "Ativa",    classes: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  PENDING: { label: "Pendente", classes: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20" },
  REVOKED: { label: "Revogada", classes: "bg-red-500/10 text-red-400 border-red-500/20" },
};

export default function CredentialCard({ credential, perspective }: Props) {
  const { label, classes } = statusConfig[credential.status];

  const counterpart =
    perspective === "received" ? credential.issuer : credential.holder;

  const counterpartLabel =
    perspective === "received" ? "Emitida por" : "Emitida para";

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 flex flex-col gap-4 hover:border-gray-700 transition-colors">

      {/* Header: Schema + Status */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs text-gray-500 mb-1">
            {credential.schema.name}
            <span className="ml-1 text-gray-600">v{credential.schema.version}</span>
          </p>
          <p className="text-sm font-semibold text-white leading-tight">
            {credential.vcPayload.type.filter((t) => t !== "VerifiableCredential").join(", ")}
          </p>
        </div>
        <span className={`shrink-0 text-xs font-medium px-2.5 py-1 rounded-full border ${classes}`}>
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
          <p className="text-sm text-white truncate">{counterpart.name ?? counterpart.email}</p>
        </div>
      </div>

      {/* Datas */}
      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>
          Emitida em{" "}
          {new Date(credential.issuedAt).toLocaleDateString("pt-BR")}
        </span>
        {credential.expiresAt ? (
          <span>
            Expira em{" "}
            {new Date(credential.expiresAt).toLocaleDateString("pt-BR")}
          </span>
        ) : (
          <span className="text-gray-600">Sem expiração</span>
        )}
      </div>

    </div>
  );
}