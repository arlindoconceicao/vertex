"use client";

import { useState, useTransition, useRef } from "react";
import { useRouter } from "next/navigation";
import { issueCredential } from "@/app/actions/credential-actions";
import { useTranslation } from "@/locales/LanguageContext";
import SearchableSelect from "@/components/common/SearchableSelect";
import Papa from "papaparse";

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

  const [issueMode, setIssueMode] = useState<"single" | "batch">("single");

  const [selectedSchemaId, setSelectedSchemaId] = useState("");
  const [holderEmail, setHolderEmail] = useState(initialHolderEmail || "");
  const [expiresAt, setExpiresAt] = useState("");
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Batch states
  const [batchData, setBatchData] = useState<any[]>([]);
  const [invalidEmails, setInvalidEmails] = useState<string[]>([]);
  const [showInvalidModal, setShowInvalidModal] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedSchema = schemas.find((s) => s.id === selectedSchemaId);

  function handleSchemaChange(schemaId: string) {
    setSelectedSchemaId(schemaId);
    setError(null);
    setBatchData([]);

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

  function handleDownloadTemplate() {
    if (!selectedSchema) return;
    const headers = ["HolderEmail", ...selectedSchema.fields.map(f => f.name)];
    const csv = headers.join(",") + "\n";
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `template_${selectedSchema.name.replace(/\s/g, "_")}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    setSuccess(null);
    if (!e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        const data = results.data as any[];
        if (data.length === 0) {
          setError(t("errors.emptyCsv") || "CSV is empty");
          return;
        }
        
        // Basic column check
        const requiredHeaders = ["HolderEmail"];
        const headers = Object.keys(data[0]);
        if (!headers.includes("HolderEmail")) {
          setError(t("errors.invalidCsvFormat") || "CSV must contain HolderEmail column");
          return;
        }

        const validBatch = data.map(row => {
          const credentialSubject: any = {};
          if (selectedSchema) {
            for (const field of selectedSchema.fields) {
              const raw = row[field.name];
              if (field.required && !raw) {
                // missing field logic handled later if needed
              }
              if (raw) {
                if (field.type === "number") credentialSubject[field.name] = Number(raw);
                else if (field.type === "boolean") credentialSubject[field.name] = raw.toLowerCase() === "true";
                else credentialSubject[field.name] = raw;
              }
            }
          }
          return { holderEmail: row["HolderEmail"], credentialSubject };
        });

        const emails = validBatch.map(r => r.holderEmail).filter(Boolean);
        
        try {
          const res = await fetch("/api/users/validate-emails", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ emails })
          });
          const validationData = await res.json();
          if (validationData.invalidEmails && validationData.invalidEmails.length > 0) {
            setInvalidEmails(validationData.invalidEmails);
            setBatchData(validBatch);
            setShowInvalidModal(true);
          } else {
            setBatchData(validBatch);
            setSuccess(t("common.csvLoaded") || "CSV carregado com sucesso e todos os usuários validados.");
          }
        } catch (err) {
          setError("Error validating users.");
        }
      }
    });
  }

  function handleRemoveInvalid() {
    setBatchData(prev => prev.filter(row => !invalidEmails.includes(row.holderEmail)));
    setShowInvalidModal(false);
    setInvalidEmails([]);
    setSuccess(t("common.csvLoadedFixed") || "Usuários inválidos removidos. Pronto para emitir.");
  }

  function handleCancelInvalid() {
    setBatchData([]);
    setShowInvalidModal(false);
    setInvalidEmails([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleBatchSubmit() {
    setError(null);
    setSuccess(null);

    if (batchData.length === 0) {
      setError("No valid data to process.");
      return;
    }

    startTransition(async () => {
      try {
        const res = await fetch("/api/credentials/batch-issue", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            schemaId: selectedSchemaId,
            expiresAt: expiresAt || undefined,
            credentials: batchData
          })
        });

        const result = await res.json();

        if (result.success) {
          setSuccess(t("common.savedBatch") || "Lote emitido com sucesso.");
          setTimeout(() => {
            router.push(`/dashboard`);
          }, 1500);
        } else {
          setError(result.error || "Failed to issue batch.");
        }
      } catch (err) {
        setError("Network error");
      }
    });
  }

  function handleSubmit() {
    if (issueMode === "batch") {
      handleBatchSubmit();
      return;
    }

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
        if (result.error?.includes("register a DID")) errKey = "errors.didRequired";
        else if (result.error === "No user found with this email.") errKey = "errors.noUserWithEmail";
        else if (result.error === "Schema not found.") errKey = "errors.schemaNotFound";
        else if (result.error === "Expiration date must be in the future.") errKey = "errors.futureExpiration";
        else if (result.error === "Unauthorized.") errKey = "errors.unauthorized";
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

      <div className="flex gap-4 p-1 bg-surface-hover border border-border rounded-xl w-fit">
        <button
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${issueMode === "single" ? "bg-primary text-white" : "text-text-muted hover:text-text-main"}`}
          onClick={() => setIssueMode("single")}
        >
          {t("credentials.issueModeSingle") || "Emissão Padrão"}
        </button>
        <button
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${issueMode === "batch" ? "bg-primary text-white" : "text-text-muted hover:text-text-main"}`}
          onClick={() => setIssueMode("batch")}
        >
          {t("credentials.issueModeBatch") || "Emissão em Lote"}
        </button>
      </div>

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
      {issueMode === "single" && (
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
      )}

      {/* Data de expiração (opcional) - Comum */}
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

      {/* Campos dinâmicos do schema selecionado (Apenas Single) */}
      {issueMode === "single" && selectedSchema && selectedSchema.fields.length > 0 && (
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

      {/* Batch UI */}
      {issueMode === "batch" && selectedSchema && (
        <div className="border border-border bg-surface-hover rounded-xl p-6 space-y-4">
          <h3 className="text-sm font-medium text-text-main">
            {t("credentials.batchUploadTitle") || "Upload de CSV"}
          </h3>
          <p className="text-sm text-text-muted">
            {t("credentials.batchUploadDesc") || "Faça o download do template CSV, preencha os dados de acordo com o esquema e envie o arquivo."}
          </p>
          <div className="flex flex-col sm:flex-row gap-4">
            <button
              onClick={handleDownloadTemplate}
              className="bg-surface border border-border hover:bg-surface-hover text-text-main px-4 py-2 rounded-lg text-sm transition-colors"
            >
              {t("credentials.downloadCsv") || "Download CSV"}
            </button>
            <label className="bg-primary hover:bg-primary-hover text-white px-4 py-2 rounded-lg text-sm transition-colors cursor-pointer text-center">
              {t("credentials.uploadCsv") || "Upload CSV"}
              <input type="file" accept=".csv" className="hidden" ref={fileInputRef} onChange={handleFileUpload} />
            </label>
            <button
              onClick={() => setShowPreviewModal(true)}
              disabled={batchData.length === 0}
              className="bg-surface border border-border hover:bg-surface-hover text-text-main px-4 py-2 rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t("credentials.viewCsv") || "Visualizar CSV"}
            </button>
          </div>
          {batchData.length > 0 && !showInvalidModal && (
             <p className="text-sm text-emerald-400 mt-2">
               {batchData.length} credenciais prontas para emissão.
             </p>
          )}
        </div>
      )}

      {/* Botão de emissão */}
      <button
        type="button"
        onClick={handleSubmit}
        disabled={isPending || schemas.length === 0 || (issueMode === "batch" && batchData.length === 0)}
        className="w-full bg-primary hover:bg-primary-hover disabled:bg-indigo-900 disabled:text-primary-text disabled:cursor-not-allowed text-white font-medium py-3 px-4 rounded-xl transition-colors cursor-pointer"
      >
        {isPending ? t("credentials.issuing") : t("credentials.issueButton")}
      </button>

      {/* Pop-up Modal Invalid Users */}
      {showInvalidModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-surface border border-border rounded-2xl w-full max-w-lg shadow-2xl p-6">
             <h3 className="text-lg font-bold text-text-main mb-2">Usuários Não Encontrados</h3>
             <p className="text-sm text-text-muted mb-4">
               Os seguintes e-mails não estão cadastrados na plataforma. Você pode corrigir o arquivo CSV ou excluir automaticamente esses registros do lote atual.
             </p>
             <div className="max-h-48 overflow-y-auto bg-surface-hover border border-border rounded-xl p-3 mb-6 space-y-1">
               {invalidEmails.map(em => (
                 <div key={em} className="text-sm text-red-400 font-mono">{em}</div>
               ))}
             </div>
             <div className="flex gap-3 justify-end">
                <button
                  onClick={handleCancelInvalid}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-surface-hover hover:bg-surface border border-border text-text-main transition-colors"
                >
                  Cancelar e Corrigir
                </button>
                <button
                  onClick={handleRemoveInvalid}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-red-600 hover:bg-red-700 text-white transition-colors"
                >
                  Excluir e Continuar
                </button>
             </div>
          </div>
        </div>
      )}

      {/* Pop-up Modal CSV Preview */}
      {showPreviewModal && selectedSchema && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-surface border border-border rounded-2xl w-full max-w-4xl shadow-2xl p-6 max-h-[90vh] flex flex-col">
             <div className="flex justify-between items-center mb-4">
               <h3 className="text-lg font-bold text-text-main">{t("credentials.csvPreviewTitle") || "Pré-visualização do CSV"}</h3>
               <button onClick={() => setShowPreviewModal(false)} className="text-text-muted hover:text-text-main">
                 <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
               </button>
             </div>
             
             <div className="overflow-auto border border-border rounded-xl flex-1 min-h-0">
               <table className="w-full text-left text-sm whitespace-nowrap">
                 <thead className="bg-surface-hover sticky top-0 border-b border-border shadow-sm">
                   <tr>
                     <th className="px-4 py-3 font-medium text-text-muted">HolderEmail</th>
                     {selectedSchema.fields.map(f => (
                       <th key={f.name} className="px-4 py-3 font-medium text-text-muted">{f.name}</th>
                     ))}
                   </tr>
                 </thead>
                 <tbody className="divide-y divide-border">
                   {batchData.map((row, idx) => (
                     <tr key={idx} className="hover:bg-surface-hover">
                       <td className="px-4 py-3 text-text-main">{row.holderEmail}</td>
                       {selectedSchema.fields.map(f => (
                         <td key={f.name} className="px-4 py-3 text-text-main">{String(row.credentialSubject?.[f.name] ?? "")}</td>
                       ))}
                     </tr>
                   ))}
                 </tbody>
               </table>
             </div>
             <div className="mt-4 flex justify-end">
               <button onClick={() => setShowPreviewModal(false)} className="px-4 py-2 bg-primary hover:bg-primary-hover text-white rounded-lg text-sm font-medium transition-colors">
                 {t("common.close") || "Fechar"}
               </button>
             </div>
          </div>
        </div>
      )}
    </div>
  );
}
