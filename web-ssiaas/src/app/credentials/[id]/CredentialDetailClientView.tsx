"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslation } from "@/locales/LanguageContext";
import CredentialActions from "@/components/credentials/CredentialActions";

type User = { id: string; name: string | null; email: string | null; image: string | null };

type CredentialDetailProps = {
  credential: {
    id: string;
    status: "ACTIVE" | "PENDING" | "REVOKED";
    issuedAt: Date;
    expiresAt: Date | null;
    vcPayload: unknown;
    pdfHash?: string | null;
    pdfDownloadedAt: Date | null;
    revokedAt?: Date | null;
    issuerId: string;
    holderId: string;
    issuer: User;
    holder: User;
  };
  isIssuer: boolean;
  isHolder: boolean;
  isPdfExpired?: boolean;
};

export default function CredentialDetailClientView({ credential, isIssuer, isHolder, isPdfExpired }: CredentialDetailProps) {
  const { t, locale } = useTranslation();
  const dateLocale = locale === "pt" ? "pt-BR" : locale === "es" ? "es-ES" : "en-US";

  const [showData, setShowData] = useState(false);

  const statusStyles = {
    ACTIVE: { label: t("dashboard.tabs.status.active"), classes: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
    PENDING: { label: t("dashboard.tabs.status.pending"), classes: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20" },
    REVOKED: { label: t("dashboard.tabs.status.revoked"), classes: "bg-red-500/10 text-red-400 border-red-500/20" },
  } as const;

  const { label, classes } = statusStyles[credential.status];
  const payload = credential.vcPayload as Record<string, unknown> || {};
  
  const isPending = credential.status === "PENDING" && !payload.pdfHash;
  
  const schemaSnapshot = isPending
     ? (payload.credentialSchema as { id: string; name: string; version: string; } | undefined)
     : { id: payload.schemaId as string, name: "Schema", version: "1.0" };
     
  const credentialSubject = payload.credentialSubject as Record<string, unknown> | undefined;
  
  const isDownloaded = Boolean(credential.pdfDownloadedAt);
  const hasProof = Boolean(credential.pdfHash || payload.pdfHash);
  const credentialType = isPending ? ((payload.type as string[] | undefined)?.find((type) => type !== "VerifiableCredential") ?? t("credentials.defaultType")) : t("credentials.encryptedType");

  return (
    <div className="min-h-screen bg-base text-text-main flex flex-col justify-between">
      <div>
        <header className="border-b border-border bg-surface">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-3">
              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary">
                <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.955 11.955 0 003 10c0 5.592 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
                </svg>
              </div>
              <span className="font-semibold tracking-tight">{t("common.appName")}</span>
            </Link>
            <Link href="/dashboard" className="text-sm text-text-muted hover:text-text-main flex items-center gap-1">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
              </svg>
              {t("common.dashboard")}
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
              {credential.status === "REVOKED" && credential.revokedAt && (
                <span className="text-xs font-mono text-red-500 bg-red-500/10 border border-red-500/20 rounded-full px-3 py-1 inline-flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {t("credentials.revokedAt")}: {new Date(credential.revokedAt).toLocaleString(dateLocale)}
                </span>
              )}
              {hasProof ? (
                <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-indigo-500/10 text-primary-text">
                  {t("credentials.signed")}
                </span>
              ) : (
                <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-gray-700 text-text-muted">
                  {t("credentials.unsigned")}
                </span>
              )}
            </div>
            <h1 className="text-2xl font-bold">{credentialType}</h1>
            {schemaSnapshot && schemaSnapshot.name && (
              <p className="text-text-subtle text-sm mt-1">
                {t("credentials.schemaLabel")}: {schemaSnapshot.name} {t("schemas.v")}{schemaSnapshot.version || "1.0"} {t("credentials.idLabel")}{schemaSnapshot.id})
              </p>
            )}
          </div>

          <CredentialActions
            credentialId={credential.id}
            status={credential.status}
            role={isIssuer ? "issuer" : "holder"}
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <PartyCard label={t("dashboard.tabs.issuedBy")} user={credential.issuer} isYou={isIssuer} t={t} />
            <PartyCard label={t("dashboard.tabs.issuedTo")} user={credential.holder} isYou={isHolder} t={t} />
          </div>

          {/* Estado de PDF / Metadata */}
          {!isPending && (
            <div className="bg-surface border border-border rounded-2xl p-5">
              <h2 className="text-sm font-semibold text-text-main mb-4">
                {t("credentials.credentialSummary")}
              </h2>
              <div className="space-y-2">
                <div className="flex flex-col bg-surface-hover border border-border rounded-xl px-4 py-3">
                  <span className="text-xs text-text-subtle font-medium uppercase tracking-wider mb-1">{t("credentials.originalPdfHash")}</span>
                  <span className="text-sm text-text-main font-mono break-all">{credential.pdfHash || (payload.pdfHash as string) || "N/A"}</span>
                </div>
                {!!payload.timestamp && (
                  <div className="flex flex-col bg-surface-hover border border-border rounded-xl px-4 py-3">
                    <span className="text-xs text-text-subtle font-medium uppercase tracking-wider mb-1">{t("credentials.signatureDate")}</span>
                    <span className="text-sm text-text-main">{new Date(String(payload.timestamp)).toLocaleString(dateLocale)}</span>
                  </div>
                )}
                {isHolder && (
                  <div className="mt-4 pt-4 border-t border-border">
                    {!isPdfExpired ? (
                      <>
                        <a
                          href={`/api/credentials/${credential.id}/pdf`}
                          className="inline-flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-hover text-white rounded-lg transition-colors text-sm font-medium"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                          {t("credentials.downloadEncryptedPdf")}
                        </a>
                        <p className="text-xs text-text-subtle mt-2">
                          {t("credentials.pdfReadDisclaimer")}
                        </p>
                      </>
                    ) : (
                      <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 inline-block">
                        <p className="text-sm font-medium text-red-400">
                          {t("credentials.pdfExpired")}
                        </p>
                        <p className="text-xs text-red-400/80 mt-1">
                          {t("credentials.pdfExpiredDisclaimer")}
                        </p>
                      </div>
                    )}
                  </div>
                )}
                {isIssuer && (
                  <div className="mt-4 pt-4 border-t border-border">
                    {!isDownloaded ? (
                      <button
                        onClick={() => setShowData(true)}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-hover text-white rounded-lg transition-colors text-sm font-medium"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                        {t("credentials.showData")}
                      </button>
                    ) : (
                      <p className="text-sm text-text-muted">
                        {t("credentials.dataWipedDisclaimer")}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {credentialSubject && (isHolder || (isIssuer && showData) || (isIssuer && isDownloaded)) && (
            <div className="bg-surface border border-border rounded-2xl p-5">
              <h2 className="text-sm font-semibold text-text-main mb-4">
                {t("credentials.credentialData")} {isPending && t("credentials.provisional")}
              </h2>
              <div className="space-y-2">
                {Object.entries(credentialSubject)
                  .filter(([key]) => key !== "id")
                  .map(([key, value]) => (
                    <div key={key} className="flex items-center justify-between bg-surface-hover border border-border rounded-xl px-4 py-3">
                      <span className="text-sm text-text-muted">{key}</span>
                      <span className={`text-sm font-medium ${isDownloaded ? "text-text-subtle italic" : "text-text-main"}`}>{String(value)}</span>
                    </div>
                  ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-surface border border-border rounded-2xl px-5 py-4">
              <p className="text-xs text-text-subtle mb-1">{t("dashboard.tabs.issuedOn")}</p>
              <p className="text-sm text-text-main" suppressHydrationWarning>
                {new Date(credential.issuedAt).toLocaleDateString(dateLocale, { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" })}
              </p>
            </div>
            <div className="bg-surface border border-border rounded-2xl px-5 py-4">
              <p className="text-xs text-text-subtle mb-1">{t("dashboard.tabs.expiresOn")}</p>
              <p className="text-sm text-text-main" suppressHydrationWarning>
                {credential.expiresAt
                  ? new Date(credential.expiresAt).toLocaleDateString(dateLocale, { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" })
                  : t("dashboard.tabs.noExpiration")}
              </p>
            </div>
          </div>

          <div>
            <p className="text-xs text-text-subtle mb-2">{t("credentials.rawServerMetadata")}</p>
            <pre className="bg-surface border border-border rounded-xl p-4 text-xs text-text-muted overflow-x-auto">
              {JSON.stringify(credential.vcPayload, null, 2)}
            </pre>
          </div>
        </main>
      </div>
    </div>
  );
}

function PartyCard({
  label,
  user,
  isYou,
  t
}: {
  label: string;
  user: User;
  isYou: boolean;
  t: (key: string) => string;
}) {
  return (
    <div className="bg-surface border border-border rounded-2xl p-5">
      <p className="text-xs text-text-subtle mb-3">
        {label}
        {isYou && <span className="ml-1.5 text-primary-text">({t("credentials.you")})</span>}
      </p>
      <div className="flex items-center gap-3">
        {user.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={user.image} alt={user.name ?? "User"} className="w-9 h-9 rounded-full" />
        ) : (
          <div className="w-9 h-9 rounded-full bg-indigo-700 flex items-center justify-center">
            <span className="text-white text-xs font-medium">{user.name?.[0]?.toUpperCase() ?? "?"}</span>
          </div>
        )}
        <div className="min-w-0">
          <p className="text-sm font-medium text-text-main truncate">{user.name ?? "No name"}</p>
          <p className="text-xs text-text-muted truncate">{user.email}</p>
        </div>
      </div>
    </div>
  );
}
