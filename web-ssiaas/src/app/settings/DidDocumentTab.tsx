"use client";

import { useState, useTransition } from "react";
import { useTranslation } from "@/locales/LanguageContext";
import { publishDidDocumentToIpfs } from "@/app/actions/did-actions";
import { useRouter } from "next/navigation";

type Props = {
  didDocument: any;
  didIpfsCid?: string | null;
  didPinataFileId?: string | null;
  didPublishedAt?: string | null;
  gatewayUrl?: string;
};

export default function DidDocumentTab({
  didDocument,
  didIpfsCid,
  didPinataFileId,
  didPublishedAt,
  gatewayUrl,
}: Props) {
  const { t, locale } = useTranslation();
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const dateLocale = locale === "pt" ? "pt-BR" : locale === "es" ? "es-ES" : "en-US";
  const isPublished = !!didPublishedAt;

  if (!didDocument) {
    return (
      <div className="bg-surface border border-border rounded-2xl p-6">
        <h2 className="text-sm font-semibold text-text-main mb-1">
          {t("settings.documentSection.title") || "Documento Descentralizado (DID Document)"}
        </h2>
        <p className="text-sm text-text-muted mt-4">
          {t("settings.documentSection.empty") || "Nenhum documento DID encontrado. Por favor, faça o pareamento do seu aplicativo móvel na aba Perfil."}
        </p>
      </div>
    );
  }

  const jsonString = JSON.stringify(didDocument, null, 2);

  const handleCopy = () => {
    navigator.clipboard.writeText(jsonString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handlePublish = () => {
    setError(null);
    startTransition(async () => {
      const result = await publishDidDocumentToIpfs();
      if (result.success) {
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  };

  return (
    <div className="bg-surface border border-border rounded-2xl p-6 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <h2 className="text-sm font-semibold text-text-main">
              {t("settings.documentSection.title") || "Documento Descentralizado (DID Document)"}
            </h2>
            {isPublished && (
              <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-indigo-500/10 text-primary-text">
                {t("settings.documentSection.publishedIpfs") || "Publicado no IPFS"}
              </span>
            )}
          </div>
          <p className="text-xs text-text-subtle mt-1">
            {t("settings.documentSection.subtitle") || "Este é o seu documento DID W3C que contém as chaves públicas."}
          </p>
        </div>
        <button
          onClick={handleCopy}
          className="flex-shrink-0 bg-surface-hover hover:bg-border text-text-main text-xs px-3 py-2 rounded-lg border border-border transition-colors flex items-center gap-2 cursor-pointer"
        >
          {copied ? (
            <>
              <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              {t("common.copied") || "Copiado!"}
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              {t("settings.documentSection.copy") || "Copiar JSON"}
            </>
          )}
        </button>
      </div>

      {error && (
        <div className="bg-red-950 border border-red-800 text-red-300 text-sm rounded-xl px-4 py-3">
          {error}
        </div>
      )}

      {didIpfsCid ? (
        <div className="bg-base border border-border rounded-xl p-5 mb-4">
          <div className="mb-4">
            <p className="text-xs text-text-subtle mb-1">{t("settings.documentSection.pinataFileId") || "Pinata File ID"}</p>
            <p className="text-sm text-primary-text font-mono break-all">{didPinataFileId}</p>
          </div>
          <div className="mb-4">
            <p className="text-xs text-text-subtle mb-1">{t("settings.documentSection.ipfsCid") || "IPFS CID"}</p>
            <p className="text-sm text-primary-text font-mono break-all">{didIpfsCid}</p>
          </div>
          
          <div className="flex flex-wrap items-center gap-4 mt-4">
            <a 
              href={`https://${gatewayUrl}/ipfs/${didIpfsCid}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 bg-primary hover:bg-primary-hover text-white text-sm font-medium px-4 py-2.5 rounded-xl transition-colors cursor-pointer"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
              </svg>
              {t("settings.documentSection.viewOnIpfs") || "Consultar IPFS"}
            </a>
            <p className="text-xs text-text-muted" suppressHydrationWarning>
              {t("settings.documentSection.publishedOn") || "Publicado em"}{" "}
              {new Date(didPublishedAt!).toLocaleDateString(dateLocale, { timeZone: "UTC" })}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex mb-4">
          <button
            onClick={handlePublish}
            disabled={isPending}
            className="flex items-center gap-2 bg-primary hover:bg-primary-hover disabled:bg-indigo-900 disabled:text-primary-text text-white text-sm font-medium px-4 py-2.5 rounded-xl transition-colors cursor-pointer disabled:cursor-not-allowed"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z" />
            </svg>
            {isPending ? (t("settings.documentSection.publishing") || "Publicando...") : (t("settings.documentSection.publishToIpfs") || "Publicar no IPFS")}
          </button>
        </div>
      )}

      <div className="bg-base border border-border rounded-xl p-4 max-h-[500px] overflow-y-auto">
        <pre className="text-xs text-primary-text font-mono whitespace-pre-wrap break-all">
          <code>{jsonString}</code>
        </pre>
      </div>
    </div>
  );
}
