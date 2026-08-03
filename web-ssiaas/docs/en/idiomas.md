# Internationalization (i18n) and Language Management Guide

This document describes the internationalization (i18n) architecture of the SSI platform, explaining how the **dynamic dictionary auto-discovery**, the **route control file**, the **untranslated screens detection script**, and the workflow for adding new screens to the project function.

---

## 1. Architecture Overview

The platform adopts a **high-performance hybrid approach**:
* **User Preference:** Saved in the PostgreSQL database (`User.language` model via Prisma) and synchronized into session cookies (`NEXT_LOCALE`).
* **Default Language:** **English (`en`)**. If the user has not defined a preference or if a translation key is missing in the selected language, the system automatically falls back to English.
* **Global Provider:** The `AppLanguageProvider` wraps the application in the `RootLayout` (`src/app/layout.tsx`), making language switching **instantaneous in real-time across all screens**.
* **JSON Dictionaries:** Stored in the `src/locales/messages/` directory (`en.json`, `pt.json`, `es.json`).
* **Auto-Discovery:** The system automatically scans the `src/locales/messages/` folder upon startup, registering all available languages without the need to alter TypeScript code.

---

## 2. Screen Coverage Control (`routes-manifest.json`)

To prevent new screens from being created in the application without i18n support, we maintain a control file at:
`src/locales/routes-manifest.json`

This file lists all application routes/screens covered by translations:

```json
{
  "$schema": "Manifest of application routes covered by i18n translations",
  "coveredRoutes": [
    {
      "route": "/dashboard",
      "file": "src/app/dashboard/page.tsx",
      "description": "Main control panel with statistics and credential list",
      "namespace": "dashboard"
    }
  ]
}
```

---

## 3. Maintenance and Validation CLI Scripts

We provide essential commands in `package.json`:

### A. Check Untranslated Screens (`npm run i18n:check-routes`)
* **Command:** `npm run i18n:check-routes`
* **Script:** `scripts/check-route-coverage.ts`
* **Functionality:** Scans the `src/app/` directory looking for Next.js pages (`page.tsx`) and compares them against the `routes-manifest.json` manifest. If a new screen has been created that wasn't registered in the translations control, the script issues a detailed warning and returns an error.

### B. Validate Translation Keys Parity (`npm run i18n:validate`)
* **Command:** `npm run i18n:validate`
* **Script:** `scripts/validate-i18n.ts`
* **Functionality:** Compares all secondary dictionaries (`pt.json`, `es.json`, etc.) against the canonical dictionary (`en.json`). If a key is missing in any language, the script accurately flags which keys need translation.

### C. Synchronize Missing Keys (`npm run i18n:sync`)
* **Command:** `npm run i18n:sync`
* **Script:** `scripts/validate-i18n.ts --fix`
* **Functionality:** Automatically fills missing keys in secondary dictionaries by copying the default English text, facilitating the translation work.

### D. Hardcoded Strings Audit (AST)
* **Command:** `npx tsx lib/check-i18n.ts`
* **Script:** `lib/check-i18n.ts`
* **Functionality:** Uses the `ts-morph` library to generate the Abstract Syntax Tree (AST) of TypeScript files (`.tsx`). Scans the `src/app/` and `src/components/` directories looking for JSX text nodes (`JsxText`) and common attributes (like `placeholder`, `title`, `alt`) containing readable hardcoded texts (i.e., not passed through the `t()` translation function). If suspicious texts are found, the script outputs the exact file, line, and the forgotten string.

---

## 4. Workflow: How to Add a New Screen to the Project

When developing a new feature or screen (e.g., `src/app/reports/page.tsx`):

1. **Create the Page:**
   Create the route `src/app/reports/page.tsx` using the `useTranslation()` hook in your components to render texts, titles, buttons, and warnings.

2. **Add New Keys in `en.json` (Canonical):**
   Open `src/locales/messages/en.json` and add the translation block for the new screen.

3. **Synchronize Other Languages:**
   Run in the terminal:
   ```bash
   npm run i18n:sync
   ```
   This updates `pt.json` and `es.json` with the new keys for you to translate.

4. **Register Route in the Control Manifest:**
   Open `src/locales/routes-manifest.json` and add the new screen's record.

5. **Verify Script Approval:**
   Run in the terminal:
   ```bash
   npm run i18n:check-routes
   npm run i18n:validate
   ```
   If both pass successfully, your new screen is ready and 100% integrated into the language system!

---

## 5. How to Add a New Language (e.g., Spanish, French)

To add support for a new language (example: **French - `fr`**):

1. Create the `src/locales/messages/fr.json` file.
2. Add the `_meta` metadata:
   ```json
   {
     "_meta": {
       "code": "fr",
       "name": "Français",
       "flag": "🇫🇷"
     }
   }
   ```
3. Run `npm run i18n:sync` to populate all existing keys.
4. Translate the texts, and you're done! The new language will **automatically** appear in the settings menu at `http://localhost:3000/settings`.
