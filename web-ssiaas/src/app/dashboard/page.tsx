import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { signOut } from "@/auth";
import CredentialTabs from "@/components/dashboard/CredentialTabs";
import {
  getIssuedCredentials,
  getReceivedCredentials,
} from "@/services/credentialService";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!session.user.cpf) redirect("/completar-cadastro");

  const [issuedResult, receivedResult] = await Promise.all([
    getIssuedCredentials(session.user.id),
    getReceivedCredentials(session.user.id),
  ]);

  const issued   = issuedResult.success   ? issuedResult.data   : [];
  const received = receivedResult.success ? receivedResult.data : [];

  return (
    <div className="min-h-screen bg-gray-950 text-white">

      {/* ── Navbar ── */}
      <header className="border-b border-gray-800 bg-gray-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">

          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-indigo-600">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.955 11.955 0 003 10c0 5.592 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
              </svg>
            </div>
            <span className="font-semibold tracking-tight">Vertex SSIaaS</span>
          </div>

          {/* Usuário + Logout */}
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-2">
              {session.user.image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={session.user.image}
                  alt="Foto"
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

      {/* ── Conteúdo ── */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8">

        {/* Saudação */}
        <div>
          <h1 className="text-2xl font-bold">
            Olá, {session.user.name?.split(" ")[0]} 👋
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            Gerencie suas credenciais verificáveis
          </p>
        </div>

        {/* Abas — toda a lógica condicional vive aqui */}
        <CredentialTabs issued={issued} received={received} />

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