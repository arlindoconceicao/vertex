"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useTranslation } from "@/locales/LanguageContext";

type SchemaItem = {
  id: string;
  name: string;
  version: string;
  visibility: "PUBLIC" | "PRIVATE";
  storageLocation: "LOCAL" | "IPFS";
  publishedAt: Date | null;
  createdAt: Date;
  creator: { id: string; name: string | null };
};

type Props = {
  schemas: SchemaItem[];
  userId: string;
};

type FilterScope = "ALL" | "MINE" | "PUBLIC" | "PRIVATE";

const ITEMS_PER_PAGE = 9;

export default function SchemasClientView({ schemas, userId }: Props) {
  const { t, locale } = useTranslation();
  const dateLocale = locale === "pt" ? "pt-BR" : locale === "es" ? "es-ES" : "en-US";

  const [searchTerm, setSearchTerm] = useState("");
  const [filterScope, setFilterScope] = useState<FilterScope>("ALL");
  const [currentPage, setCurrentPage] = useState(1);

  // Filtragem dinâmica por Nome/ID e Escopo de Visibilidade/Posse
  const filteredSchemas = useMemo(() => {
    return schemas.filter((s) => {
      const isMine = s.creator.id === userId;
      if (filterScope === "MINE" && !isMine) return false;
      if (filterScope === "PUBLIC" && s.visibility !== "PUBLIC") return false;
      if (filterScope === "PRIVATE" && (s.visibility !== "PRIVATE" || !isMine)) return false;

      if (searchTerm.trim()) {
        const term = searchTerm.toLowerCase().trim();
        return (
          s.name.toLowerCase().includes(term) ||
          s.id.toLowerCase().includes(term)
        );
      }
      return true;
    });
  }, [schemas, searchTerm, filterScope, userId]);

  const handleSearchChange = (val: string) => {
    setSearchTerm(val);
    setCurrentPage(1);
  };

  const handleFilterChange = (val: FilterScope) => {
    setFilterScope(val);
    setCurrentPage(1);
  };

  const totalPages = Math.ceil(filteredSchemas.length / ITEMS_PER_PAGE) || 1;
  const paginatedSchemas = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredSchemas.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredSchemas, currentPage]);

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800 bg-gray-900">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <Link
            href="/dashboard"
            className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
            {t("common.dashboard")}
          </Link>
          <Link
            href="/schemas/new"
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-4 py-2 rounded-xl transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            {t("schemas.newTitle")}
          </Link>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-bold">{t("schemas.title")}</h1>
            <p className="text-gray-400 text-sm mt-1">
              {t("schemas.newSubtitle")}
            </p>
          </div>

          {schemas.length > 0 && (
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full lg:w-auto">
              {/* Seletor de Filtro por Visibilidade/Posse */}
              <div className="relative shrink-0">
                <select
                  value={filterScope}
                  onChange={(e) => handleFilterChange(e.target.value as FilterScope)}
                  className="w-full sm:w-auto bg-gray-900 border border-gray-800 text-white rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer transition-all"
                >
                  <option value="ALL">{t("schemas.filterAll")}</option>
                  <option value="MINE">{t("schemas.filterMine")}</option>
                  <option value="PUBLIC">{t("schemas.filterPublic")}</option>
                  <option value="PRIVATE">{t("schemas.filterPrivate")}</option>
                </select>
              </div>

              {/* Campo de Busca */}
              <div className="relative w-full sm:w-72">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                  <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                  </svg>
                </div>
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  placeholder={t("schemas.searchPlaceholder")}
                  className="w-full bg-gray-900 border border-gray-800 text-white placeholder-gray-500 rounded-xl pl-10 pr-9 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                />
                {searchTerm && (
                  <button
                    onClick={() => handleSearchChange("")}
                    title={t("schemas.clearSearch")}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-white"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {schemas.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center bg-gray-900 border border-gray-800 rounded-2xl">
            <svg className="w-10 h-10 text-gray-700 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
            <p className="text-gray-500 text-sm">{t("schemas.emptySchemas")}</p>
            <Link href="/schemas/new" className="text-indigo-400 hover:text-indigo-300 text-sm mt-2">
              {t("schemas.createTitle")} →
            </Link>
          </div>
        ) : filteredSchemas.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center bg-gray-900 border border-gray-800 rounded-2xl">
            <svg className="w-9 h-9 text-gray-600 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <p className="text-gray-400 text-sm font-medium">{t("schemas.noSearchResults")}</p>
            <div className="flex items-center gap-2 mt-3">
              {searchTerm && (
                <button
                  onClick={() => handleSearchChange("")}
                  className="text-xs font-medium text-indigo-400 hover:text-indigo-300 px-3 py-1.5 bg-indigo-950/80 border border-indigo-800 rounded-lg transition-colors"
                >
                  {t("schemas.clearSearch")}
                </button>
              )}
              {filterScope !== "ALL" && (
                <button
                  onClick={() => handleFilterChange("ALL")}
                  className="text-xs font-medium text-gray-400 hover:text-white px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg transition-colors"
                >
                  {t("schemas.filterAll")}
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {paginatedSchemas.map((schema) => {
                const isMine = schema.creator.id === userId;
                return (
                  <Link
                    key={schema.id}
                    href={`/schemas/${schema.id}`}
                    className="bg-gray-900 border border-gray-800 rounded-2xl p-5 hover:border-gray-700 transition-colors flex flex-col gap-3 group"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-white group-hover:text-indigo-300 transition-colors truncate">
                          {schema.name}
                        </p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          v{schema.version}
                        </p>
                      </div>
                      <div className="flex gap-1.5 shrink-0">
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                            schema.visibility === "PUBLIC"
                              ? "bg-emerald-500/10 text-emerald-400"
                              : "bg-gray-700 text-gray-400"
                          }`}
                        >
                          {schema.visibility === "PUBLIC" ? t("schemas.public") : t("schemas.private")}
                        </span>
                        {schema.storageLocation === "IPFS" && (
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-indigo-500/10 text-indigo-400">
                            IPFS
                          </span>
                        )}
                      </div>
                    </div>

                    {/* ID do Esquema */}
                    <div className="bg-gray-800/50 rounded-lg px-2.5 py-1.5 text-xs text-gray-400 font-mono truncate">
                      <span className="text-gray-500 font-sans mr-1">{t("schemas.schemaId")}:</span>
                      {schema.id}
                    </div>

                    <div className="flex items-center justify-between text-xs text-gray-500 mt-auto pt-1">
                      <span>{isMine ? t("schemas.createdByYou") : `${t("schemas.createdBy")} ${schema.creator.name}`}</span>
                      <span suppressHydrationWarning>
                        {new Date(schema.createdAt).toLocaleDateString(dateLocale)}
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>

            {/* Paginação */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between bg-gray-900 border border-gray-800 rounded-2xl px-5 py-3.5 mt-6 text-sm">
                <button
                  onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
                  disabled={currentPage === 1}
                  className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-40 disabled:hover:bg-gray-800 transition-colors cursor-pointer disabled:cursor-not-allowed"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                  </svg>
                  {t("schemas.paginationPrevious")}
                </button>

                <span className="text-xs text-gray-400">
                  {t("schemas.paginationPage", { current: currentPage, total: totalPages })}
                </span>

                <button
                  onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
                  disabled={currentPage === totalPages}
                  className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-40 disabled:hover:bg-gray-800 transition-colors cursor-pointer disabled:cursor-not-allowed"
                >
                  {t("schemas.paginationNext")}
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                  </svg>
                </button>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
