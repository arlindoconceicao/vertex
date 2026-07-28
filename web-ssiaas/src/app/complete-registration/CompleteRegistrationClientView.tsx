"use client";

import { useTranslation } from "@/locales/LanguageContext";
import CpfForm from "./CpfForm";

type Props = {
  userName?: string | null;
  userEmail?: string | null;
  userImage?: string | null;
};

export default function CompleteRegistrationClientView({
  userName,
  userEmail,
  userImage,
}: Props) {
  const { t } = useTranslation();

  return (
    <main className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-indigo-600 mb-4">
            <svg
              className="w-8 h-8 text-white"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"
              />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">
            {t("auth.completeProfileTitle")}
          </h1>
          <p className="text-gray-400 mt-2 text-sm">
            {t("auth.completeProfileSubtitle")}
          </p>
        </div>

        {/* Card */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 shadow-xl">
          <div className="flex items-center gap-3 bg-gray-800 rounded-xl px-4 py-3 mb-6">
            {userImage && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={userImage}
                alt="Profile"
                className="w-9 h-9 rounded-full"
              />
            )}
            <div className="min-w-0">
              <p className="text-sm font-medium text-white truncate">
                {userName}
              </p>
              <p className="text-xs text-gray-400 truncate">{userEmail}</p>
            </div>
          </div>

          <CpfForm />
        </div>
      </div>
    </main>
  );
}
