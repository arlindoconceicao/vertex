"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { useTranslation } from "@/locales/LanguageContext";

export default function ThemeSelector() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const { t } = useTranslation();

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <div className="w-[140px] h-8 bg-surface-hover animate-pulse rounded-lg"></div>;
  }

  return (
    <div className="relative">
      <select
        value={theme}
        onChange={(e) => setTheme(e.target.value)}
        className="appearance-none bg-surface border border-border text-text-muted hover:text-text-main text-sm rounded-lg pl-3 pr-8 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer transition-colors"
      >
        <option value="dark">{t("themes.dark")}</option>
        <option value="light">{t("themes.light")}</option>
        <option value="dark-emerald">{t("themes.darkEmerald")}</option>
        <option value="light-emerald">{t("themes.lightEmerald")}</option>
      </select>
      <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-text-muted">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path>
        </svg>
      </div>
    </div>
  );
}
