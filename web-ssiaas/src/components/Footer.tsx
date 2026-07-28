"use client";

import { useTranslation } from "@/locales/LanguageContext";

export default function Footer() {
  const { t } = useTranslation();

  return (
    <footer className="border-t border-gray-800 mt-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-12 flex items-center justify-between">
        <span className="text-xs text-gray-600">{t("common.footerText")}</span>
        <span className="text-xs text-gray-600">{t("common.fundedBy")}</span>
      </div>
    </footer>
  );
}
