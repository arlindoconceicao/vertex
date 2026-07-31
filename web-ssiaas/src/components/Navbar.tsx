"use client";

import Link from "next/link";
import { signOut } from "next-auth/react";
import { useTranslation } from "@/locales/LanguageContext";

type NavbarProps = {
  userName?: string | null;
  userImage?: string | null;
};

export default function Navbar({ userName, userImage }: NavbarProps) {
  const { t, locale } = useTranslation();

  return (
    <header className="border-b border-gray-800 bg-gray-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <Link href="/dashboard" className="flex items-center gap-3">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-indigo-600">
            <svg
              className="w-4 h-4 text-white"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.955 11.955 0 003 10c0 5.592 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"
              />
            </svg>
          </div>
          <span className="font-semibold tracking-tight text-white">
            {t("common.appName")}
          </span>
        </Link>

        <div className="flex items-center gap-4">
          {userName && (
            <div className="hidden sm:flex items-center gap-2">
              {userImage && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={userImage}
                  alt={t("common.profileAlt")}
                  className="w-8 h-8 rounded-full"
                />
              )}
              <span className="text-sm text-gray-300">{userName}</span>
            </div>
          )}

          <Link
            href="/settings"
            className="text-sm text-gray-400 hover:text-white transition-colors"
          >
            {t("nav.settings")}
          </Link>

          <button
            type="button"
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="text-sm text-gray-400 hover:text-white transition-colors cursor-pointer"
          >
            {t("nav.logout")}
          </button>

          <span className="text-xs font-semibold text-indigo-400 px-2 py-0.5 rounded bg-indigo-950 border border-indigo-800 uppercase">
            {locale}
          </span>
        </div>
      </div>
    </header>
  );
}
