"use client";

import { useState } from "react";
import type { VerifiableCredential } from "@/services/credentialService";
import CredentialCard from "./CredentialCard";

type Props = {
  issued: VerifiableCredential[];
  received: VerifiableCredential[];
};

type Tab = "received" | "issued";

export default function CredentialTabs({ issued, received }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("received");

  const tabs: { id: Tab; label: string; count: number; color: string }[] = [
    {
      id: "received",
      label: "Minhas Credenciais",
      count: received.length,
      color: "emerald",
    },
    {
      id: "issued",
      label: "Emitidas por mim",
      count: issued.length,
      color: "indigo",
    },
  ];

  const activeList = activeTab === "received" ? received : issued;

  return (
    <div>
      {/* Tab Headers */}
      <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-xl p-1 w-fit mb-6">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer ${
              activeTab === tab.id
                ? "bg-gray-800 text-white shadow"
                : "text-gray-500 hover:text-gray-300"
            }`}
          >
            {tab.label}
            <span
              className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                activeTab === tab.id
                  ? tab.color === "emerald"
                    ? "bg-emerald-500/20 text-emerald-400"
                    : "bg-indigo-500/20 text-indigo-400"
                  : "bg-gray-700 text-gray-500"
              }`}
            >
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeList.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center bg-gray-900 border border-gray-800 rounded-2xl">
          <svg
            className="w-10 h-10 text-gray-700 mb-3"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-.623 3.05 3.745 3.745 0 01-3.05.623 3.745 3.745 0 01-3.068 1.593 3.745 3.745 0 01-3.068-1.593 3.745 3.745 0 01-3.05-.623 3.745 3.745 0 01-.623-3.05A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 01.623-3.05 3.745 3.745 0 013.05-.623A3.745 3.745 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.745 3.745 0 013.05.623 3.745 3.745 0 01.623 3.05A3.745 3.745 0 0121 12z"
            />
          </svg>
          <p className="text-gray-500 text-sm">Nenhuma credencial aqui ainda.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {activeList.map((vc) => (
            <CredentialCard
              key={vc.id}
              credential={vc}
              perspective={activeTab}
            />
          ))}
        </div>
      )}
    </div>
  );
}