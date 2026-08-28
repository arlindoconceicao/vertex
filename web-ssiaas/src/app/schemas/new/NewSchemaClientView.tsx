"use client";

import Link from "next/link";
import { useTranslation } from "@/locales/LanguageContext";
import SchemaForm from "@/components/schemas/SchemaForm";

export default function NewSchemaClientView() {
  const { t } = useTranslation();

  return (
    <div className="min-h-screen bg-base text-text-main">
      <header className="border-b border-border bg-surface">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center">
          <Link
            href="/dashboard"
            className="flex items-center gap-2 text-sm text-text-muted hover:text-text-main transition-colors"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15.75 19.5L8.25 12l7.5-7.5"
              />
            </svg>
            {t("common.backToDashboard")}
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-bold">{t("schemas.newTitle")}</h1>
          <p className="text-text-muted text-sm mt-1">{t("schemas.newSubtitle")}</p>
        </div>

        <div className="bg-surface border border-border rounded-2xl p-6 sm:p-8">
          <SchemaForm />
        </div>
      </main>
    </div>
  );
}
