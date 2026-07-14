// Tipos que representam os dados reais vindos do Prisma,
// já serializados (datas como string) para cruzar a fronteira

export type DashboardCredential = {
  id: string;
  status: "PENDING" | "ACTIVE" | "REVOKED";
  issuedAt: string;
  expiresAt: string | null;
  issuer: {
    id: string;
    name: string | null;
    email: string | null;
  };
  holder: {
    id: string;
    name: string | null;
    email: string | null;
  };
  schemaSnapshot: {
    id: string;
    name: string;
    version: string;
  } | null;
  credentialType: string;
};

export type CredentialStats = {
  issuedCount: number;
  receivedCount: number;
  issuedByStatus: StatusBreakdown;
  receivedByStatus: StatusBreakdown;
};

type StatusBreakdown = {
  PENDING: number;
  ACTIVE: number;
  REVOKED: number;
};