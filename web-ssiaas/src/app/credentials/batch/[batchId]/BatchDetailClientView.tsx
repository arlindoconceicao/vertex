"use client";

import Link from "next/link";
import { useTranslation } from "@/locales/LanguageContext";

type CredentialItem = {
  id: string;
  status: "OFFERED" | "PENDING" | "ACTIVE" | "REVOKED" | "REJECTED";
  issuedAt: Date;
  expiresAt: Date | null;
  vcPayload: any;
  metadata: any;
  pdfHash: string | null;
  holder: {
    id: string;
    name: string | null;
    email: string | null;
    image: string | null;
  };
};

type Props = {
  batchId: string;
  credentials: CredentialItem[];
  schemaSnapshot: { name: string; version: string };
};

export default function BatchDetailClientView({ batchId, credentials, schemaSnapshot }: Props) {
  const { t, locale } = useTranslation();
  const dateLocale = locale === "pt" ? "pt-BR" : locale === "es" ? "es-ES" : "en-US";

  const total = credentials.length;
  const accepted = credentials.filter(c => c.status !== "OFFERED" && c.status !== "REJECTED").length;

  const statusStyles = {
    ACTIVE: { label: t("dashboard.tabs.status.active"), classes: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
    PENDING: { label: t("dashboard.tabs.status.pending"), classes: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20" },
    REVOKED: { label: t("dashboard.tabs.status.revoked"), classes: "bg-red-500/10 text-red-400 border-red-500/20" },
    OFFERED: { label: t("dashboard.tabs.status.offered"), classes: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
    REJECTED: { label: t("dashboard.tabs.status.rejected"), classes: "bg-gray-500/10 text-gray-400 border-gray-500/20" },
  } as const;

  // Extrair atributos da primeira credencial para montar o cabeçalho dinâmico
  const firstPayload = credentials[0]?.vcPayload as any;
  const credentialSubject = firstPayload?.credentialSubject || {};
  // Remover id base do w3c
  const dynamicKeys = Object.keys(credentialSubject).filter(k => k !== "id");

  return (
    <div className="space-y-6">
      <div>
        <Link href="/dashboard" className="text-sm text-text-muted hover:text-text-main flex items-center gap-1 mb-4">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          {t("common.backToDashboard") || "Voltar ao Painel"}
        </Link>
        <h1 className="text-2xl font-bold text-text-main flex items-center gap-2">
          <div className="bg-blue-500/20 text-blue-400 text-xs px-2.5 py-1 rounded-full font-semibold uppercase tracking-wider h-fit">
            LOTE
          </div>
          {schemaSnapshot.name}
        </h1>
        <p className="text-sm text-text-muted mt-1">
          Lote: <span className="font-mono text-text-main">{batchId}</span> | Versão {schemaSnapshot.version}
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-surface border border-border rounded-xl p-4">
           <div className="text-xs text-text-muted mb-1">Total no Lote</div>
           <div className="text-2xl font-semibold text-text-main">{total}</div>
        </div>
        <div className="bg-surface border border-border rounded-xl p-4">
           <div className="text-xs text-text-muted mb-1">Aceitas / Ativas</div>
           <div className="text-2xl font-semibold text-emerald-400">{accepted}</div>
        </div>
      </div>

      <div className="bg-surface border border-border rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto custom-scrollbar pb-1">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-surface-hover border-b border-border">
              <tr>
                <th className="px-6 py-4 font-medium text-text-muted">Status</th>
                <th className="px-6 py-4 font-medium text-text-muted">Destinatário</th>
                {dynamicKeys.map(key => (
                  <th key={key} className="px-6 py-4 font-medium text-text-muted">{key}</th>
                ))}
                <th className="px-6 py-4 font-medium text-text-muted">Data de Emissão</th>
                <th className="px-6 py-4 font-medium text-text-muted text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {credentials.map(cred => {
                const subj = cred.vcPayload?.credentialSubject || {};
                const sStyle = statusStyles[cred.status];
                return (
                  <tr key={cred.id} className="hover:bg-surface-hover transition-colors">
                    <td className="px-6 py-4">
                      <span className={`text-xs px-2.5 py-1 rounded-full font-medium border ${sStyle.classes}`}>
                        {sStyle.label || cred.status}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                         {cred.holder.image ? (
                           <img src={cred.holder.image} alt="" className="w-8 h-8 rounded-full bg-surface-hover object-cover" />
                         ) : (
                           <div className="w-8 h-8 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center font-bold">
                             {cred.holder.name?.charAt(0).toUpperCase() || cred.holder.email?.charAt(0).toUpperCase() || "?"}
                           </div>
                         )}
                         <div>
                           <div className="font-medium text-text-main">{cred.holder.name || "N/A"}</div>
                           <div className="text-xs text-text-muted">{cred.holder.email}</div>
                         </div>
                      </div>
                    </td>
                    {dynamicKeys.map(key => (
                      <td key={key} className="px-6 py-4 text-text-main">{String(subj[key] ?? "-")}</td>
                    ))}
                    <td className="px-6 py-4 text-text-main font-mono text-xs">
                      {new Date(cred.issuedAt).toLocaleString(dateLocale)}
                    </td>
                    <td className="px-6 py-4 text-right">
                       <Link href={`/credentials/${cred.id}?view=issued`} className="text-primary hover:text-primary-hover font-medium underline text-xs">
                         Ver Credencial
                       </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
