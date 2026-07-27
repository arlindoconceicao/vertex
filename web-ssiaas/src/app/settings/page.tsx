import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import DidPairingComponent from "@/app/settings/DidPairingComponent";

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!session.user.cpf) redirect("/complete-registration");

  // Busca os dados de DID, chaves (ML-DSA e ML-KEM) e pareamento do usuário no banco
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      did: true,
      didPublicKey: true,
      didMlkemKey: true,
      didPairedAt: true,
      cpf: true,
      email: true,
    },
  });

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800 bg-gray-900">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center">
          <Link
            href="/dashboard"
            className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15.75 19.5L8.25 12l7.5-7.5"
              />
            </svg>
            Dashboard
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8">
        <div>
          <h1 className="text-2xl font-bold">Settings</h1>
          <p className="text-gray-400 text-sm mt-1">
            Manage your identity and account settings.
          </p>
        </div>

        {/* Profile Details — Read-only */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
          <h2 className="text-sm font-semibold text-gray-300 mb-4">Profile</h2>
          <div className="space-y-3">
            <div className="flex items-center justify-between bg-gray-800/60 rounded-xl px-4 py-3">
              <span className="text-sm text-gray-400">User ID</span>
              <span className="text-sm text-indigo-400 font-mono select-all">
                {user?.id}
              </span>
            </div>
            <div className="flex items-center justify-between bg-gray-800/60 rounded-xl px-4 py-3">
              <span className="text-sm text-gray-400">Email</span>
              <span className="text-sm text-white">{user?.email}</span>
            </div>
            <div className="flex items-center justify-between bg-gray-800/60 rounded-xl px-4 py-3">
              <span className="text-sm text-gray-400">CPF</span>
              <span className="text-sm text-white font-mono">
                {user?.cpf?.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4")}
              </span>
            </div>
          </div>
        </div>

        {/* DID & Mobile Pairing Section */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
          <h2 className="text-sm font-semibold text-gray-300 mb-1">
            Decentralized Identity (DID)
          </h2>
          <p className="text-xs text-gray-500 mb-6">
            Your DID is required to issue and receive verifiable credentials. Pairing is managed through your mobile signer app.
          </p>

          <DidPairingComponent
            userId={user?.id || ""}
            userEmail={user?.email || ""}
            initialDid={user?.did || null}
            initialPublicKey={user?.didPublicKey || null}
            initialMlkemKey={user?.didMlkemKey || null}
            initialPairedAt={user?.didPairedAt ? user.didPairedAt.toISOString() : null}
          />
        </div>
      </main>
    </div>
  );
}