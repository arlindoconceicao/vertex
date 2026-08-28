"use client";

import Link from "next/link";
import type { DashboardCredential } from "@/lib/types";
import { useTranslation } from "@/locales/LanguageContext";

type Props = {
  credential: DashboardCredential;
  perspective: "issued" | "received";
};

export default function CredentialCard({ credential, perspective }: Props) {
  const { t, locale } = useTranslation();

  const statusMap = {
    ACTIVE: { label: t("dashboard.card.statusActive"), classes: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
    PENDING: { label: t("dashboard.card.statusPending"), classes: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20" },
    REVOKED: { label: t("dashboard.card.statusRevoked"), classes: "bg-red-500/10 text-red-400 border-red-500/20" },
  } as const;

  const statusInfo = statusMap[credential.status] || {
    label: credential.status,
    classes: "bg-surface-hover text-text-muted border-border-hover",
  };

  const counterpart =
    perspective === "received" ? credential.issuer : credential.holder;

  const counterpartLabel =
    perspective === "received" ? t("dashboard.card.issuedBy") : t("dashboard.card.issuedTo");

  const dateLocale = locale === "pt" ? "pt-BR" : locale === "es" ? "es-ES" : "en-US";

  return (
    <Link
      href={`/credentials/${credential.id}?view=${perspective}`}
      className="block bg-surface border border-border rounded-2xl p-5 flex flex-col gap-4 hover:border-border-hover transition-colors"
    >
      {/* Cabeçalho: tipo da credencial + status */}
      <div className="flex items-start justify-between gap-2">
        <div>
          {credential.schemaSnapshot && (
            <p className="text-xs text-text-subtle mb-1">
              {credential.schemaSnapshot.name}
              <span className="ml-1 text-text-muted">
                v{credential.schemaSnapshot.version}
              </span>
            </p>
          )}
          <p className="text-sm font-semibold text-text-main leading-tight">
            {credential.credentialType}
          </p>
        </div>
        <span
          className={`shrink-0 text-xs font-medium px-2.5 py-1 rounded-full border ${statusInfo.classes}`}
        >
          {statusInfo.label}
        </span>
      </div>

      {/* Contraparte */}
      <div className="flex items-center gap-2 bg-surface-hover rounded-xl px-3 py-2.5">
        <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center shrink-0">
          <span className="text-text-main text-xs font-medium">
            {counterpart.name?.[0]?.toUpperCase() ?? "?"}
          </span>
        </div>
        <div className="min-w-0">
          <p className="text-xs text-text-subtle">{counterpartLabel}</p>
          <p className="text-sm text-text-main truncate">
            {counterpart.name ?? counterpart.email}
          </p>
        </div>
      </div>

      {/* Datas */}
      <div className="flex items-center justify-between text-xs text-text-subtle">
        <span suppressHydrationWarning>
          {t("dashboard.card.issuedOn", {
            date: new Date(credential.issuedAt).toLocaleDateString(dateLocale, { timeZone: "UTC" }),
          })}
        </span>
        {credential.expiresAt ? (
          <span suppressHydrationWarning>
            {t("dashboard.card.expiresOn", {
              date: new Date(credential.expiresAt).toLocaleDateString(dateLocale, { timeZone: "UTC" }),
            })}
          </span>
        ) : (
          <span className="text-text-muted">{t("dashboard.card.noExpiration")}</span>
        )}
      </div>
    </Link>
  );
}
