"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createSchema, type SchemaField } from "@/app/actions/schema-actions";
import { useTranslation } from "@/locales/LanguageContext";

const FIELD_TYPES = ["string", "number", "boolean", "date"] as const;

export default function SchemaForm() {
  const router = useRouter();
  const { t } = useTranslation();
  const [isPending, startTransition] = useTransition();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [fields, setFields] = useState<SchemaField[]>([
    { name: "", type: "string", required: true },
  ]);
  const [error, setError] = useState<string | null>(null);

  function addField() {
    setFields([...fields, { name: "", type: "string", required: false }]);
  }

  function removeField(index: number) {
    if (fields.length <= 1) return;
    setFields(fields.filter((_, i) => i !== index));
  }

  function updateField(index: number, patch: Partial<SchemaField>) {
    setFields(fields.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  }

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      const result = await createSchema(name, description, fields);
      if (result.success) {
        router.push(`/schemas/${result.data.id}`);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="space-y-8">
      {/* Erro global */}
      {error && (
        <div className="bg-red-950 border border-red-800 text-red-300 text-sm rounded-xl px-4 py-3">
          {error}
        </div>
      )}

      {/* Nome e descrição */}
      <div className="space-y-4">
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-text-main mb-2">
            {t("schemas.schemaName")}
          </label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("schemas.schemaNamePlaceholder")}
            className="w-full bg-surface border border-border text-text-main placeholder-text-muted rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-ring transition"
          />
        </div>
        <div>
          <label htmlFor="description" className="block text-sm font-medium text-text-main mb-2">
            {t("schemas.description")}
          </label>
          <textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t("schemas.descriptionPlaceholder")}
            rows={3}
            className="w-full bg-surface border border-border text-text-main placeholder-text-muted rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-ring transition resize-none"
          />
        </div>
      </div>

      {/* Campos dinâmicos do schema */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium text-text-main">
            {t("schemas.credentialFields")}
          </h3>
          <button
            type="button"
            onClick={addField}
            className="flex items-center gap-1 text-xs text-primary-text hover:text-indigo-300 transition-colors cursor-pointer"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            {t("schemas.addField")}
          </button>
        </div>

        <div className="space-y-3">
          {fields.map((field, index) => (
            <div
              key={index}
              className="flex items-center gap-3 bg-surface-hover border border-border rounded-xl px-4 py-3"
            >
              {/* Nome do campo */}
              <input
                type="text"
                value={field.name}
                onChange={(e) => updateField(index, { name: e.target.value })}
                placeholder={t("schemas.fieldName")}
                className="flex-1 bg-transparent text-text-main placeholder-text-muted text-sm focus:outline-none"
              />

              {/* Tipo */}
              <select
                value={field.type}
                onChange={(e) =>
                  updateField(index, { type: e.target.value as SchemaField["type"] })
                }
                className="bg-base text-text-main border border-border text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary-ring cursor-pointer"
              >
                {FIELD_TYPES.map((ft) => (
                  <option key={ft} value={ft}>
                    {ft}
                  </option>
                ))}
              </select>

              {/* Obrigatório */}
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={field.required}
                  onChange={(e) => updateField(index, { required: e.target.checked })}
                  className="rounded border-border bg-base text-primary focus:ring-primary-ring cursor-pointer"
                />
                <span className="text-xs text-text-muted">{t("schemas.fieldRequired")}</span>
              </label>

              {/* Remover */}
              {fields.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeField(index)}
                  className="text-text-muted hover:text-red-500 transition-colors cursor-pointer"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Preview do JSON gerado */}
      <div>
        <p className="text-xs text-text-subtle mb-2">{t("schemas.jsonPreview")}</p>
        <pre className="bg-surface border border-border rounded-xl p-4 text-xs text-text-muted overflow-x-auto">
          {JSON.stringify({ fields }, null, 2)}
        </pre>
      </div>

      {/* Botão de submit */}
      <button
        type="button"
        onClick={handleSubmit}
        disabled={isPending}
        className="w-full bg-primary hover:bg-primary-hover disabled:bg-indigo-900 disabled:text-primary-text disabled:cursor-not-allowed text-white font-medium py-3 px-4 rounded-xl transition-colors cursor-pointer"
      >
        {isPending ? t("schemas.creating") : t("schemas.savePublish")}
      </button>
    </div>
  );
}