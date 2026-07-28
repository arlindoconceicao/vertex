import fs from "fs";
import path from "path";

const MESSAGES_DIR = path.join(process.cwd(), "src", "locales", "messages");
const CANONICAL_LOCALE = "en.json";

const isFixMode = process.argv.includes("--fix") || process.argv.includes("--sync");

function getAllKeys(obj: Record<string, any>, prefix = ""): string[] {
  let keys: string[] = [];
  for (const key of Object.keys(obj)) {
    if (key === "_meta") continue; // Skip metadata
    const fullPath = prefix ? `${prefix}.${key}` : key;
    if (obj[key] && typeof obj[key] === "object" && !Array.isArray(obj[key])) {
      keys = keys.concat(getAllKeys(obj[key], fullPath));
    } else {
      keys.push(fullPath);
    }
  }
  return keys;
}

function getValueByPath(obj: Record<string, any>, keyPath: string): any {
  const parts = keyPath.split(".");
  let curr = obj;
  for (const part of parts) {
    if (curr && typeof curr === "object" && part in curr) {
      curr = curr[part];
    } else {
      return undefined;
    }
  }
  return curr;
}

function setValueByPath(obj: Record<string, any>, keyPath: string, value: any): void {
  const parts = keyPath.split(".");
  let curr = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!(part in curr) || typeof curr[part] !== "object") {
      curr[part] = {};
    }
    curr = curr[part];
  }
  curr[parts[parts.length - 1]] = value;
}

function validateI18n() {
  console.log("🔍 Validating i18n dictionaries against canonical source (en.json)...\n");

  const canonicalPath = path.join(MESSAGES_DIR, CANONICAL_LOCALE);
  if (!fs.existsSync(canonicalPath)) {
    console.error(`❌ Canonical dictionary not found at ${canonicalPath}`);
    process.exit(1);
  }

  const canonicalContent = JSON.parse(fs.readFileSync(canonicalPath, "utf-8"));
  const canonicalKeys = getAllKeys(canonicalContent);

  console.log(`📌 Canonical dictionary (${CANONICAL_LOCALE}) contains ${canonicalKeys.length} translation keys.`);

  const files = fs.readdirSync(MESSAGES_DIR).filter((f) => f.endsWith(".json"));
  let hasErrors = false;

  for (const file of files) {
    if (file === CANONICAL_LOCALE) continue;

    console.log(`\n--------------------------------------------------`);
    console.log(`🌐 Checking dictionary: ${file}`);
    const filePath = path.join(MESSAGES_DIR, file);
    let content: Record<string, any>;
    try {
      content = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch (e) {
      console.error(`❌ Invalid JSON formatting in ${file}`);
      hasErrors = true;
      continue;
    }

    // Check metadata
    if (!content._meta || !content._meta.code || !content._meta.name) {
      console.warn(`⚠️ Warning: Missing or incomplete '_meta' header in ${file}`);
    }

    const currentKeys = new Set(getAllKeys(content));
    const missingKeys: string[] = [];
    const extraKeys: string[] = [];

    // Find missing keys
    for (const key of canonicalKeys) {
      if (!currentKeys.has(key)) {
        missingKeys.push(key);
      }
    }

    // Find extra keys
    for (const key of currentKeys) {
      if (!canonicalKeys.includes(key)) {
        extraKeys.push(key);
      }
    }

    if (missingKeys.length === 0 && extraKeys.length === 0) {
      console.log(`✅ Perfect parity with ${CANONICAL_LOCALE}! All ${canonicalKeys.length} keys match.`);
    } else {
      if (missingKeys.length > 0) {
        console.error(`❌ Missing ${missingKeys.length} key(s) in ${file}:`);
        missingKeys.forEach((k) => console.error(`   - ${k}`));
        hasErrors = true;

        if (isFixMode) {
          console.log(`🛠️ Fixing: Copying default English values for missing keys...`);
          for (const key of missingKeys) {
            const canonicalVal = getValueByPath(canonicalContent, key);
            setValueByPath(content, key, canonicalVal);
          }
          fs.writeFileSync(filePath, JSON.stringify(content, null, 2) + "\n", "utf-8");
          console.log(`💾 Saved updated ${file}`);
        }
      }

      if (extraKeys.length > 0) {
        console.warn(`⚠️ Found ${extraKeys.length} obsolete/extra key(s) in ${file}:`);
        extraKeys.forEach((k) => console.warn(`   + ${k}`));
      }
    }
  }

  console.log(`\n--------------------------------------------------`);
  if (hasErrors && !isFixMode) {
    console.error(`\n❌ i18n validation failed! Run 'npm run i18n:sync' to auto-add missing keys.\n`);
    process.exit(1);
  } else {
    console.log(`\n✨ i18n validation completed successfully.\n`);
  }
}

validateI18n();
