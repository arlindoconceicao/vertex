import { ReactNode } from "react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getAvailableLanguages, getDictionary } from "@/locales/registry";
import { LanguageProvider } from "@/locales/LanguageContext";
import { cookies } from "next/headers";

interface AppLanguageProviderProps {
  children: ReactNode;
}

export default async function AppLanguageProvider({ children }: AppLanguageProviderProps) {
  const session = await auth();
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get("NEXT_LOCALE")?.value;

  let activeLocale = cookieLocale || "en";

  if (session?.user?.id) {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { language: true },
    });

    if (user?.language) {
      activeLocale = user.language;
    }
  }

  const availableLanguages = getAvailableLanguages();
  const dictionary = getDictionary(activeLocale);
  const fallbackDictionary = getDictionary("en");

  return (
    <LanguageProvider
      initialLocale={activeLocale}
      initialAvailableLanguages={availableLanguages}
      initialDictionary={dictionary}
      initialFallbackDictionary={fallbackDictionary}
    >
      {children}
    </LanguageProvider>
  );
}
