"use client";

import { useState } from "react";
import { useTranslation } from "@/locales/LanguageContext";

type Props = {
  didDocument: any;
};

export default function DidDocumentTab({ didDocument }: Props) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  if (!didDocument) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
        <h2 className="text-sm font-semibold text-gray-300 mb-1">
          {t("settings.documentSection.title") || "Documento Descentralizado (DID Document)"}
        </h2>
        <p className="text-sm text-gray-400 mt-4">
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

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-gray-300">
            {t("settings.documentSection.title") || "Documento Descentralizado (DID Document)"}
          </h2>
          <p className="text-xs text-gray-500 mt-1">
            {t("settings.documentSection.subtitle") || "Este é o seu documento DID W3C que contém as chaves públicas."}
          </p>
        </div>
        <button
          onClick={handleCopy}
          className="flex-shrink-0 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs px-3 py-2 rounded-lg border border-gray-700 transition-colors flex items-center gap-2 cursor-pointer"
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

      <div className="bg-gray-950 border border-gray-800 rounded-xl p-4 max-h-[500px] overflow-y-auto">
        <pre className="text-xs text-indigo-300 font-mono whitespace-pre-wrap break-all">
          <code>{jsonString}</code>
        </pre>
      </div>
    </div>
  );
}
