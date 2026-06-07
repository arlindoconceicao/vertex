import Link from "next/link";

export default function NovoSchemaPage() {
  return (
    <main className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="text-center">
        <p className="text-gray-400 text-sm">Under construction</p>
        <Link href="/dashboard" className="text-indigo-400 hover:text-indigo-300 text-sm mt-3 block">
          ← Back to Dashboard
        </Link>
      </div>
    </main>
  );
}