"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { issueCredential } from "@/app/actions/credential-actions";
import { useTranslation } from "@/locales/LanguageContext";
import SearchableSelect from "@/components/common/SearchableSelect";

type SchemaOption = {
  id: string;
  name: string;
  version: string;
  fields: { name: string; type: string; required: boolean }[];
};

type Props = {
  schemas: SchemaOption[];
  initialHolderEmail?: string;
};

export default function IssueCredentialForm({ schemas, initialHolderEmail }: Props) {
  const router = useRouter();
  const { t } = useTranslation();
  const [isPending, startTransition] = useTransition();

  const [selectedSchemaId, setSelectedSchemaId] = useState("");
  const [holderEmail, setHolderEmail] = useState(initialHolderEmail || "");
  const [expiresAt, setExpiresAt] = useState("");
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const selectedSchema = schemas.find((s) => s.id === selectedSchemaId);

  function handleSchemaChange(schemaId: string) {
    setSelectedSchemaId(schemaId);
    setError(null);

    const schema = schemas.find((s) => s.id === schemaId);
    if (schema) {
      const initial: Record<string, string> = {};
      for (const field of schema.fields) {
        initial[field.name] = "";
      }
      setFieldValues(initial);
    } else {
      setFieldValues({});
    }
  }

  function handleSubmit() {
    setError(null);
    setSuccess(null);

    if (!selectedSchemaId) {
      setError(t("errors.schemaRequired"));
      return;
    }

    if (!holderEmail.trim()) {
      setError(t("errors.holderRequired"));
      return;
    }

    const credentialSubject: Record<string, unknown> = {};
    if (selectedSchema) {
      for (const field of selectedSchema.fields) {
        const raw = fieldValues[field.name] ?? "";

        if (field.required && !raw.trim()) {
          setError(t("errors.fieldRequired", { field: field.name }));
          return;
        }

        if (raw.trim()) {
          if (field.type === "number") {
            credentialSubject[field.name] = Number(raw);
          } else if (field.type === "boolean") {
            credentialSubject[field.name] = raw.toLowerCase() === "true";
          } else {
            credentialSubject[field.name] = raw;
          }
        }
      }
    }

    startTransition(async () => {
      const result = await issueCredential(
        selectedSchemaId,
        holderEmail,
        credentialSubject,
        expiresAt || undefined
      );

      if (result.success) {
        setSuccess(t("common.saved"));
        setTimeout(() => {
          router.push(`/credentials/${result.credentialId}?view=issued`);
        }, 1500);
      } else {
        let errKey = "errors.issueFailed";
        if (result.error?.includes("register a DID")) {
          errKey = "errors.didRequired";
        } else if (result.error === "No user found with this email.") {
          errKey = "errors.noUserWithEmail";
        } else if (result.error === "Schema not found.") {
          errKey = "errors.schemaNotFound";
        } else if (result.error === "Expiration date must be in the future.") {
          errKey = "errors.futureExpiration";
        } else if (result.error === "Unauthorized.") {
          errKey = "errors.unauthorized";
        }
        setError(t(errKey));
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* Mensagens */}
      {error && (
        <div className="bg-red-950 border border-red-800 text-red-300 text-sm rounded-xl px-4 py-3">
          {error}
        </div>
      )}
      {success && (
        <div className="bg-emerald-950 border border-emerald-800 text-emerald-300 text-sm rounded-xl px-4 py-3">
          {success}
        </div>
      )}

      {/* Seleção do schema */}
      <div>
        <label className="block text-sm font-medium text-text-main mb-2">
          {t("credentials.selectSchema")}
        </label>
        {schemas.length === 0 ? (
          <p className="text-sm text-text-subtle">
            {t("schemas.emptySchemas")}
          </p>
        ) : (
          <SearchableSelect
            options={schemas.map((s) => ({ id: s.id, name: s.name, version: s.version }))}
            value={selectedSchemaId}
            onChange={handleSchemaChange}
            placeholder={t("credentials.selectSchemaPlaceholder") || undefined}
          />
        )}
      </div>

      {/* Email do Holder */}
      <div>
        <label className="block text-sm font-medium text-text-main mb-2">
          {t("credentials.holderEmail")}
        </label>
        <input
          type="email"
          value={holderEmail}
          onChange={(e) => setHolderEmail(e.target.value)}
          placeholder={t("credentials.holderEmailPlaceholder")}
          className="w-full bg-surface border border-border text-text-main placeholder-text-muted rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-ring transition"
        />
      </div>

      {/* Data de expiração (opcional) */}
      <div>
        <label className="block text-sm font-medium text-text-main mb-2">
          {t("credentials.expirationDate")}
        </label>
        <input
          type="date"
          value={expiresAt}
          onChange={(e) => setExpiresAt(e.target.value)}
          min={new Date().toISOString().split("T")[0]}
          className="w-full bg-surface border border-border text-text-main rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-ring transition"
        />
      </div>

      {/* Campos dinâmicos do schema selecionado */}
      {selectedSchema && selectedSchema.fields.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-text-main mb-3">
            {t("schemas.credentialFields")}
          </h3>
          <div className="space-y-3">
            {selectedSchema.fields.map((field) => (
              <div key={field.name}>
                <label className="block text-xs text-text-muted mb-1">
                  {field.name}
                  {field.required && (
                    <span className="text-yellow-400 ml-1">*</span>
                  )}
                  <span className="text-text-muted ml-1">({field.type})</span>
                </label>
                {field.type === "boolean" ? (
                  <select
                    value={fieldValues[field.name] ?? ""}
                    onChange={(e) =>
                      setFieldValues({ ...fieldValues, [field.name]: e.target.value })
                    }
                    className="w-full bg-surface border border-border text-text-main rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-ring cursor-pointer"
                  >
                    <option value="">{t("common.select")}</option>
                    <option value="true">{t("common.trueVal")}</option>
                    <option value="false">{t("common.falseVal")}</option>
                  </select>
                ) : (
                  <input
                    type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
                    value={fieldValues[field.name] ?? ""}
                    onChange={(e) =>
                      setFieldValues({ ...fieldValues, [field.name]: e.target.value })
                    }
                    placeholder={t("credentials.enterFieldPlaceholder", { field: field.name })}
                    className="w-full bg-surface border border-border text-text-main placeholder-text-muted rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-ring transition"
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Botão de emissão */}
      <button
        type="button"
        onClick={handleSubmit}
        disabled={isPending || schemas.length === 0}
        className="w-full bg-primary hover:bg-primary-hover disabled:bg-indigo-900 disabled:text-primary-text disabled:cursor-not-allowed text-white font-medium py-3 px-4 rounded-xl transition-colors cursor-pointer"
      >
        {isPending ? t("credentials.issuing") : t("credentials.issueButton")}
      </button>
    </div>
  );
}