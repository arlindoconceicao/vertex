"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Holder pode aceitar credenciais pendentes
  const canAccept = role === "holder" && status === "PENDING";

  // Issuer pode revogar credenciais ativas
  const canRevoke = role === "issuer" && status === "ACTIVE";

  // Se não pode fazer nada, não renderiza
  if (!canAccept && !canRevoke) return null;

  function handleAccept() {
    setError(null);
    startTransition(async () => {
      const result = await acceptCredential(credentialId);
      if (result.success) {
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  function handleRevoke() {
    setError(null);

    // Confirmação antes de revogar — ação destrutiva
    const confirmed = window.confirm(
      "Are you sure you want to revoke this credential? This action cannot be undone."
    );
    if (!confirmed) return;

    startTransition(async () => {
      const result = await revokeCredential(credentialId);
      if (result.success) {
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="bg-red-950 border border-red-800 text-red-300 text-sm rounded-xl px-4 py-3">
          {error}
        </div>
      )}

      {canAccept && (
        <button
          onClick={handleAccept}
          disabled={isPending}
          className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-900 disabled:text-emerald-400 text-white text-sm font-medium px-5 py-2.5 rounded-xl transition-colors cursor-pointer disabled:cursor-not-allowed"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
          {isPending ? "Accepting..." : "Accept Credential"}
        </button>
      )}

      {canRevoke && (
        <button
          onClick={handleRevoke}
          disabled={isPending}
          className="flex items-center gap-2 bg-red-600/20 hover:bg-red-600/30 border border-red-700 text-red-400 text-sm font-medium px-5 py-2.5 rounded-xl transition-colors cursor-pointer disabled:cursor-not-allowed"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
          </svg>
          {isPending ? "Revoking..." : "Revoke Credential"}
        </button>
      )}
    </div>
  );
}