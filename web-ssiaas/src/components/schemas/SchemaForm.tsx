"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createSchema, type SchemaField } from "@/app/actions/schema-actions";

// Tipos de campo disponíveis para as credenciais
const FIELD_TYPES = ["string", "number", "boolean", "date"] as const;

export default function SchemaForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [fields, setFields] = useState<SchemaField[]>([
    { name: "", type: "string", required: true },
  ]);
  const [error, setError] = useState<string | null>(null);

  // ── Gerenciamento dos campos dinâmicos ──────────────────────
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

  // ── Submit ──────────────────────────────────────────────────
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
          <label htmlFor="name" className="block text-sm font-medium text-gray-300 mb-2">
            Schema Name
          </label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Graduation Diploma"
            className="w-full bg-gray-800 border border-gray-700 text-white placeholder-gray-500 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition"
          />
        </div>
        <div>
          <label htmlFor="description" className="block text-sm font-medium text-gray-300 mb-2">
            Description
          </label>
          <textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Briefly describe what this credential certifies..."
            rows={3}
            className="w-full bg-gray-800 border border-gray-700 text-white placeholder-gray-500 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition resize-none"
          />
        </div>
      </div>

      {/* Campos dinâmicos do schema */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium text-gray-300">
            Credential Fields
          </h3>
          <button
            type="button"
            onClick={addField}
            className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 transition-colors cursor-pointer"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Add Field
          </button>
        </div>

        <div className="space-y-3">
          {fields.map((field, index) => (
            <div
              key={index}
              className="flex items-center gap-3 bg-gray-800/60 border border-gray-700/50 rounded-xl px-4 py-3"
            >
              {/* Nome do campo */}
              <input
                type="text"
                value={field.name}
                onChange={(e) => updateField(index, { name: e.target.value })}
                placeholder="Field name"
                className="flex-1 bg-transparent text-white placeholder-gray-500 text-sm focus:outline-none"
              />

              {/* Tipo */}
              <select
                value={field.type}
                onChange={(e) =>
                  updateField(index, { type: e.target.value as SchemaField["type"] })
                }
                className="bg-gray-700 text-gray-300 text-xs rounded-lg px-2.5 py-1.5 border-none focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
              >
                {FIELD_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>

              {/* Obrigatório */}
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={field.required}
                  onChange={(e) => updateField(index, { required: e.target.checked })}
                  className="rounded border-gray-600 bg-gray-700 text-indigo-500 focus:ring-indigo-500 cursor-pointer"
                />
                <span className="text-xs text-gray-400">Required</span>
              </label>

              {/* Remover */}
              {fields.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeField(index)}
                  className="text-gray-600 hover:text-red-400 transition-colors cursor-pointer"
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
        <p className="text-xs text-gray-500 mb-2">JSON Schema Preview</p>
        <pre className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-xs text-gray-400 overflow-x-auto">
          {JSON.stringify({ fields }, null, 2)}
        </pre>
      </div>

      {/* Botão de submit */}
      <button
        type="button"
        onClick={handleSubmit}
        disabled={isPending}
        className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-900 disabled:text-indigo-400 disabled:cursor-not-allowed text-white font-medium py-3 px-4 rounded-xl transition-colors cursor-pointer"
      >
        {isPending ? "Creating..." : "Create Schema"}
      </button>
    </div>
  );
}