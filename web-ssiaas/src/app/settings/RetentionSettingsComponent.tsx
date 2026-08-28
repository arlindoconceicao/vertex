"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/locales/LanguageContext";

export default function RetentionSettingsComponent({ initialDays }: { initialDays: number }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [days, setDays] = useState(initialDays);
  const [isPending, startTransition] = useTransition();
  const [statusMsg, setStatusMsg] = useState("");

  const handleSave = () => {
    startTransition(async () => {
      setStatusMsg("");
      try {
        const res = await fetch("/api/settings/retention", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pdfRetentionDays: days }),
        });
        if (res.ok) {
          setStatusMsg("Configurações de retenção salvas com sucesso!");
          router.refresh();
        } else {
          setStatusMsg("Erro ao salvar as configurações.");
        }
      } catch (e) {
        setStatusMsg("Erro de conexão ao salvar.");
      }
    });
  };

  return (
    <div className="bg-surface border border-border rounded-2xl p-6 mt-6">
      <h2 className="text-lg font-bold text-text-main mb-2">
        {t("settings.retention.title")}
      </h2>
      <p className="text-sm text-text-muted mb-8 leading-relaxed">
        {t("settings.retention.description")}
      </p>

      <div className="flex items-center gap-4">
        <input
          type="range"
          min="1"
          max="15"
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="w-full h-2 bg-border-hover rounded-lg appearance-none cursor-pointer"
        />
        <span className="text-text-main font-mono font-medium text-lg w-16 text-center">
          {days} {days === 1 ? t("settings.retention.days").replace(/s$/, "") : t("settings.retention.days")}
        </span>
      </div>

      <div className="mt-6 flex items-center justify-between">
        <span className="text-sm text-emerald-400">{statusMsg}</span>
        <button
          onClick={handleSave}
          disabled={isPending || days === initialDays && !statusMsg}
          className="px-4 py-2 bg-primary hover:bg-primary-hover disabled:bg-surface-hover disabled:text-text-subtle text-white rounded-lg transition-colors text-sm font-medium"
        >
          {isPending ? t("common.saving") : t("common.save")}
        </button>
      </div>
    </div>
  );
}
