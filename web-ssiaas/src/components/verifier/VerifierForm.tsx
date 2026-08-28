"use client";

import { useState, useTransition } from "react";
import { useTranslation } from "@/locales/LanguageContext";
import MathCaptcha from "./MathCaptcha";

type VerifyResult = {
  valid: boolean;
  errors: string[];
  revokedAt?: string | null;
  metadata?: unknown;
  schemaStructure?: unknown;
};

export default function VerifierForm() {
  const { t, locale } = useTranslation();
  const dateLocale = locale === "pt" ? "pt-BR" : locale === "es" ? "es-ES" : "en-US";
  const [mode, setMode] = useState<"pdf" | "hash">("pdf");
  const [isPending, startTransition] = useTransition();
  const [fileInput, setFileInput] = useState<File | null>(null);
  const [hashInput, setHashInput] = useState("");
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [isCaptchaSolved, setIsCaptchaSolved] = useState(false);
  const [captchaResetTrigger, setCaptchaResetTrigger] = useState(0);

  function handleVerify() {
    setResult(null);
    setParseError(null);

    startTransition(async () => {
      try {
        let response;
        if (mode === "pdf") {
          if (!fileInput) {
            setParseError(t("verify.errors.selectPdfFile"));
            return;
          }
          const formData = new FormData();
          formData.append("file", fileInput);

          response = await fetch("/api/verifier/verify", {
            method: "POST",
            body: formData,
          });
        } else {
          if (!hashInput.trim()) {
            setParseError(t("verify.errors.provideValidHash"));
            return;
          }
          response = await fetch("/api/verifier/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pdfHash: hashInput.trim() }),
          });
        }

        const data = await response.json();

        if (response.ok) {
          setResult(data as VerifyResult);
        } else {
          setParseError(data.error ?? t("verify.errors.verificationFailed"));
        }
        
        // Reset the captcha for the next verification
        setIsCaptchaSolved(false);
        setCaptchaResetTrigger(prev => prev + 1);
      } catch {
        setParseError(t("errors.connectionError"));
      }
    });
  }

  function handleReset() {
    setFileInput(null);
    setHashInput("");
    setResult(null);
    setParseError(null);
    setIsCaptchaSolved(false);
    setCaptchaResetTrigger(prev => prev + 1);
  }

  return (
    <div className="space-y-6">
      {/* Abas para alternar os modos */}
      <div className="flex bg-gray-800 rounded-lg p-1">
        <button
          onClick={() => { setMode("pdf"); handleReset(); }}
          className={`flex-1 text-sm font-medium py-2 rounded-md transition-colors ${
            mode === "pdf" ? "bg-gray-700 text-white shadow" : "text-text-muted hover:text-gray-200"
          }`}
        >
          {t("verify.pdfUploadTab")}
        </button>
        <button
          onClick={() => { setMode("hash"); handleReset(); }}
          className={`flex-1 text-sm font-medium py-2 rounded-md transition-colors ${
            mode === "hash" ? "bg-gray-700 text-white shadow" : "text-text-muted hover:text-gray-200"
          }`}
        >
          {t("verify.pdfHashTab")}
        </button>
      </div>

      {/* Input baseado no modo */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">
          {mode === "pdf" ? t("verify.uploadPdfLabel") : t("verify.pastePdfHash")}
        </label>
        {mode === "pdf" ? (
          <div>
            <div className="flex items-center gap-3 bg-gray-800 border border-gray-700 rounded-xl p-2.5">
              <label className="cursor-pointer bg-primary hover:bg-primary-hover text-white font-medium px-4 py-2 rounded-lg text-sm transition-colors shadow shrink-0">
                <span>{t("verify.chooseFile")}</span>
                <input
                  type="file"
                  accept="application/pdf"
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) {
                      setFileInput(e.target.files[0]);
                    } else {
                      setFileInput(null);
                    }
                    setResult(null);
                    setParseError(null);
                  }}
                  className="hidden"
                />
              </label>
              <span className="text-sm text-gray-300 font-mono truncate">
                {fileInput ? fileInput.name : t("verify.noFileSelected")}
              </span>
            </div>
            <p className="mt-2 text-xs text-text-muted flex items-start gap-1.5 bg-surface/50 p-3 rounded-lg">
              <svg className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span>{t("verify.pdfPrivacyWarning")}</span>
            </p>
          </div>
        ) : (
          <input
            type="text"
            value={hashInput}
            onChange={(e) => {
              setHashInput(e.target.value);
              setResult(null);
              setParseError(null);
            }}
            placeholder={t("verify.pdfHashPlaceholder")}
            className="w-full bg-gray-800 border border-gray-700 text-white placeholder-gray-500 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary-ring transition"
          />
        )}
      </div>

      {/* Erro de parse */}
      {parseError && (
        <div className="bg-red-950 border border-red-800 text-red-300 text-sm rounded-xl px-4 py-3">
          {parseError}
        </div>
      )}

      {/* Resultado da verificação */}
      {result && (
        <div
          className={`border rounded-2xl p-6 ${
            result.valid
              ? "bg-emerald-950/50 border-emerald-800"
              : "bg-red-950/50 border-red-800"
          }`}
        >
          <div className="flex items-center gap-3 mb-4">
            {result.valid ? (
              <>
                <svg className="w-8 h-8 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div>
                  <p className="text-lg font-bold text-emerald-400">{t("verify.valid")}</p>
                </div>
              </>
            ) : (
              <>
                <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
                <div>
                  <p className="text-lg font-bold text-red-400">{t("verify.invalid")}</p>
                </div>
              </>
            )}
          </div>

          {result.errors.length > 0 && (
            <div className="space-y-2 mt-4">
              {result.errors.map((err, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 bg-red-900/20 rounded-xl px-4 py-3"
                >
                  <svg className="w-4 h-4 text-red-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  <p className="text-sm text-red-300">
                    {err === "Nenhuma credencial encontrada para este hash de PDF." || err === "NO_CREDENTIAL_FOUND"
                      ? t("verify.noCredentialFoundForHash") 
                      : err === "REVOKED_CREDENTIAL"
                      ? result.revokedAt
                        ? t("verify.revokedWithDate", { date: new Date(result.revokedAt).toLocaleString(dateLocale) })
                        : t("verify.revoked")
                      : err === "INVALID_SIGNATURE" || err === "A assinatura do PDF não é válida ou foi adulterada."
                      ? t("verify.errors.invalidSignature")
                      : err === "ISSUER_NOT_REGISTERED" || err === "Issuer DID not registered in platform."
                      ? t("verify.errors.issuerNotRegistered")
                      : err.includes("Invalid PDF") || err === "INVALID_PDF_MANIFEST"
                      ? t("verify.errors.invalidPdfManifest")
                      : err}
                  </p>
                </div>
              ))}
            </div>
          )}

          {result.valid && !!result.metadata && (
             <div className="mt-6 border-t border-emerald-800/50 pt-4">
               {((result.metadata as any)?.expirationDate || (result.metadata as any)?.expires_at) && (
                 <div className="mb-4 bg-surface border border-border rounded-xl p-4 flex items-center justify-between">
                   <div className="flex items-center gap-3">
                     <svg className="w-5 h-5 text-primary-text" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                       <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                     </svg>
                     <span className="text-sm font-semibold text-gray-300">{t("verify.expirationDate")}</span>
                   </div>
                   <span className="text-sm text-indigo-300 font-medium">
                     {new Date((result.metadata as any).expirationDate || (result.metadata as any).expires_at).toLocaleDateString(dateLocale, { timeZone: 'UTC' })}
                   </span>
                 </div>
               )}
               <h4 className="text-sm font-semibold text-emerald-300 mb-2">{t("verify.proofOfExistenceMetadata")}</h4>
               <pre className="bg-surface border border-border rounded-xl p-4 text-xs text-emerald-400 overflow-x-auto whitespace-pre-wrap">
                 {JSON.stringify(result.metadata, null, 2)}
               </pre>
             </div>
          )}

          {result.valid && !!result.schemaStructure && (
             <div className="mt-4 pt-4">
               <h4 className="text-sm font-semibold text-emerald-300 mb-2">{t("verify.schemaStructure")}</h4>
               <pre className="bg-surface border border-border rounded-xl p-4 text-xs text-blue-400 overflow-x-auto whitespace-pre-wrap">
                 {JSON.stringify(result.schemaStructure, null, 2)}
               </pre>
             </div>
          )}
        </div>
      )}

      {/* CAPTCHA */}
      <MathCaptcha
        onSuccess={() => setIsCaptchaSolved(true)}
        onReset={() => setIsCaptchaSolved(false)}
        resetTrigger={captchaResetTrigger}
      />

      {/* Botões */}
      <div className="flex gap-3">
        <button
          type="button"
          onClick={handleVerify}
          disabled={isPending || !isCaptchaSolved || (mode === "pdf" ? !fileInput : !hashInput.trim())}
          className="flex-1 bg-primary hover:bg-primary-hover disabled:bg-indigo-900 disabled:text-primary-text disabled:cursor-not-allowed text-white font-medium py-3 px-4 rounded-xl transition-colors cursor-pointer"
        >
          {isPending ? t("verify.verifying") : t("verify.verifyButton")}
        </button>
        {(result || parseError) && (
          <button
            type="button"
            onClick={handleReset}
            className="bg-gray-800 hover:bg-gray-700 text-gray-300 font-medium py-3 px-6 rounded-xl transition-colors cursor-pointer"
          >
            {t("common.cancel")}
          </button>
        )}
      </div>
    </div>
  );
}