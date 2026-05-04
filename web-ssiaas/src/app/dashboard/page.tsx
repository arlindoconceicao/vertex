import { auth, signOut } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";

import UserSearch from "@/components/UserSearch";
import CredentialTabs from "@/components/dashboard/CredentialTabs";
import {
  getIssuedCredentials,
  getReceivedCredentials,
} from "@/services/credentialService";

export default async function DashboardPage() {
  const session = await auth();

  if (!session?.user) redirect("/login");
  if (!session.user.cpf) redirect("/completar-cadastro");

  // Busca paralela — não bloqueia uma enquanto a outra carrega
  const [issuedResult, receivedResult] = await Promise.all([
    getIssuedCredentials(session.user.id),
    getReceivedCredentials(session.user.id),
  ]);

  const issued = issuedResult.success ? issuedResult.data : [];
  const received = receivedResult.success ? receivedResult.data : [];

  return (
    <div className="min-h-screen bg-gray-950 text-white">

      {/* Navbar */}
      <header className="border-b border-gray-800 bg-gray-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-indigo-600">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.955 11.955 0 003 10c0 5.592 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
              </svg>
            </div>
            <span className="font-semibold text-white tracking-tight">Vertex SSIaaS</span>
          </div>

          {/* Usuário + Logout */}
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-2">
              {session.user.image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={session.user.image}
                  alt="Foto de perfil"
                  className="w-8 h-8 rounded-full"
                />
              )}
              <span className="text-sm text-gray-300">{session.user.name}</span>
            </div>

            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/login" });
              }}
            >
              <button
                type="submit"
                className="text-sm text-gray-400 hover:text-white transition-colors cursor-pointer"
              >
                Sair
              </button>
            </form>
          </div>
        </div>
      </header>

      {/* ── Conteúdo principal ── */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">

        {/* Saudação */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">
            Olá, {session.user.name?.split(" ")[0]}!
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            Gerencie suas credenciais verificáveis
          </p>
        </div>

        {/* ── Ações rápidas ── */}
        <div className="flex flex-wrap gap-3 mb-10">
        <Link
            href="/schemas/novo"
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-4 py-2.5 rounded-xl transition-colors"
        >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Criar Schema
        </Link>
        <Link
            href="/credenciais/emitir"
            className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 text-white text-sm font-medium px-4 py-2.5 rounded-xl transition-colors border border-gray-700"
        >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
            </svg>
            Emitir Credencial
        </Link>
        </div>

        {/* ── Busca de usuários para emissão ── */}
        <div className="mb-10">
          <p className="text-sm text-gray-400 mb-3">Buscar usuário para emitir credencial</p>
          <UserSearch />
        </div>

        {/* Abas de credenciais */}
        <div>
          <h2 className="text-lg font-semibold text-white mb-6">
            Credenciais
          </h2>
          <CredentialTabs issued={issued} received={received} />
        </div>
      </main>

      {/* ── Rodapé ── */}
      <footer className="border-t border-gray-800 mt-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-12 flex items-center justify-between">
          <span className="text-xs text-gray-600">Vertex Web SSIaaS · UNIFESP</span>
          <span className="text-xs text-gray-600">Financiado pela FAPESP</span>
        </div>
      </footer>

    </div>
  );
}

// ── Componente auxiliar: Empty State ──────────────────────────────────────────
type IconType = "document" | "send" | "inbox" | "badge";

function EmptyState({
  icon,
  message,
  action,
}: {
  icon: IconType;
  message: string;
  action?: { label: string; href: string };
}) {
  const icons: Record<IconType, React.ReactNode> = {
    document: (
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
    ),
    send: (
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
    ),
    inbox: (
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 13.5h3.86a2.25 2.25 0 012.012 1.244l.256.512a2.25 2.25 0 002.013 1.244h3.218a2.25 2.25 0 002.013-1.244l.256-.512a2.25 2.25 0 012.013-1.244h3.859m-19.5.338V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18v-4.162c0-.224-.034-.447-.1-.661L19.24 5.338a2.25 2.25 0 00-2.15-1.588H6.911a2.25 2.25 0 00-2.15 1.588L2.35 13.177a2.25 2.25 0 00-.1.661z" />
    ),
    badge: (
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-.623 3.05 3.745 3.745 0 01-3.05.623 3.745 3.745 0 01-3.068 1.593 3.745 3.745 0 01-3.068-1.593 3.745 3.745 0 01-3.05-.623 3.745 3.745 0 01-.623-3.05A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 01.623-3.05 3.745 3.745 0 013.05-.623A3.745 3.745 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.745 3.745 0 013.05.623 3.745 3.745 0 01.623 3.05A3.745 3.745 0 0121 12z" />
    ),
  };

  return (
    <div className="flex flex-col items-center justify-center py-6 text-center">
      <svg
        className="w-8 h-8 text-gray-700 mb-2"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        {icons[icon]}
      </svg>
      <p className="text-gray-500 text-sm">{message}</p>
      {action && (
        <Link
            href={action.href}
            className="text-indigo-400 hover:text-indigo-300 text-xs mt-2 transition-colors"
        >
            {action.label} →
        </Link>
        )}
    </div>
  );
}