export type VCStatus = "PENDING" | "ACTIVE" | "REVOKED";

// Representa o "credentialSubject" da especificação W3C: os dados reais que a credencial afirma sobre o Holder.
export type CredentialSubject = {
  id: string; // DID ou identificador do Holder
  [key: string]: unknown; // Campos flexíveis definidos pelo Schema
};

// Representa uma Credencial Verificável completa.
// Posteriormente, o campo "proof" será preenchido com a assinatura criptográfica.
export type VerifiableCredential = {
  id: string;
  status: VCStatus;
  issuedAt: Date;
  expiresAt: Date | null;

  // Dados do Issuer
  issuer: {
    id: string;
    name: string | null;
    email: string | null;
  };

  // Dados do Holder
  holder: {
    id: string;
    name: string | null;
    email: string | null;
  };

  // Schema que originou esta credencial
  schema: {
    id: string;
    name: string;
    version: string;
  };

  // Payload W3C completo 
  vcPayload: {
    "@context": string[];
    type: string[];
    issuer: string;
    issuanceDate: string;
    expirationDate?: string;
    credentialSubject: CredentialSubject;
    proof?: object; // Assinatura criptográfica 
  };
};

// Parâmetros para emissão de uma nova credencial
export type IssueCredentialParams = {
  issuerId: string;
  holderEmail: string; // Busca-se o Holder pelo e-mail
  schemaId: string;
  credentialSubject: CredentialSubject;
  expiresAt?: Date;
};

// Resultado padronizado para todas as operações do serviço
export type ServiceResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };



// Dados temporários para desenhar a UI.
// Será substituído pela lógica real de Prisma + SSI na Sprint 2.

const MOCK_ISSUED: VerifiableCredential[] = [
  {
    id: "mock-issued-1",
    status: "ACTIVE",
    issuedAt: new Date("2025-04-01"),
    expiresAt: new Date("2026-04-01"),
    issuer: { id: "user-1", name: "Você", email: "voce@unifesp.br" },
    holder: { id: "user-2", name: "João Silva", email: "joao@example.com" },
    schema: { id: "schema-1", name: "Certificado de Conclusão", version: "1.0" },
    vcPayload: {
      "@context": ["https://www.w3.org/2018/credentials/v1"],
      type: ["VerifiableCredential", "CertificadoConclusao"],
      issuer: "did:web:unifesp.br",
      issuanceDate: "2025-04-01T00:00:00Z",
      credentialSubject: { id: "did:example:joao", curso: "Engenharia da Computação" },
    },
  },
  {
    id: "mock-issued-2",
    status: "PENDING",
    issuedAt: new Date("2025-04-20"),
    expiresAt: null,
    issuer: { id: "user-1", name: "Você", email: "voce@unifesp.br" },
    holder: { id: "user-3", name: "Maria Santos", email: "maria@example.com" },
    schema: { id: "schema-2", name: "Diploma de Graduação", version: "1.0" },
    vcPayload: {
      "@context": ["https://www.w3.org/2018/credentials/v1"],
      type: ["VerifiableCredential", "Diploma"],
      issuer: "did:web:unifesp.br",
      issuanceDate: "2025-04-20T00:00:00Z",
      credentialSubject: { id: "did:example:maria", grau: "Bacharel" },
    },
  },
];

const MOCK_RECEIVED: VerifiableCredential[] = [
  {
    id: "mock-received-1",
    status: "ACTIVE",
    issuedAt: new Date("2025-03-15"),
    expiresAt: new Date("2027-03-15"),
    issuer: { id: "user-4", name: "UNIFESP", email: "registro@unifesp.br" },
    holder: { id: "user-1", name: "breno", email: "breno@unifesp.br" },
    schema: { id: "schema-3", name: "Vínculo Institucional", version: "1.0" },
    vcPayload: {
      "@context": ["https://www.w3.org/2018/credentials/v1"],
      type: ["VerifiableCredential", "VinculoInstitucional"],
      issuer: "did:web:unifesp.br",
      issuanceDate: "2025-03-15T00:00:00Z",
      credentialSubject: { id: "did:example:breno", papel: "Pesquisador FAPESP" },
    },
  },
];


// Posteriormente, aqui entrarão a busca do Holder, a montagem do payload W3C/JSON-LD e a assinatura criptográfica.

export async function issueCredential(
  params: IssueCredentialParams
): Promise<ServiceResult<VerifiableCredential>> {
  console.log("[credentialService] issueCredential chamado com:", params);

  // TODO:
  // 1. Buscar o Holder pelo holderEmail no banco
  // 2. Buscar o Schema pelo schemaId
  // 3. Montar o payload W3C/JSON-LD
  // 4. Assinar com a chave privada do Issuer
  // 5. Salvar no banco via prisma.verifiableCredential.create()

  return {
    success: false,
    error: "Emissão de credenciais será implementada posteriormente.",
  };
}

/**
 * Retorna todas as credenciais que o usuário emitiu (papel de Issuer).
 * TODO: Substituir o mock por prisma.verifiableCredential.findMany()
 * filtrando por issuerId.
 */
export async function getIssuedCredentials(
  issuerId: string
): Promise<ServiceResult<VerifiableCredential[]>> {
  console.log("[credentialService] getIssuedCredentials para issuer:", issuerId);

  // TODO: prisma.verifiableCredential.findMany({ where: { issuerId } })
  return { success: true, data: MOCK_ISSUED };
}

/**
 * Retorna todas as credenciais que o usuário recebeu (papel de Holder).
 * TODO: Substituir o mock por prisma.verifiableCredential.findMany()
 * filtrando por holderId.
 */
export async function getReceivedCredentials(
  holderId: string
): Promise<ServiceResult<VerifiableCredential[]>> {
  console.log("[credentialService] getReceivedCredentials para holder:", holderId);

  // TODO: prisma.verifiableCredential.findMany({ where: { holderId } })
  return { success: true, data: MOCK_RECEIVED };
}