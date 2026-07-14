import Link from "next/link";
import VerifierForm from "@/components/verifier/VerifierForm";

// Página pública: qualquer pessoa pode verificar uma credencial sem ter conta na plataforma
// O verificador não precisa de relação prévia com o emissor nem com o titular
export default function VerifyPage() {
  return (
    <div className="min-h-screen bg-gray-950 text-white">

      <header className="border-b border-gray-800 bg-gray-900">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-indigo-600">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.955 11.955 0 003 10c0 5.592 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
              </svg>
            </div>
            <span className="font-semibold tracking-tight">Vertex SSIaaS</span>
          </div>
          <Link
            href="/login"
            className="text-sm text-gray-400 hover:text-white transition-colors"
          >
            Log in
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-10">

        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-indigo-600/20 mb-4">
            <svg className="w-7 h-7 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.955 11.955 0 003 10c0 5.592 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold">Credential Verifier</h1>
          <p className="text-gray-400 text-sm mt-2 max-w-md mx-auto">
            Paste a W3C Verifiable Credential payload below to check its structural
            integrity, signature presence and expiration status.
          </p>
          <p className="text-xs text-gray-600 mt-2">
            No account required — this is a public verification service.
          </p>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 sm:p-8">
          <VerifierForm />
        </div>

        {/* Explicação dos checks realizados */}
        <div className="mt-10 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl px-5 py-4 text-center">
            <svg className="w-6 h-6 text-indigo-400 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
            <p className="text-sm font-medium text-white">W3C Structure</p>
            <p className="text-xs text-gray-500 mt-1">
              Validates required fields per the VC Data Model spec.
            </p>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-2xl px-5 py-4 text-center">
            <svg className="w-6 h-6 text-indigo-400 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            </svg>
            <p className="text-sm font-medium text-white">Proof Presence</p>
            <p className="text-xs text-gray-500 mt-1">
              Checks that a cryptographic signature exists in the payload.
            </p>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-2xl px-5 py-4 text-center">
            <svg className="w-6 h-6 text-indigo-400 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-sm font-medium text-white">Expiration</p>
            <p className="text-xs text-gray-500 mt-1">
              Verifies the credential has not passed its expiration date.
            </p>
          </div>
        </div>

      </main>

      <footer className="border-t border-gray-800 mt-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 h-12 flex items-center justify-between">
          <span className="text-xs text-gray-600">Vertex Web SSIaaS · UNIFESP</span>
          <span className="text-xs text-gray-600">Funded by FAPESP</span>
        </div>
      </footer>

    </div>
  );
}