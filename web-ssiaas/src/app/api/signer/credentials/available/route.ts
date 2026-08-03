import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSsiPqCore } from "@/lib/ssi-pq";
import { validateSignerToken } from "@/lib/signer-auth";

// GET /api/signer/credentials/available
// Retorna as VCs com status ACTIVE que possuem pdfFile e aguardam download pelo Holder
// Autenticação: M2M via Prova de Posse (Desafio Assinado ML-DSA)
export async function GET(request: Request) {
  const authCredentialBase64 = request.headers.get("x-signer-auth-credential");

  if (!authCredentialBase64) {
    return NextResponse.json(
      { error: "Missing required authentication header (x-signer-auth-credential)" },
      { status: 401 }
    );
  }

  try {
    const authCredentialJson = Buffer.from(authCredentialBase64, 'base64').toString('utf-8');
    const authCredential = JSON.parse(authCredentialJson);
    
    if (!authCredential || !authCredential.credential || !authCredential.credential.issuer_did) {
       return NextResponse.json({ error: "Invalid credential structure" }, { status: 401 });
    }

    const holderDid = authCredential.credential.issuer_did;

    // --- NOVA BARREIRA: Token Bearer HMAC M2M ---
    const authHeader = request.headers.get("authorization");
    if (!validateSignerToken(authHeader, holderDid)) {
      return NextResponse.json({ error: "Invalid or missing Bearer token (M2M)" }, { status: 401 });
    }

    // Buscar o usuário pelo DID para obter o DID Document
    const user = await prisma.user.findUnique({
      where: { did: holderDid },
      select: { didDocument: true },
    });

    if (!user || !user.didDocument) {
      return NextResponse.json({ error: "Signer DID not found or has no didDocument" }, { status: 401 });
    }

    // Verificar a Assinatura da Credencial Pós-Quântica
    const core = getSsiPqCore();
    
    let isValid = false;
    try {
      isValid = core.verifySignedCredential(authCredential, user.didDocument as object);
    } catch(err) {
      console.warn("Credential verification threw error:", err);
    }

    if (!isValid) {
      return NextResponse.json({ error: "Invalid cryptographic credential signature" }, { status: 401 });
    }

    // Validar os dados de tempo e ação do desafio na credencial
    const disclosures = authCredential.attribute_disclosures || [];
    const timestampDisclosure = disclosures.find((d: any) => d.path === 'subject.timestamp');
    const actionDisclosure = disclosures.find((d: any) => d.path === 'subject.action');

    if (!timestampDisclosure || !actionDisclosure || actionDisclosure.value !== 'available_credentials_auth') {
       return NextResponse.json({ error: "Invalid auth credential payload" }, { status: 401 });
    }

    const reqTime = new Date(timestampDisclosure.value).getTime();
    const now = Date.now();
    const diffMinutes = Math.abs(now - reqTime) / (1000 * 60);

    if (isNaN(reqTime) || diffMinutes > 2) {
      return NextResponse.json({ error: "Invalid or expired timestamp" }, { status: 401 });
    }

    // Buscar as credenciais ACTIVE e que têm pdfFile para este Holder
    const availableCredentials = await prisma.verifiableCredential.findMany({
      where: { 
        status: "ACTIVE",
        holder: { did: holderDid },
        pdfFile: { not: null }
      },
      select: {
        id: true,
        issuedAt: true,
        pdfDownloadedAt: true,
        issuer: {
          select: { did: true, name: true },
        },
      },
      orderBy: { issuedAt: "asc" },
    });

    const response = availableCredentials.map((vc) => ({
        credentialId: vc.id,
        createdAt: vc.issuedAt.toISOString(),
        pdfDownloadedAt: vc.pdfDownloadedAt ? vc.pdfDownloadedAt.toISOString() : null,
        issuer: {
          did: vc.issuer.did,
          name: vc.issuer.name,
        }
    }));

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error(
      "[GET /api/signer/credentials/available] Unexpected error:",
      error
    );
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
