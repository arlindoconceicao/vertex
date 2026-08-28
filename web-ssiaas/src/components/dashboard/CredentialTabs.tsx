"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import type { DashboardCredential } from "@/lib/types";
import CredentialCard from "./CredentialCard";
import UserSearch from "@/components/UserSearch";
import { useTranslation } from "@/locales/LanguageContext";

type Tab = "received" | "issued";

type Props = {
  issued: DashboardCredential[];
  received: DashboardCredential[];
};

export default function CredentialTabs({ issued, received }: Props) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<Tab>("received");

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "received", label: t("dashboard.tabs.receivedCredentials"), count: received.length },
    { id: "issued",   label: t("dashboard.tabs.issuedCredentials"),   count: issued.length  },
  ];

  return (
    <div>
      {/* ── Seletor de abas ── */}
      <div className="flex gap-1 bg-surface border border-border rounded-xl p-1 w-fit mb-8">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          const isHolder = tab.id === "received";
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer ${
                isActive
                  ? "bg-surface-hover text-text-main shadow"
                  : "text-text-muted hover:text-text-main"
              }`}
            >
              {tab.label}
              <span
                className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                  isActive
                    ? isHolder
                      ? "bg-emerald-500/20 text-emerald-400"
                      : "bg-primary/20 text-primary-text"
                    : "bg-border text-text-muted"
                }`}
              >
                {tab.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Aba: Credenciais Recebidas (Holder) ── */}
      {activeTab === "received" && (
        <CredentialGrid
          credentials={received}
          perspective="received"
          emptyMessage={t("dashboard.tabs.emptyReceived")}
        />
      )}

      {/* ── Aba: Credenciais Emitidas (Issuer) ── */}
      {activeTab === "issued" && (
        <div className="space-y-8">

          {/* Ações do Issuer */}
          <div className="flex flex-wrap gap-3">
            <Link
              href="/schemas"
              className="flex items-center gap-2 bg-surface-hover hover:bg-border border border-border text-text-main text-sm font-medium px-4 py-2.5 rounded-xl transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
              </svg>
              {t("dashboard.tabs.viewSchemas")}
            </Link>
            <Link
              href="/schemas/new"
              className="flex items-center gap-2 bg-primary hover:bg-primary-hover text-white text-sm font-medium px-4 py-2.5 rounded-xl transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              {t("dashboard.tabs.createSchema")}
            </Link>
            <Link
              href="/credentials/issue"
              className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 text-white text-sm font-medium px-4 py-2.5 rounded-xl transition-colors border border-gray-700"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
              </svg>
              {t("dashboard.tabs.issueCredential")}
            </Link>
          </div>

          {/* Busca por CPF */}
          <div>
            <p className="text-sm text-text-muted mb-3">
              {t("dashboard.tabs.searchUserTitle")}
            </p>
            <UserSearch />
          </div>

          {/* Histórico de emissões */}
          <div>
            <p className="text-sm text-text-muted mb-4">{t("dashboard.tabs.issueHistory")}</p>
            <CredentialGrid
              credentials={issued}
              perspective="issued"
              emptyMessage={t("dashboard.tabs.emptyIssued")}
            />
          </div>

        </div>
      )}
    </div>
  );
}


type CredentialGridProps = {
  credentials: DashboardCredential[];
  perspective: "issued" | "received";
  emptyMessage: string;
};

const ITEMS_PER_PAGE = 6;

