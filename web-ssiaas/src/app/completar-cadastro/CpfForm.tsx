"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { updateCpf } from "@/app/actions/update-cpf";

export default function CpfForm() {
  const { update } = useSession();
  const router = useRouter();

  const [cpf, setCpf] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // 
  function handleCpfChange(e: React.ChangeEvent<HTMLInputElement>) {
    const digits = e.target.value.replace(/\D/g, "").slice(0, 11);
    const masked = digits
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
    setCpf(masked);
  }

  async function handleSubmit(formData: FormData) {
    setIsLoading(true);
    setError(null);

    const result = await updateCpf(formData);

    if (!result.success) {
      setError(result.error);
      setIsLoading(false);
      return;
    }

    // Força o Auth.js a re-buscar a sessão do banco com o CPF atualizado.
    // Sem isso, o middleware ainda veria cpf: null e bloquearia o acesso.
    await update();

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <form action={handleSubmit} className="space-y-5">
      <div>
        <label
          htmlFor="cpf"
          className="block text-sm font-medium text-gray-300 mb-2"
        >
          CPF
        </label>
        <input
          id="cpf"
          name="cpf"
          type="text"
          inputMode="numeric"
          placeholder="000.000.000-00"
          value={cpf}
          onChange={handleCpfChange}
          required
          className="w-full bg-gray-800 border border-gray-700 text-white placeholder-gray-500 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
        />
      </div>

      {/* Mensagem de erro da Server Action */}
      {error && (
        <div className="flex items-center gap-2 bg-red-950 border border-red-800 text-red-300 text-sm rounded-xl px-4 py-3">
          <svg
            className="w-4 h-4 shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
            />
          </svg>
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={isLoading || cpf.replace(/\D/g, "").length < 11}
        className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-900 disabled:text-indigo-400 disabled:cursor-not-allowed text-white font-medium py-3 px-4 rounded-xl transition-colors duration-200 cursor-pointer"
      >
        {isLoading ? (
          <span className="flex items-center justify-center gap-2">
            <svg
              className="animate-spin w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8v8z"
              />
            </svg>
            Salvando...
          </span>
        ) : (
          "Confirm and access the platform"
        )}
      </button>
    </form>
  );
}