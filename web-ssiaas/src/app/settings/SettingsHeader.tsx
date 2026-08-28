"use client";

import { useTranslation } from "@/locales/LanguageContext";

export default function SettingsHeader() {
  const { t } = useTranslation();

  return (
    <div>
      <h1 className="text-2xl font-bold">{t("settings.title")}</h1>
      <p className="text-text-muted text-sm mt-1">{t("settings.subtitle")}</p>
    </div>
  );
}
