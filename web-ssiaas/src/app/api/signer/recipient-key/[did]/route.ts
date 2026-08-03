import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSsiPqCore } from "@/lib/ssi-pq";
import { validateSignerToken } from "@/lib/signer-auth";

// GET /api/signer/recipient-key/:did
// Consumido pelo App Mobile Signer para buscar o DID Document (e chave ML-KEM)
// do destinatário antes de criptografar o arquivo PDF.
//
// Autenticação: M2M via Prova de Posse (Desafio Assinado ML-DSA)
export async function GET(
  request: Request,
  { params }: { params: Promise<{ did: string }> }
) {
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

    // 1. Buscar o usuário pelo DID (do signer) para validar a assinatura
    const user = await prisma.user.findUnique({
      where: { did: signerDid },
      select: { didDocument: true },
    });

    if (!user || !user.didDocument) {
      return NextResponse.json({ error: "Signer DID not found or has no didDocument" }, { status: 401 });
    }

    // 2. Verificar a Assinatura da Credencial Pós-Quântica
    const core = getSsiPqCore();
    
    let isValid = false;
    try {
      isValid = core.verifySignedCredential(authCredential, user.didDocument as object);
    } catch(err) {
      console.warn("Credential verification threw error:", err);
    }

    if (!isValid) {
      return NextResponse.json({ error: "Invalid Proof-of-Possession signature" }, { status: 401 });
    }

    // 3. Checar a prevenção de Replay Attack pela validade temporal (ex: 2 min)
    const issuedAtStr = authCredential.credential.issued_at;
    if (!issuedAtStr) {
      return NextResponse.json({ error: "Missing issuedAt timestamp" }, { status: 401 });
    }
    const issuedAt = new Date(issuedAtStr).getTime();
    const now = Date.now();
    
    if (now - issuedAt > 120000 || now - issuedAt < -60000) {
      return NextResponse.json({ error: "Auth credential expired (Replay protection)" }, { status: 401 });
    }

    // 4. Se chegou aqui, a PoP do Signer é válida.
    // Vamos buscar o DID Document do destinatário solicitado na URL.
    const { did: recipientDid } = await params;
    
    const recipientUser = await prisma.user.findUnique({
      where: { did: recipientDid },
      select: { didDocument: true }
    });

    if (!recipientUser || !recipientUser.didDocument) {
      return NextResponse.json({ error: "Recipient DID not found" }, { status: 404 });
    }

    return NextResponse.json(recipientUser.didDocument);

  } catch (error) {
    console.error("[GET /api/signer/recipient-key/:did] Unexpected error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
