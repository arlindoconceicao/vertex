import type { CredentialStats } from "@/lib/types";

type Props = {
  stats: CredentialStats;
};

// Painéis numéricos do Dashboard — recebe dados do Server Component (que consultou o banco via Prisma).
export default function StatsWidgets({ stats }: Props) {
  const widgets = [
    {
      label: "Received",
      value: stats.receivedCount,
      detail: `${stats.receivedByStatus.ACTIVE} active`,
      color: "emerald",
    },
    {
      label: "Issued",
      value: stats.issuedCount,
      detail: `${stats.issuedByStatus.PENDING} pending`,
      color: "indigo",
    },
    {
      label: "Pending Approval",
      value:
        stats.receivedByStatus.PENDING + stats.issuedByStatus.PENDING,
      detail: "awaiting action",
      color: "yellow",
    },
    {
      label: "Revoked",
      value:
        stats.receivedByStatus.REVOKED + stats.issuedByStatus.REVOKED,
      detail: "total",
      color: "red",
    },
  ];

  const colorMap: Record<string, { bg: string; text: string; detail: string }> = {
    emerald: {
      bg: "bg-emerald-500/10",
      text: "text-emerald-400",
      detail: "text-emerald-500/60",
    },
    indigo: {
      bg: "bg-indigo-500/10",
      text: "text-indigo-400",
      detail: "text-indigo-500/60",
    },
    yellow: {
      bg: "bg-yellow-500/10",
      text: "text-yellow-400",
      detail: "text-yellow-500/60",
    },
    red: {
      bg: "bg-red-500/10",
      text: "text-red-400",
      detail: "text-red-500/60",
    },
  };

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {widgets.map((w) => {
        const c = colorMap[w.color];
        return (
          <div
            key={w.label}
            className={`${c.bg} border border-gray-800 rounded-2xl px-5 py-4`}
          >
            <p className="text-xs text-gray-400 mb-1">{w.label}</p>
            <p className={`text-2xl font-bold ${c.text}`}>{w.value}</p>
            <p className={`text-xs mt-1 ${c.detail}`}>{w.detail}</p>
          </div>
        );
      })}
    </div>
  );
}