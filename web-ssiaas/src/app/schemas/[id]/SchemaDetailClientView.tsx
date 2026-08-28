"use client";

import Link from "next/link";
import { useTranslation } from "@/locales/LanguageContext";
import SchemaActions from "@/components/schemas/SchemaActions";

type SchemaDetailProps = {
  schema: {
    id: string;
    name: string;
    description: string | null;
    version: string;
    visibility: "PUBLIC" | "PRIVATE";
    storageLocation: "LOCAL" | "IPFS";
    ipfsCid: string | null;
    pinataFileId: string | null;
    publishedAt: Date | null;
    jsonSchema: any;
    createdAt: Date;
    creatorId: string;
    creator: { id: string; name: string | null };
  };
  isMine: boolean;
  gatewayUrl: string;
};

export default function SchemaDetailClientView({ schema, isMine, gatewayUrl }: SchemaDetailProps) {
  const { t, locale } = useTranslation();
  const dateLocale = locale === "pt" ? "pt-BR" : locale === "es" ? "es-ES" : "en-US";
  const isPublished = schema.publishedAt !== null;
  const fields = (schema.jsonSchema as { fields: { name: string; type: string; required: boolean }[] }).fields ?? [];

  return (
    <div className="min-h-screen bg-base text-text-main">
      <header className="border-b border-border bg-surface">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center">
          <Link
            href="/schemas"
            className="flex items-center gap-2 text-sm text-text-muted hover:text-text-main transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
            {t("schemas.allSchemas")}
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8">
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <span
              className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                schema.visibility === "PUBLIC"
                  ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20"
                  : "bg-gray-500/10 border border-border text-text-muted"
              }`}
            >
              {schema.visibility === "PUBLIC" ? t("schemas.public") : t("schemas.private")}
            </span>
            {isPublished && (
              <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-indigo-500/10 text-primary-text">
                {t("schemas.publishedIpfs")}
              </span>
            )}
            <span className="text-xs text-text-muted">v{schema.version}</span>
          </div>
          <h1 className="text-2xl font-bold">{schema.name}</h1>
          <p className="text-xs text-primary-text font-mono mt-1 select-all">
            {t("schemas.schemaId")}: {schema.id}
          </p>
          <p className="text-text-muted text-sm mt-2">{schema.description}</p>
          <p className="text-xs text-text-muted mt-2">
            {isMine ? t("schemas.createdByYou") : `${t("schemas.createdBy")} ${schema.creator.name}`}
            {" · "}
            <span suppressHydrationWarning>
              {new Date(schema.createdAt).toLocaleDateString(dateLocale, { timeZone: "UTC" })}
            </span>
          </p>
        </div>

        {isMine && (
          <SchemaActions
            schemaId={schema.id}
            visibility={schema.visibility}
            isPublished={isPublished}
          />
        )}

        {schema.ipfsCid && (
          <div className="bg-surface border border-border rounded-2xl p-5">
            <div className="mb-4">
              <p className="text-xs text-text-subtle mb-1">{t("schemas.pinataFileId")}</p>
              <p className="text-sm text-primary-text font-mono break-all">{schema.pinataFileId}</p>
            </div>
            <div className="mb-4">
              <p className="text-xs text-text-subtle mb-1">{t("schemas.ipfsCid")}</p>
              <p className="text-sm text-primary-text font-mono break-all">{schema.ipfsCid}</p>
            </div>
            
            <div className="flex flex-wrap items-center gap-4 mt-4">
              <a 
                href={`https://${gatewayUrl}/ipfs/${schema.ipfsCid}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 bg-primary hover:bg-primary-hover text-white text-sm font-medium px-4 py-2.5 rounded-xl transition-colors cursor-pointer"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                </svg>
                {t("schemas.consultaIpfs")}
              </a>
              <p className="text-xs text-text-muted" suppressHydrationWarning>
                {t("schemas.publishedOn")} {new Date(schema.publishedAt!).toLocaleDateString(dateLocale, { timeZone: "UTC" })}
              </p>
            </div>
          </div>
        )}

        <div className="bg-surface border border-border rounded-2xl p-5">
          <h2 className="text-sm font-semibold text-text-main mb-4">
            {t("schemas.credentialFields")} ({fields.length})
          </h2>
          <div className="space-y-2">
            {fields.map((field, i) => (
              <div key={i} className="flex items-center justify-between bg-surface-hover border border-border rounded-xl px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="text-sm text-text-main">{field.name}</span>
                  {field.required && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
                      {t("schemas.required")}
                    </span>
                  )}
                </div>
                <span className="text-xs text-text-subtle font-mono">{field.type}</span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <p className="text-xs text-text-subtle mb-2">{t("schemas.rawJsonSchema")}</p>
          <pre className="bg-surface border border-border rounded-xl p-4 text-xs text-text-muted overflow-x-auto">
            {JSON.stringify(schema.jsonSchema, null, 2)}
          </pre>
        </div>
      </main>
    </div>
  );
}
