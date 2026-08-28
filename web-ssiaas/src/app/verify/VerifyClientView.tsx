"use client";

import Link from "next/link";
import { useTranslation } from "@/locales/LanguageContext";
import VerifierForm from "@/components/verifier/VerifierForm";
import Footer from "@/components/Footer";
import PublicLanguageSelector from "@/components/PublicLanguageSelector";

export default function VerifyClientView() {
  const { t } = useTranslation();

  return (
    <div data-theme="dark" className="min-h-screen bg-base text-text-main flex flex-col justify-between">
      <div>
        <header className="border-b border-border bg-surface">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary">
                <svg
                  className="w-4 h-4 text-white"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.955 11.955 0 003 10c0 5.592 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"
                  />
                </svg>
              </div>
              <span className="font-semibold tracking-tight">
                {t("common.appName")}
              </span>
            </div>
            <div className="flex items-center gap-4">
              <PublicLanguageSelector />
              <Link
                href="/login"
                className="text-sm text-text-muted hover:text-text-main transition-colors"
              >
                {t("common.login")}
              </Link>
            </div>
          </div>
        </header>

        <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
          <div className="text-center mb-10">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/20 mb-4">
              <svg
                className="w-7 h-7 text-primary-text"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.955 11.955 0 003 10c0 5.592 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"
                />
              </svg>
            </div>
            <h1 className="text-2xl font-bold">{t("verify.title")}</h1>
            <p className="text-text-muted text-sm mt-2 max-w-md mx-auto">
              {t("verify.subtitle")}
            </p>
          </div>

          <div className="bg-surface border border-border rounded-2xl p-6 sm:p-8">
            <VerifierForm />
          </div>
        </main>
      </div>

      <Footer />
    </div>
  );
}
