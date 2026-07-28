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
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-6">
        <div>
          <h2 className="text-lg font-semibold text-white">
            {t("settings.languageSection.title")}
          </h2>
          <p className="text-sm text-gray-400 mt-1">
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
                    ? "bg-indigo-950/50 border-indigo-500 text-white shadow-lg shadow-indigo-500/10 ring-1 ring-indigo-500/50"
                    : "bg-gray-800/40 border-gray-800 text-gray-300 hover:bg-gray-800/80 hover:border-gray-700"
                } ${isChanging ? "opacity-60 cursor-wait" : ""}`}
              >
                <div className="flex items-center gap-4">
                  <span className="text-3xl select-none" role="img" aria-label={lang.name}>
                    {lang.flag || "🌐"}
                  </span>
                  <div>
                    <p className="font-semibold text-base">{lang.name}</p>
                    <p className="text-xs text-gray-400 uppercase tracking-wider mt-0.5">
                      {lang.code}
                    </p>
                  </div>
                </div>

                {isSelected && (
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-indigo-400 bg-indigo-900/60 px-3 py-1.5 rounded-full border border-indigo-700/60">
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

        <div className="flex items-center gap-2 pt-2 text-xs text-gray-500 border-t border-gray-800/60">
          <svg
            className="w-4 h-4 text-indigo-400 flex-shrink-0"
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
