"use client";

import { useState, useTransition } from "react";

type VerifyResult = {
  valid: boolean;
  errors: string[];
};

export default function VerifierForm() {
  const [isPending, startTransition] = useTransition();
  const [jsonInput, setJsonInput] = useState("");
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  function handleVerify() {
    setResult(null);
    setParseError(null);

    // Valida que o input é JSON válido antes de enviar
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonInput);
    } catch {
      setParseError("Invalid JSON. Please check the syntax and try again.");
      return;
    }

    startTransition(async () => {
      try {
        const response = await fetch("/api/verifier/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ vcPayload: parsed }),
        });

        const data = await response.json();

        if (response.ok) {
          setResult(data as VerifyResult);
        } else {
          setParseError(data.error ?? "Verification failed.");
        }
      } catch {
        setParseError("Network error. Please try again.");
      }
    });
  }

  // Limpa tudo e recomeça
  function handleReset() {
    setJsonInput("");
    setResult(null);
    setParseError(null);
  }

  return (
    <div className="space-y-6">

      {/* Input de JSON */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">
          Paste the Verifiable Credential (JSON)
        </label>
        <textarea
          value={jsonInput}
          onChange={(e) => {
            setJsonInput(e.target.value);
            setResult(null);
            setParseError(null);
          }}
          placeholder='{ "@context": [...], "type": [...], "issuer": "did:web:...", ... }'
          rows={14}
          className="w-full bg-gray-800 border border-gray-700 text-white placeholder-gray-500 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 transition resize-none"
        />
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
                  <p className="text-lg font-bold text-emerald-400">Valid Credential</p>
                  <p className="text-sm text-emerald-500/70">
                    All structural checks passed.
                  </p>
                </div>
              </>
            ) : (
              <>
                <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
                <div>
                  <p className="text-lg font-bold text-red-400">Invalid Credential</p>
                  <p className="text-sm text-red-500/70">
                    {result.errors.length} issue{result.errors.length !== 1 ? "s" : ""} found.
                  </p>
                </div>
              </>
            )}
          </div>

          {/* Lista de erros detalhados */}
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
                  <p className="text-sm text-red-300">{err}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Botões */}
      <div className="flex gap-3">
        <button
          type="button"
          onClick={handleVerify}
          disabled={isPending || !jsonInput.trim()}
          className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-900 disabled:text-indigo-400 disabled:cursor-not-allowed text-white font-medium py-3 px-4 rounded-xl transition-colors cursor-pointer"
        >
          {isPending ? "Verifying..." : "Verify Credential"}
        </button>
        {(result || parseError) && (
          <button
            type="button"
            onClick={handleReset}
            className="bg-gray-800 hover:bg-gray-700 text-white font-medium py-3 px-6 rounded-xl transition-colors border border-gray-700 cursor-pointer"
          >
            Clear
          </button>
        )}
      </div>

    </div>
  );
}