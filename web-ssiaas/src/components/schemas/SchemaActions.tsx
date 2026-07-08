"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { publishSchema, toggleVisibility } from "@/app/actions/schema-actions";

type Props = {
  schemaId: string;
  visibility: "PUBLIC" | "PRIVATE";
  isPublished: boolean;
};

export default function SchemaActions({
  schemaId,
  visibility,
  isPublished,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handlePublish() {
    setError(null);
    startTransition(async () => {
      const result = await publishSchema(schemaId);
      if (result.success) {
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  function handleToggleVisibility() {
    setError(null);
    const newVisibility = visibility === "PUBLIC" ? "PRIVATE" : "PUBLIC";
    startTransition(async () => {
      const result = await toggleVisibility(schemaId, newVisibility);
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

      <div className="flex flex-wrap gap-3">
        {/* Publicar no IPFS — só aparece se ainda não publicou */}
        {!isPublished && (
          <button
            onClick={handlePublish}
            disabled={isPending}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-900 disabled:text-indigo-400 text-white text-sm font-medium px-4 py-2.5 rounded-xl transition-colors cursor-pointer disabled:cursor-not-allowed"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z" />
            </svg>
            {isPending ? "Publishing..." : "Publish to IPFS"}
          </button>
        )}

        {/* Alternar visibilidade */}
        <button
          onClick={handleToggleVisibility}
          disabled={isPending}
          className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 disabled:bg-gray-900 text-white text-sm font-medium px-4 py-2.5 rounded-xl transition-colors border border-gray-700 cursor-pointer disabled:cursor-not-allowed"
        >
          {visibility === "PRIVATE" ? (
            <>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 10.5V6.75a4.5 4.5 0 119 0v3.75M3.75 21.75h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H3.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
              </svg>
              Make Public
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
              </svg>
              Make Private
            </>
          )}
        </button>
      </div>
    </div>
  );
}