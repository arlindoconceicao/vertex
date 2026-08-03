import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSsiPqCore, decodeBase58Btc } from "@/lib/ssi-pq";
import { validateSignerToken } from "@/lib/signer-auth";

// GET /api/signer/requests/pending
// Consumido pelo App Mobile Signer via polling.
// Retorna todas as VCs com status PENDING aguardando assinatura do emissor.
//
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

    const signerDid = authCredential.credential.issuer_did;

    // --- NOVA BARREIRA: Token Bearer HMAC M2M ---
    const authHeader = request.headers.get("authorization");
    if (!validateSignerToken(authHeader, signerDid)) {
      return NextResponse.json({ error: "Invalid or missing Bearer token (M2M)" }, { status: 401 });
    }

    // 2. Buscar o usuário pelo DID para obter o DID Document
    const user = await prisma.user.findUnique({
      where: { did: signerDid },
      select: { didDocument: true },
    });

    if (!user || !user.didDocument) {
      return NextResponse.json({ error: "Signer DID not found or has no didDocument" }, { status: 401 });
    }

    // 3. Verificar a Assinatura da Credencial Pós-Quântica
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

    // 4. Validar os dados de tempo e ação do desafio na credencial
    const disclosures = authCredential.attribute_disclosures || [];
    const timestampDisclosure = disclosures.find((d: any) => d.path === 'subject.timestamp');
    const actionDisclosure = disclosures.find((d: any) => d.path === 'subject.action');

    if (!timestampDisclosure || !actionDisclosure || actionDisclosure.value !== 'pending_requests_auth') {
       return NextResponse.json({ error: "Invalid auth credential payload" }, { status: 401 });
    }

    const reqTime = new Date(timestampDisclosure.value).getTime();
    const now = Date.now();
    const diffMinutes = Math.abs(now - reqTime) / (1000 * 60);

    if (isNaN(reqTime) || diffMinutes > 2) {
      return NextResponse.json({ error: "Invalid or expired timestamp" }, { status: 401 });
    }

    // 4. Buscar apenas as credenciais em que o signer é o Emissor (Issuer)
    const pendingCredentials = await prisma.verifiableCredential.findMany({
      where: { 
        status: "PENDING",
        issuer: { did: signerDid }
      },
      select: {
        id: true,
        issuedAt: true,
        vcPayload: true,
        issuer: {
          select: { did: true, name: true },
        },
        holder: {
          select: { did: true },
        },
      },
      orderBy: { issuedAt: "asc" },
    });

    // Mapeia para o formato exato do contrato em api-architecture.md.
    const response = pendingCredentials.map((vc) => {
      const payload = (vc.vcPayload && typeof vc.vcPayload === "object") ? JSON.parse(JSON.stringify(vc.vcPayload)) : {};
      if (vc.issuer?.did) {
        payload.issuer = vc.issuer.did;
      }
      if (vc.holder?.did && payload.credentialSubject && typeof payload.credentialSubject === "object") {
        payload.credentialSubject.id = vc.holder.did;
      }
      return {
        requestId: vc.id,
        createdAt: vc.issuedAt.toISOString(),
        issuer: {
          did: vc.issuer.did,
          name: vc.issuer.name,
        },
        unsignedPayload: payload,
      };
    });

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error(
      "[GET /api/signer/requests/pending] Unexpected error:",
      error
    );
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}