function CredentialGrid({ credentials, perspective, emptyMessage }: CredentialGridProps) {
  const { t } = useTranslation();

  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "ACTIVE" | "PENDING" | "REVOKED">("ALL");
  const [currentPage, setCurrentPage] = useState(1);

  // Filtragem reativa por contraparte, esquema, tipo, ID ou status
  const filteredCredentials = useMemo(() => {
    return credentials.filter((vc) => {
      if (statusFilter !== "ALL" && vc.status !== statusFilter) {
        return false;
      }
      if (searchTerm.trim()) {
        const term = searchTerm.toLowerCase().trim();
        const counterpart = perspective === "received" ? vc.issuer : vc.holder;
        const counterpartName = counterpart.name || "";
        const counterpartEmail = counterpart.email || "";
        const schemaName = vc.schemaSnapshot?.name || "";
        const schemaId = vc.schemaSnapshot?.id || "";
        const credentialType = vc.credentialType || "";
        const id = vc.id || "";

        return (
          counterpartName.toLowerCase().includes(term) ||
          counterpartEmail.toLowerCase().includes(term) ||
          schemaName.toLowerCase().includes(term) ||
          schemaId.toLowerCase().includes(term) ||
          credentialType.toLowerCase().includes(term) ||
          id.toLowerCase().includes(term)
        );
      }
      return true;
    });
  }, [credentials, searchTerm, statusFilter, perspective]);

  const handleSearchChange = (val: string) => {
    setSearchTerm(val);
    setCurrentPage(1);
  };

  const handleStatusChange = (val: "ALL" | "ACTIVE" | "PENDING" | "REVOKED") => {
    setStatusFilter(val);
    setCurrentPage(1);
  };

  const totalPages = Math.ceil(filteredCredentials.length / ITEMS_PER_PAGE) || 1;
  const paginatedCredentials = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredCredentials.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredCredentials, currentPage]);

  if (credentials.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center bg-surface border border-border rounded-2xl">
        <svg
          className="w-10 h-10 text-gray-700 mb-3"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-.623 3.05 3.745 3.745 0 01-3.05.623 3.745 3.745 0 01-3.068 1.593 3.745 3.745 0 01-3.068-1.593 3.745 3.745 0 01-3.05-.623 3.745 3.745 0 01-.623-3.05A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 01.623-3.05 3.745 3.745 0 013.05-.623A3.745 3.745 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.745 3.745 0 013.05.623 3.745 3.745 0 01.623 3.05A3.745 3.745 0 0121 12z"
          />
        </svg>
        <p className="text-text-subtle text-sm">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Barra de Filtros e Busca ── */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        {/* Seletor de Status */}
        <div className="relative shrink-0">
          <select
            value={statusFilter}
            onChange={(e) => handleStatusChange(e.target.value as "ALL" | "ACTIVE" | "PENDING" | "REVOKED")}
            className="w-full sm:w-auto bg-surface border border-border text-text-main rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-ring cursor-pointer transition-all"
          >
            <option value="ALL">{t("dashboard.filterStatusAll")}</option>
            <option value="ACTIVE">{t("dashboard.tabs.status.active")}</option>
            {perspective === "issued" && (
              <option value="PENDING">{t("dashboard.tabs.status.pending")}</option>
            )}
            <option value="REVOKED">{t("dashboard.tabs.status.revoked")}</option>
          </select>
        </div>

        {/* Campo de Busca */}
        <div className="relative w-full sm:w-80">
          <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
            <svg className="w-4 h-4 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
          </div>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder={t("dashboard.searchPlaceholder")}
            className="w-full bg-surface border border-border text-text-main placeholder-text-muted rounded-xl pl-10 pr-9 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-ring focus:border-transparent transition-all"
          />
          {searchTerm && (
            <button
              onClick={() => handleSearchChange("")}
              title={t("dashboard.clearSearch")}
              className="absolute inset-y-0 right-0 pr-3 flex items-center text-text-muted hover:text-text-main"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* ── Resultado da Busca ── */}
      {filteredCredentials.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center bg-surface border border-border rounded-2xl">
          <svg className="w-9 h-9 text-gray-600 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <p className="text-text-muted text-sm font-medium">{t("dashboard.noSearchResults")}</p>
          <div className="flex items-center gap-2 mt-3">
            {searchTerm && (
              <button
                onClick={() => handleSearchChange("")}
                className="text-xs font-medium text-primary-text hover:text-indigo-300 px-3 py-1.5 bg-indigo-950/80 border border-indigo-800 rounded-lg transition-colors"
              >
                {t("dashboard.clearSearch")}
              </button>
            )}
            {statusFilter !== "ALL" && (
              <button
                onClick={() => handleStatusChange("ALL")}
                className="text-xs font-medium text-text-muted hover:text-text-main px-3 py-1.5 bg-surface-hover border border-border rounded-lg transition-colors"
              >
                {t("dashboard.filterStatusAll")}
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {paginatedCredentials.map((vc) => (
              <CredentialCard key={vc.id} credential={vc} perspective={perspective} />
            ))}
          </div>

          {/* Paginação */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between bg-surface border border-border rounded-2xl px-5 py-3.5 text-sm">
              <button
                onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
                disabled={currentPage === 1}
                className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-surface-hover hover:bg-border disabled:opacity-40 disabled:hover:bg-surface-hover transition-colors cursor-pointer disabled:cursor-not-allowed"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                </svg>
                {t("dashboard.paginationPrevious")}
              </button>

              <span className="text-xs text-text-muted">
                {t("dashboard.paginationPage", { current: currentPage, total: totalPages })}
              </span>

              <button
                onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
                disabled={currentPage === totalPages}
                className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-surface-hover hover:bg-border disabled:opacity-40 disabled:hover:bg-surface-hover transition-colors cursor-pointer disabled:cursor-not-allowed"
              >
                {t("dashboard.paginationNext")}
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="8.25 4.5l7.5 7.5-7.5 7.5" />
                </svg>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}