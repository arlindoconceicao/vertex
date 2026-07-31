"use client";

import Link from "next/link";
import { useTranslation } from "@/locales/LanguageContext";
import IssueCredentialForm from "@/components/credentials/IssueCredentialForm";

type SchemaOption = {
  id: string;
  name: string;
  version: string;
  fields: { name: string; type: string; required: boolean }[];
};

type Props = {
  schemas: SchemaOption[];
  initialHolderEmail?: string;
};

export default function IssueCredentialClientView({ schemas, initialHolderEmail }: Props) {
  const { t } = useTranslation();

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800 bg-gray-900">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center">
          <Link
            href="/dashboard"
            className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors"
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
          <h1 className="text-2xl font-bold">{t("credentials.issueTitle")}</h1>
          <p className="text-gray-400 text-sm mt-1">
            {t("credentials.issueSubtitle")}
          </p>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 sm:p-8">
          <IssueCredentialForm schemas={schemas} initialHolderEmail={initialHolderEmail} />
        </div>
      </main>
    </div>
  );
}
