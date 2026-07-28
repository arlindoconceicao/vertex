"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { useRouter } from "next/navigation";
import { LanguageMeta } from "./registry";

type Dictionary = Record<string, any>;

interface LanguageContextType {
  locale: string;
  availableLanguages: LanguageMeta[];
  dictionary: Dictionary;
  fallbackDictionary: Dictionary;
  changeLanguage: (newLocale: string) => Promise<boolean>;
  t: (keyPath: string, vars?: Record<string, string | number>) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

interface LanguageProviderProps {
  children: ReactNode;
  initialLocale: string;
  initialAvailableLanguages: LanguageMeta[];
  initialDictionary: Dictionary;
  initialFallbackDictionary?: Dictionary;
}

export function LanguageProvider({
  children,
  initialLocale,
  initialAvailableLanguages,
  initialDictionary,
  initialFallbackDictionary = {},
}: LanguageProviderProps) {
  const router = useRouter();
  const [locale, setLocale] = useState<string>(initialLocale || "en");
  const [availableLanguages, setAvailableLanguages] = useState<LanguageMeta[]>(
    initialAvailableLanguages || [{ code: "en", name: "English", flag: "🇺🇸" }]
  );

  // Update client locale from cookies or DB on mount if needed
  useEffect(() => {
    if (typeof window !== "undefined") {
      document.documentElement.lang = locale;
    }
  }, [locale]);

  const changeLanguage = async (newLocale: string): Promise<boolean> => {
    if (newLocale === locale) return true;

    try {
      // 1. Update user preference in Database via API
      const res = await fetch("/api/users/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: newLocale }),
      });

      if (!res.ok) {
        console.warn("Failed to persist language preference to database.");
      }

      // 2. Set cookie for SSR middleware / Server Components
      document.cookie = `NEXT_LOCALE=${newLocale}; path=/; max-age=31536000`;
      localStorage.setItem("user_language", newLocale);

      setLocale(newLocale);

      // 3. Reload page so root layout (AppLanguageProvider) re-runs on server and loads new dictionary
      if (typeof window !== "undefined") {
        window.location.reload();
      }
      return true;
    } catch (err) {
      console.error("Error changing language:", err);
      return false;
    }
  };

  /**
   * Type-safe key resolver with interpolation support:
   * e.g., t('didPairing.instructions', { email: 'user@gmail.com' })
   */
  const t = (keyPath: string, vars?: Record<string, string | number>): string => {
    const keys = keyPath.split(".");
    let value: any = initialDictionary;

    for (const key of keys) {
      if (value && typeof value === "object" && key in value) {
        value = value[key];
      } else {
        value = undefined;
        break;
      }
    }

    // Fallback to initialFallbackDictionary if key is missing in active locale
    if (value === undefined && initialFallbackDictionary) {
      let fallbackVal: any = initialFallbackDictionary;
      for (const key of keys) {
        if (fallbackVal && typeof fallbackVal === "object" && key in fallbackVal) {
          fallbackVal = fallbackVal[key];
        } else {
          fallbackVal = undefined;
          break;
        }
      }
      value = fallbackVal;
    }

    if (typeof value !== "string") {
      return keyPath; // Return key path as fallback if string not found
    }

    // Interpolate {{var}} or {var}
    if (vars) {
      Object.entries(vars).forEach(([param, val]) => {
        const regex = new RegExp(`{{\\s*${param}\\s*}}|{\\s*${param}\\s*}`, "g");
        value = value.replace(regex, String(val));
      });
    }

    return value;
  };

  return (
    <LanguageContext.Provider
      value={{
        locale,
        availableLanguages,
        dictionary: initialDictionary,
        fallbackDictionary: initialFallbackDictionary,
        changeLanguage,
        t,
      }}
    >
      {children}
    </LanguageContext.Provider>
  );
}

export function useTranslation() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error("useTranslation must be used within a LanguageProvider");
  }
  return context;
}
