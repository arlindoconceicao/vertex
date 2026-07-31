"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/locales/LanguageContext";
import {
  acceptCredential,
  revokeCredential,
} from "@/app/actions/credential-actions";

type Props = {
  credentialId: string;
  status: "PENDING" | "ACTIVE" | "REVOKED";
  role: "issuer" | "holder";
};

export default function CredentialActions({
  credentialId,
  status,
  role,
}: Props) {
  const { t } = useTranslation();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);

  // Issuer pode revogar credenciais ativas
  const canRevoke = role === "issuer" && status === "ACTIVE";

  // Se não pode fazer nada, não renderiza
  if (!canRevoke) return null;

  function confirmRevoke() {
    setError(null);
    startTransition(async () => {
      const result = await revokeCredential(credentialId);
      if (result.success) {
        setShowModal(false);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="space-y-3">
      {error && !showModal && (
        <div className="bg-red-950 border border-red-800 text-red-300 text-sm rounded-xl px-4 py-3">
          {error}
        </div>
      )}

      {canRevoke && (
        <button
          onClick={() => {
            setError(null);
            setShowModal(true);
          }}
          disabled={isPending}
          className="flex items-center gap-2 bg-red-600/20 hover:bg-red-600/30 border border-red-700 text-red-400 text-sm font-medium px-5 py-2.5 rounded-xl transition-colors cursor-pointer disabled:cursor-not-allowed"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
          </svg>
          {t("credentials.revoke")}
        </button>
      )}

      {/* Pop-up Modal de Confirmação de Revogação */}
      {showModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-3xl max-w-xl w-full p-8 shadow-2xl space-y-6 animate-in fade-in zoom-in duration-200">
            {/* Ícone e Título */}
            <div className="flex items-center gap-4 text-red-400">
              <div className="w-14 h-14 rounded-2xl bg-red-500/10 border border-red-500/30 flex items-center justify-center shrink-0">
                <svg className="w-7 h-7 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
              </div>
              <div>
                <h3 className="text-2xl font-extrabold text-white">{t("credentials.revokeModalTitle")}</h3>
                <p className="text-sm text-gray-400 font-mono mt-1 break-all">ID: {credentialId}</p>
              </div>
            </div>

            {/* Mensagem de Aviso em Destaque */}
            <div className="bg-red-950/60 border border-red-800/80 rounded-2xl p-5 text-base text-red-200 font-medium leading-relaxed">
              {t("credentials.revokeModalWarning")}
            </div>

            {error && (
              <div className="bg-red-950 border border-red-800 text-red-300 text-sm rounded-xl px-4 py-3">
                {error}
              </div>
            )}

            {/* Ações do Modal */}
            <div className="flex items-center justify-end gap-4 pt-2">
              <button
                type="button"
                onClick={() => {
                  setShowModal(false);
                  setError(null);
                }}
                disabled={isPending}
                className="px-6 py-3 bg-gray-800 hover:bg-gray-700 text-gray-200 text-base font-semibold rounded-xl transition-colors cursor-pointer disabled:opacity-50"
              >
                {t("credentials.cancel")}
              </button>
              <button
                type="button"
                onClick={confirmRevoke}
                disabled={isPending}
                className="flex items-center gap-2.5 px-6 py-3 bg-red-600 hover:bg-red-500 disabled:bg-red-900 text-white text-base font-semibold rounded-xl transition-colors cursor-pointer shadow-lg shadow-red-900/30 disabled:cursor-not-allowed"
              >
                {isPending ? (
                  <>
                    <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    {t("credentials.revoking")}
                  </>
                ) : (
                  t("credentials.confirmRevoke")
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}