import fs from "fs";
import path from "path";

export interface LanguageMeta {
  code: string;
  name: string;
  flag?: string;
}

export type Dictionary = Record<string, any>;

const MESSAGES_DIR = path.join(process.cwd(), "src", "locales", "messages");
const DEFAULT_LOCALE = "en";

/**
 * Reads the messages directory and dynamically auto-detects all available languages.
 */
export function getAvailableLanguages(): LanguageMeta[] {
  try {
    if (!fs.existsSync(MESSAGES_DIR)) {
      return [{ code: "en", name: "English", flag: "🇺🇸" }];
    }

    const files = fs.readdirSync(MESSAGES_DIR);
    const languages: LanguageMeta[] = [];

    for (const file of files) {
      if (file.endsWith(".json")) {
        const filePath = path.join(MESSAGES_DIR, file);
        try {
          const content = fs.readFileSync(filePath, "utf-8");
          const parsed = JSON.parse(content);
          const fileCode = path.basename(file, ".json");
          languages.push({
            code: fileCode,
            name: parsed._meta?.name || fileCode.toUpperCase(),
            flag: parsed._meta?.flag || "🌐",
          });
        } catch (e) {
          console.error(`Error reading locale file ${file}:`, e);
        }
      }
    }

    // Sort to keep 'en' and 'pt' first, then alphabetical
    languages.sort((a, b) => {
      if (a.code === "en") return -1;
      if (b.code === "en") return 1;
      if (a.code === "pt") return -1;
      if (b.code === "pt") return 1;
      return a.name.localeCompare(b.name);
    });

    return languages.length > 0
      ? languages
      : [{ code: "en", name: "English", flag: "🇺🇸" }];
  } catch (error) {
    console.error("Failed to discover available languages:", error);
    return [{ code: "en", name: "English", flag: "🇺🇸" }];
  }
}

/**
 * Loads the dictionary for the requested locale with fallback to 'en'.
 */
export function getDictionary(locale: string): Dictionary {
  const targetLocale = locale || DEFAULT_LOCALE;
  const targetPath = path.join(MESSAGES_DIR, `${targetLocale}.json`);
  const fallbackPath = path.join(MESSAGES_DIR, `${DEFAULT_LOCALE}.json`);

  let fallbackDict: Dictionary = {};
  if (fs.existsSync(fallbackPath)) {
    try {
      fallbackDict = JSON.parse(fs.readFileSync(fallbackPath, "utf-8"));
    } catch (e) {
      console.error(`Error reading default locale dictionary (${DEFAULT_LOCALE}):`, e);
    }
  }

  if (targetLocale === DEFAULT_LOCALE || !fs.existsSync(targetPath)) {
    return fallbackDict;
  }

  try {
    const targetDict = JSON.parse(fs.readFileSync(targetPath, "utf-8"));
    // Deep merge target over fallback so missing keys resolve to 'en'
    return mergeDeep(fallbackDict, targetDict);
  } catch (e) {
    console.error(`Error loading dictionary for ${targetLocale}:`, e);
    return fallbackDict;
  }
}

/**
 * Simple recursive deep merge to apply target locale strings over default locale fallback.
 */
function mergeDeep(target: Record<string, any>, source: Record<string, any>): Record<string, any> {
  const output = { ...target };
  if (isObject(target) && isObject(source)) {
    Object.keys(source).forEach((key) => {
      if (isObject(source[key])) {
        if (!(key in target)) {
          Object.assign(output, { [key]: source[key] });
        } else {
          output[key] = mergeDeep(target[key], source[key]);
        }
      } else {
        Object.assign(output, { [key]: source[key] });
      }
    });
  }
  return output;
}

function isObject(item: any): boolean {
  return item && typeof item === "object" && !Array.isArray(item);
}
