"use client";

import { useState } from "react";
import { useTranslation } from "@/locales/LanguageContext";

export default function PublicLanguageSelector() {
  const { locale, availableLanguages, changeLanguage } = useTranslation();
  const [isChanging, setIsChanging] = useState(false);

  const currentLang = availableLanguages.find((l) => l.code === locale) || availableLanguages[0];

  async function handleSelectLanguage(newCode: string) {
    if (newCode === locale || isChanging) return;
    setIsChanging(true);
    await changeLanguage(newCode);
    setIsChanging(false);
  }

  return (
    <div className="relative inline-block text-left">
      <select
        value={locale}
        onChange={(e) => handleSelectLanguage(e.target.value)}
        disabled={isChanging}
        aria-label="Select language"
        className="bg-gray-800 border border-gray-700 text-gray-200 text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-ring cursor-pointer disabled:opacity-50 transition-colors"
      >
        {availableLanguages.map((lang) => (
          <option key={lang.code} value={lang.code} className="bg-surface text-white">
            {lang.flag ? `${lang.flag} ` : ""}{lang.name}
          </option>
        ))}
      </select>
    </div>
  );
}
