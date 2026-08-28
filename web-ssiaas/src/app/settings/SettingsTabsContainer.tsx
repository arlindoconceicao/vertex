"use client";

import { useState } from "react";
import { useTranslation } from "@/locales/LanguageContext";
import DidPairingComponent from "./DidPairingComponent";
import LanguageSettingsTab from "./LanguageSettingsTab";
import RetentionSettingsComponent from "./RetentionSettingsComponent";
import DidDocumentTab from "./DidDocumentTab";

type Props = {
  user: {
    id: string;
    email: string;
    cpf: string | null;
    did: string | null;
    didPublicKey: string | null;
    didMlkemKey: string | null;
    didPairedAt: string | null;
    issuerIdentifier?: string | null;
    pdfRetentionDays: number;
    bearerToken?: string | null;
    didDocument?: any;
    didIpfsCid?: string | null;
    didPinataFileId?: string | null;
    didPublishedAt?: string | null;
  };
  gatewayUrl: string;
};

export default function SettingsTabsContainer({ user, gatewayUrl }: Props) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<"profile" | "language" | "platform" | "document">("profile");

  return (
    <div className="space-y-8">
      {/* Settings Navigation Tabs */}
      <div className="border-b border-border">
        <nav className="flex space-x-8" aria-label={t("settings.tabsAriaLabel")}>
          <button
            type="button"
            onClick={() => setActiveTab("profile")}
            className={`pb-4 px-1 border-b-2 font-medium text-sm transition-colors cursor-pointer flex items-center gap-2 ${
              activeTab === "profile"
                ? "border-primary text-primary-text font-semibold"
                : "border-transparent text-text-muted hover:text-gray-200 hover:border-border-hover"
            }`}
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
                d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"
              />
            </svg>
            {t("settings.tabs.profile")}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("language")}
            className={`pb-4 px-1 border-b-2 font-medium text-sm transition-colors cursor-pointer flex items-center gap-2 ${
              activeTab === "language"
                ? "border-primary text-primary-text font-semibold"
                : "border-transparent text-text-muted hover:text-gray-200 hover:border-border-hover"
            }`}
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
                d="M10.5 21l5.25-11.25L21 21m-9-3h7.5M3 5.621a24.12 24.12 0 017.5 0m3-3v3.375m-6.75 3a24.12 24.12 0 016.75 0"
              />
            </svg>
            {t("settings.tabs.language")}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("platform")}
            className={`pb-4 px-1 border-b-2 font-medium text-sm transition-colors cursor-pointer flex items-center gap-2 ${
              activeTab === "platform"
                ? "border-primary text-primary-text font-semibold"
                : "border-transparent text-text-muted hover:text-gray-200 hover:border-border-hover"
            }`}
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
                d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01"
              />
            </svg>
            {t("settings.tabs.platform")}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("document")}
            className={`pb-4 px-1 border-b-2 font-medium text-sm transition-colors cursor-pointer flex items-center gap-2 ${
              activeTab === "document"
                ? "border-primary text-primary-text font-semibold"
                : "border-transparent text-text-muted hover:text-gray-200 hover:border-border-hover"
            }`}
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
            {t("settings.tabs.document")}
          </button>
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === "profile" ? (
        <div className="space-y-8">
          {/* Profile Details — Read-only */}
          <div className="bg-surface border border-border rounded-2xl p-6">
            <h2 className="text-sm font-semibold text-text-main mb-4">
              {t("settings.profileSection.title")}
            </h2>
            <div className="space-y-3">
              <div className="flex items-center justify-between bg-surface-hover border border-border rounded-xl px-4 py-3">
                <span className="text-sm text-text-muted">
                  {t("settings.profileSection.userId")}
                </span>
                <span className="text-sm text-primary-text font-mono select-all">
                  {user.id}
                </span>
              </div>
              <div className="flex items-center justify-between bg-surface-hover border border-border rounded-xl px-4 py-3">
                <span className="text-sm text-text-muted">
                  {t("settings.profileSection.email")}
                </span>
                <span className="text-sm text-text-main">{user.email}</span>
              </div>
              {user.cpf && (
                <div className="flex items-center justify-between bg-surface-hover border border-border rounded-xl px-4 py-3">
                  <span className="text-sm text-text-muted">
                    {t("settings.profileSection.cpf")}
                  </span>
                  <span className="text-sm text-text-main font-mono">
                    {user.cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4")}
                  </span>
                </div>
              )}
              {user.bearerToken && (
                <div className="bg-surface-hover border border-border border border-indigo-900/50 rounded-xl px-4 py-3 space-y-1">
                  <p className="text-xs text-primary-text font-medium uppercase tracking-wider">
                    {t("settings.profileSection.hmacToken")}
                  </p>
                  <p className="text-sm text-primary-text font-mono break-all select-all">
                    {user.bearerToken}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* DID & Mobile Pairing Section */}
          <div className="bg-surface border border-border rounded-2xl p-6">
            <h2 className="text-sm font-semibold text-text-main mb-1">
              {t("settings.didSection.title")}
            </h2>
            <p className="text-xs text-text-subtle mb-6">
              {t("settings.didSection.subtitle")}
            </p>

            <DidPairingComponent
              userId={user.id}
              userEmail={user.email}
              initialDid={user.did}
              initialPublicKey={user.didPublicKey}
              initialMlkemKey={user.didMlkemKey}
              initialPairedAt={user.didPairedAt}
              initialIssuerIdentifier={user.issuerIdentifier}
              bearerToken={user.bearerToken}
            />
          </div>
        </div>
      ) : activeTab === "language" ? (
        <LanguageSettingsTab />
      ) : activeTab === "document" ? (
        <DidDocumentTab
          didDocument={user.didDocument}
          didIpfsCid={user.didIpfsCid}
          didPinataFileId={user.didPinataFileId}
          didPublishedAt={user.didPublishedAt}
          gatewayUrl={gatewayUrl}
        />
      ) : activeTab === "platform" ? (
        <div className="space-y-8">
          <RetentionSettingsComponent initialDays={user.pdfRetentionDays} />
        </div>
      ) : null}
    </div>
  );
}
