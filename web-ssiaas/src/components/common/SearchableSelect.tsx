"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { useTranslation } from "@/locales/LanguageContext";

export type SearchableOption = {
  id: string;
  name: string;
  version: string;
};

type Props = {
  options: SearchableOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  emptyMessage?: string;
};

export default function SearchableSelect({
  options,
  value,
  onChange,
  placeholder,
  emptyMessage,
}: Props) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((opt) => opt.id === value);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filteredOptions = useMemo(() => {
    let result = options;
    if (searchTerm) {
      const lowerSearch = searchTerm.toLowerCase();
      result = options.filter(
        (opt) =>
          opt.name.toLowerCase().includes(lowerSearch) ||
          opt.version.toLowerCase().includes(lowerSearch)
      );
    }
    return result;
  }, [options, searchTerm]);

  const displayedOptions = filteredOptions.slice(0, 50);
  const hasMoreOptions = filteredOptions.length > 50;

  return (
    <div className="relative" ref={containerRef}>
      {/* Selector button / Input */}
      <div
        className="w-full bg-surface border border-border rounded-xl px-4 py-3 text-sm flex items-center justify-between cursor-pointer focus-within:ring-2 focus-within:ring-primary-ring focus-within:outline-none transition"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-text-main">
          {selectedOption ? (
            <span>
              {selectedOption.name} <span className="text-text-muted">(v{selectedOption.version})</span>
            </span>
          ) : (
            <span className="text-text-muted">{placeholder || t("common.select")}</span>
          )}
        </div>
        <svg
          className={`w-4 h-4 text-text-muted transition-transform duration-200 ${
            isOpen ? "rotate-180" : ""
          }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      {/* Dropdown menu */}
      {isOpen && (
        <div className="absolute z-50 w-full mt-2 bg-surface border border-border rounded-xl shadow-lg shadow-black/10 overflow-hidden">
          <div className="p-2 border-b border-border">
            <div className="relative">
              <svg
                className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
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
                autoFocus
                className="w-full bg-base border border-border text-text-main placeholder-text-muted rounded-lg pl-9 pr-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary-ring transition"
                placeholder={t("common.search") || "Buscar..."}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onClick={(e) => e.stopPropagation()} // Prevent toggling the dropdown
              />
            </div>
          </div>
          <ul className="max-h-60 overflow-y-auto py-1 custom-scrollbar">
            {displayedOptions.length > 0 ? (
              <>
                {displayedOptions.map((opt) => (
                  <li
                    key={opt.id}
                    onClick={() => {
                      onChange(opt.id);
                      setIsOpen(false);
                      setSearchTerm("");
                    }}
                    className={`px-4 py-2 text-sm cursor-pointer hover:bg-surface-hover transition-colors ${
                      value === opt.id ? "bg-primary/10 text-primary" : "text-text-main"
                    }`}
                  >
                    <div className="font-medium">{opt.name}</div>
                    <div className="text-xs text-text-muted">v{opt.version}</div>
                  </li>
                ))}
                {hasMoreOptions && (
                  <li className="px-4 py-2 text-xs text-text-subtle text-center italic border-t border-border mt-1">
                    {t("schemas.moreOptionsAvailable") || "Mais resultados ocultos. Use a busca para filtrar."}
                  </li>
                )}
              </>
            ) : (
              <li className="px-4 py-3 text-sm text-text-muted text-center">
                {emptyMessage || t("common.noResults") || "Nenhum resultado encontrado"}
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
