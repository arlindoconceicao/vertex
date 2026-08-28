"use client";

import { useState } from "react";
import { useTranslation } from "@/locales/LanguageContext";

export default function LanguageSettingsTab() {
  const { locale, availableLanguages, changeLanguage, t } = useTranslation();
  const [isChanging, setIsChanging] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(
    null
  );

  async function handleSelectLanguage(newCode: string) {
    if (newCode === locale || isChanging) return;

    setIsChanging(true);
    setFeedback(null);

    const success = await changeLanguage(newCode);
    setIsChanging(false);

    if (success) {
      setFeedback({
        type: "success",
        message: t("settings.languageSection.changeSuccess"),
      });
      setTimeout(() => setFeedback(null), 4000);
    } else {
      setFeedback({
        type: "error",
        message: t("settings.languageSection.changeError"),
      });
    }
  }

  return (
    <div className="space-y-6">
      <div className="bg-surface border border-border rounded-2xl p-6 space-y-6">
        <div>
          <h2 className="text-lg font-semibold text-text-main">
            {t("settings.languageSection.title")}
          </h2>
          <p className="text-sm text-text-muted mt-1">
            {t("settings.languageSection.subtitle")}
          </p>
        </div>

        {feedback && (
          <div
            className={`px-4 py-3 rounded-xl text-sm font-medium transition-all ${
              feedback.type === "success"
                ? "bg-emerald-950/80 border border-emerald-800 text-emerald-300"
                : "bg-red-950/80 border border-red-800 text-red-300"
            }`}
          >
            {feedback.message}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {availableLanguages.map((lang) => {
            const isSelected = lang.code === locale;
            return (
              <button
                key={lang.code}
                type="button"
                onClick={() => handleSelectLanguage(lang.code)}
                disabled={isChanging}
                className={`flex items-center justify-between p-5 rounded-2xl border transition-all cursor-pointer text-left ${
                  isSelected
                    ? "bg-primary/10 border-primary text-text-main shadow-lg ring-1 ring-primary-ring/50"
                    : "bg-surface-hover border-border text-text-main hover:bg-border hover:border-border-hover"
                } ${isChanging ? "opacity-60 cursor-wait" : ""}`}
              >
                <div className="flex items-center gap-4">
                  <span className="text-3xl select-none" role="img" aria-label={lang.name}>
                    {lang.flag || "🌐"}
                  </span>
                  <div>
                    <p className="font-semibold text-base text-text-main">{lang.name}</p>
                    <p className="text-xs text-text-muted uppercase tracking-wider mt-0.5">
                      {lang.code}
                    </p>
                  </div>
                </div>

                {isSelected && (
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-text-main bg-primary/20 px-3 py-1.5 rounded-full border border-primary/30">
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2.5}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M4.5 12.75l6 6 9-13.5"
                      />
                    </svg>
                    <span>{t("settings.languageSection.currentLanguage")}</span>
                  </div>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2 pt-2 text-xs text-text-subtle border-t border-border/60">
          <svg
            className="w-4 h-4 text-primary-text flex-shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <span>{t("settings.languageSection.autoDiscoveryNotice")}</span>
        </div>
      </div>
    </div>
  );
}
