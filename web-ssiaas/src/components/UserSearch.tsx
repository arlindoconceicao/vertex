"use client";

import { useState, useTransition, useCallback } from "react";
import { searchUsers, type UserSearchResult } from "@/app/actions/search-users";
import { useTranslation } from "@/locales/LanguageContext";
import Link from "next/link";

export default function UserSearch() {
  const { t } = useTranslation();
  const [cpf, setCpf] = useState("");
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Dispara a busca quando atinge 11 dígitos.
  const handleCpfChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const digits = e.target.value.replace(/\D/g, "").slice(0, 11);

    const masked = digits
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d{1,2})$/, "$1-$2");

    setCpf(masked);
    setError(null);

    if (digits.length < 11) {
      setResults([]);
      return;
    }

    startTransition(async () => {
      const result = await searchUsers(digits);
      if (result.success) {
        setResults(result.users);
      } else {
        setError(result.error);
        setResults([]);
      }
    });
  }, []);

  return (
    <div className="relative w-full">
      {/* Input com máscara de CPF */}
      <div className="relative">
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
          />
        </svg>
        <input
          type="text"
          inputMode="numeric"
          value={cpf}
          onChange={handleCpfChange}
          placeholder={t("dashboard.tabs.searchUserPlaceholder")}
          className="w-full bg-gray-800 border border-gray-700 text-white placeholder-gray-500 rounded-xl pl-10 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition"
        />
        {isPending && (
          <svg
            className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-indigo-400 animate-spin"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8v8z"
            />
          </svg>
        )}
      </div>

      {/* Erro */}
      {error && <p className="text-red-400 text-xs mt-2 px-1">{error}</p>}

      {/* Resultado encontrado */}
      {results.length > 0 && (
        <div className="absolute z-10 w-full mt-2 bg-gray-900 border border-gray-700 rounded-xl shadow-xl overflow-hidden">
          {results.map((user) => (
            <div
              key={user.id}
              className="flex items-center gap-3 px-4 py-3 hover:bg-gray-800 transition-colors cursor-pointer"
            >
              {user.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={user.image}
                  alt={user.name ?? "User"}
                  className="w-8 h-8 rounded-full shrink-0"
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-indigo-700 flex items-center justify-center shrink-0">
                  <span className="text-white text-xs font-medium">
                    {user.name?.[0]?.toUpperCase() ?? "?"}
                  </span>
                </div>
              )}
              <div className="min-w-0">
                <p className="text-sm font-medium text-white truncate flex items-center gap-1.5">
                  {user.name ?? "No name"}
                  {user.isSelf && (
                    <span className="text-[10px] font-medium bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 px-1.5 py-0.5 rounded-md">
                      ({t("credentials.you")})
                    </span>
                  )}
                </p>
                <p className="text-xs text-gray-400 truncate">{user.email}</p>
                <p className="text-xs text-gray-500">
                  {t("common.cpfLabel")} {user.cpf?.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4")}
                </p>
              </div>

              <Link
                href={`/credentials/issue?holder=${encodeURIComponent(user.email || "")}`}
                className="ml-auto text-xs font-medium text-indigo-400 hover:text-indigo-300 transition-colors shrink-0 bg-indigo-950/80 border border-indigo-800 px-3 py-1.5 rounded-lg"
              >
                {t("dashboard.tabs.issueCredential")} →
              </Link>
            </div>
          ))}
        </div>
      )}

      {/* CPF completo mas sem resultados */}
      {!isPending &&
        cpf.replace(/\D/g, "").length === 11 &&
        results.length === 0 &&
        !error && (
          <div className="absolute z-10 w-full mt-2 bg-gray-900 border border-gray-700 rounded-xl px-4 py-6 text-center">
            <p className="text-gray-500 text-sm">{t("common.userNotFound")}</p>
          </div>
        )}
    </div>
  );
}