"use client";

import { useTranslation } from "@/locales/LanguageContext";

type DashboardHeaderProps = {
  userName?: string | null;
};

export default function DashboardHeader({ userName }: DashboardHeaderProps) {
  const { t } = useTranslation();
  const firstName = userName?.split(" ")[0] || "";

  return (
    <div>
      <h1 className="text-2xl font-bold">
        {t("dashboard.greeting", { name: firstName })}
      </h1>
      <p className="text-gray-400 text-sm mt-1">{t("dashboard.subtitle")}</p>
    </div>
  );
}
