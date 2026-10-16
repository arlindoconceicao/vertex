import Link from "next/link";
import { DashboardCredential } from "@/lib/types";

type Props = {
  batchId: string;
  credentials: DashboardCredential[];
};

export default function BatchCard({ batchId, credentials }: Props) {
  const schemaSnapshot = credentials[0]?.schemaSnapshot;
  const total = credentials.length;
  const accepted = credentials.filter(c => c.status !== "OFFERED" && c.status !== "REJECTED").length;

  return (
    <div className="bg-surface border border-border rounded-2xl p-5 hover:border-primary-ring/50 transition-colors flex flex-col justify-between h-full group">
      <div>
        <div className="flex justify-between items-start mb-3">
          <div className="flex items-center gap-2">
            <div className="bg-blue-500/20 text-blue-400 text-xs px-2.5 py-1 rounded-full font-semibold uppercase tracking-wider">
              LOTE
            </div>
            <span className="text-xs text-text-muted font-mono">{batchId.slice(0, 8)}...</span>
          </div>
        </div>
        <h3 className="font-semibold text-text-main line-clamp-2 mb-1">
          {schemaSnapshot?.name || "Credential"}
        </h3>
        <p className="text-xs text-text-muted mb-4">
          Versão {schemaSnapshot?.version || "1.0"}
        </p>
      </div>
      
      <div className="space-y-3 mt-auto pt-4 border-t border-border">
        <div className="flex justify-between items-center text-sm">
          <span className="text-text-muted">Total no Lote:</span>
          <span className="font-medium text-text-main">{total}</span>
        </div>
        <div className="flex justify-between items-center text-sm">
          <span className="text-text-muted">Aceitas:</span>
          <span className="font-medium text-emerald-400">{accepted}</span>
        </div>
        
        {/* Link para página de detalhes do lote */}
        <div className="w-full text-center mt-2 pt-2">
           <Link href={`/credentials/batch/${batchId}`} className="text-xs text-primary-text font-medium group-hover:underline">
             Visualização consolidada
           </Link>
        </div>
      </div>
    </div>
  );
}
