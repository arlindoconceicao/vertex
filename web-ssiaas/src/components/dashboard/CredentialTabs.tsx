"use client";

import { useState } from "react";
import Link from "next/link";
import type { DashboardCredential } from "@/lib/types";
import CredentialCard from "./CredentialCard";
import UserSearch from "@/components/UserSearch";

type Tab = "received" | "issued";

type Props = {
  issued: DashboardCredential[];
  received: DashboardCredential[];
};

export default function CredentialTabs({ issued, received }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("received");

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "received", label: "Received Credentials", count: received.length },
    { id: "issued",   label: "Issued Credentials",   count: issued.length  },
  ];

  return (
    <div>
      {/* ── Seletor de abas ── */}
      <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-xl p-1 w-fit mb-8">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          const isHolder = tab.id === "received";
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer ${
                isActive
                  ? "bg-gray-800 text-white shadow"
                  : "text-gray-500 hover:text-gray-300"
              }`}
            >
              {tab.label}
              <span
                className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                  isActive
                    ? isHolder
                      ? "bg-emerald-500/20 text-emerald-400"
                      : "bg-indigo-500/20 text-indigo-400"
                    : "bg-gray-700 text-gray-500"
                }`}
              >
                {tab.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Aba: Credenciais Recebidas (Holder) ── */}
      {activeTab === "received" && (
        <CredentialGrid
          credentials={received}
          perspective="received"
          emptyMessage="You haven't received any credentials yet."
        />
      )}

      {/* ── Aba: Credenciais Emitidas (Issuer) ── */}
      {activeTab === "issued" && (
        <div className="space-y-8">

          {/* Ações do Issuer */}
          <div className="flex flex-wrap gap-3">
            <Link
              href="/schemas/new"
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-4 py-2.5 rounded-xl transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              Create Schema
            </Link>
            <Link
              href="/credentials/issue"
              className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 text-white text-sm font-medium px-4 py-2.5 rounded-xl transition-colors border border-gray-700"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
              </svg>
              Issue Credential
            </Link>
          </div>

          {/* Busca por CPF */}
          <div>
            <p className="text-sm text-gray-400 mb-3">
              Search for a user to issue a credential
            </p>
            <UserSearch />
          </div>

          {/* Histórico de emissões */}
          <div>
            <p className="text-sm text-gray-400 mb-4">Issue History</p>
            <CredentialGrid
              credentials={issued}
              perspective="issued"
              emptyMessage="You haven't issued any credentials yet."
            />
          </div>

        </div>
      )}
    </div>
  );
}


type CredentialGridProps = {
  credentials: DashboardCredential[];
  perspective: "issued" | "received";
  emptyMessage: string;
};

function CredentialGrid({ credentials, perspective, emptyMessage }: CredentialGridProps) {
  if (credentials.length === 0) {
    return (
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
        <p className="text-gray-500 text-sm">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {credentials.map((vc) => (
        <CredentialCard key={vc.id} credential={vc} perspective={perspective} />
      ))}
    </div>
  );
}