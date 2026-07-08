"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { issueCredential } from "@/app/actions/credential-actions";

type SchemaOption = {
  id: string;
  name: string;
  version: string;
  fields: { name: string; type: string; required: boolean }[];
};

type Props = {
  schemas: SchemaOption[];
};

export default function IssueCredentialForm({ schemas }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [selectedSchemaId, setSelectedSchemaId] = useState("");
  const [holderEmail, setHolderEmail] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // O schema selecionado atualmente
  const selectedSchema = schemas.find((s) => s.id === selectedSchemaId);

  function handleSchemaChange(schemaId: string) {
    setSelectedSchemaId(schemaId);
    setError(null);

    // Reseta os valores dos campos quando troca de schema
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
      setError("Please select a schema.");
      return;
    }

    if (!holderEmail.trim()) {
      setError("Please enter the holder's email.");
      return;
    }

    // Converte os valores para os tipos corretos antes de enviar
    const credentialSubject: Record<string, unknown> = {};
    if (selectedSchema) {
      for (const field of selectedSchema.fields) {
        const raw = fieldValues[field.name] ?? "";

        if (field.required && !raw.trim()) {
          setError(`Field "${field.name}" is required.`);
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
        setSuccess("Credential issued successfully!");
        setTimeout(() => {
          router.push(`/credentials/${result.credentialId}`);
        }, 1500);
      } else {
        setError(result.error);
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
        <label className="block text-sm font-medium text-gray-300 mb-2">
          Credential Schema
        </label>
        {schemas.length === 0 ? (
          <p className="text-sm text-gray-500">
            No schemas available. Create one first.
          </p>
        ) : (
          <select
            value={selectedSchemaId}
            onChange={(e) => handleSchemaChange(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
          >
            <option value="">Select a schema...</option>
            {schemas.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} (v{s.version})
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Email do Holder */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">
          Holder Email
        </label>
        <input
          type="email"
          value={holderEmail}
          onChange={(e) => setHolderEmail(e.target.value)}
          placeholder="holder@example.com"
          className="w-full bg-gray-800 border border-gray-700 text-white placeholder-gray-500 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition"
        />
      </div>

      {/* Data de expiração (opcional) */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">
          Expiration Date
          <span className="text-gray-500 font-normal ml-1">(optional)</span>
        </label>
        <input
          type="date"
          value={expiresAt}
          onChange={(e) => setExpiresAt(e.target.value)}
          min={new Date().toISOString().split("T")[0]}
          className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition"
        />
      </div>

      {/* Campos dinâmicos do schema selecionado */}
      {selectedSchema && selectedSchema.fields.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-gray-300 mb-3">
            Credential Data
          </h3>
          <div className="space-y-3">
            {selectedSchema.fields.map((field) => (
              <div key={field.name}>
                <label className="block text-xs text-gray-400 mb-1">
                  {field.name}
                  {field.required && (
                    <span className="text-yellow-400 ml-1">*</span>
                  )}
                  <span className="text-gray-600 ml-1">({field.type})</span>
                </label>
                {field.type === "boolean" ? (
                  <select
                    value={fieldValues[field.name] ?? ""}
                    onChange={(e) =>
                      setFieldValues({ ...fieldValues, [field.name]: e.target.value })
                    }
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
                  >
                    <option value="">Select...</option>
                    <option value="true">True</option>
                    <option value="false">False</option>
                  </select>
                ) : (
                  <input
                    type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
                    value={fieldValues[field.name] ?? ""}
                    onChange={(e) =>
                      setFieldValues({ ...fieldValues, [field.name]: e.target.value })
                    }
                    placeholder={`Enter ${field.name}...`}
                    className="w-full bg-gray-800 border border-gray-700 text-white placeholder-gray-500 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition"
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
        className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-900 disabled:text-indigo-400 disabled:cursor-not-allowed text-white font-medium py-3 px-4 rounded-xl transition-colors cursor-pointer"
      >
        {isPending ? "Issuing..." : "Issue Credential"}
      </button>
    </div>
  );
}