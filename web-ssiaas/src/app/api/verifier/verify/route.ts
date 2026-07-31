import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSsiPqCore } from "@/lib/ssi-pq";
import crypto from "crypto";

// POST /api/verifier/verify
// Verifica uma Credencial Verificável assinada.
// Endpoint público — não exige Auth.js.
export async function POST(request: NextRequest) {
  const contentType = request.headers.get("content-type") || "";

  // 1. Verificação via PDF Upload
  if (contentType.includes("multipart/form-data")) {
    let formData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
    }

    const file = formData.get("file") as File;
    if (!file) {
      return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }

    let buffer;
    try {
      const arrayBuffer = await file.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
    } catch {
      return NextResponse.json({ error: "Failed to read file" }, { status: 500 });
    }

    const calculatedPdfHash = crypto.createHash("sha256").update(buffer).digest("hex");

    const core = getSsiPqCore();
    let manifest;
    try {
      manifest = core.extractCredentialManifestFromPdf(buffer);
    } catch (e) {
      console.error("PDF Extraction Error:", e);
      return NextResponse.json({ error: `Invalid PDF or no SSI manifest found. Details: ${(e as Error).message}` }, { status: 400 });
    }

    const issuerDid = manifest?.signed_credential?.credential?.issuer_did;
    if (!issuerDid) {
      return NextResponse.json({ error: `No issuer DID found in credential. Manifest JSON: ${JSON.stringify(manifest, null, 2)}` }, { status: 400 });
    }

    const requestId = manifest?.signed_credential?.credential?.request_id || manifest?.signed_credential?.credential?.id;

    // Checagem de Status no Banco de Dados (Revogação)
    const dbCredential = await prisma.verifiableCredential.findFirst({
      where: {
        OR: [
          { pdfHash: calculatedPdfHash },
          ...(requestId ? [{ id: requestId }] : []),
        ],
      },
      select: { status: true, revokedAt: true },
    });

    if (dbCredential?.status === "REVOKED") {
      return NextResponse.json(
        {
          valid: false,
          errors: ["REVOKED_CREDENTIAL"],
          revokedAt: dbCredential.revokedAt,
        },
        { status: 200 }
      );
    }

    const issuer = await prisma.user.findUnique({
      where: { did: issuerDid },
      select: { didDocument: true }
    });

    if (!issuer || !issuer.didDocument) {
      return NextResponse.json({ valid: false, errors: ["Issuer DID not registered in platform."] }, { status: 200 });
    }

    let verification;
    try {
      verification = core.verifySignedCredentialPdf(buffer, issuer.didDocument as object);
    } catch (e) {
      return NextResponse.json({ valid: false, errors: ["Verification failed cryptographically."] }, { status: 200 });
    }

    if (!verification || !verification.valid) {
      return NextResponse.json({ valid: false, errors: ["A assinatura do PDF não é válida ou foi adulterada."] }, { status: 200 });
    }

    // Se houver schemaId no manifest, buscamos a estrutura
    let schemaStructure = null;
    const schemaId = manifest.signed_credential?.credential?.schema_id;
    if (schemaId) {
      const schema = await prisma.credentialSchema.findUnique({
        where: { id: schemaId },
        select: { jsonSchema: true }
      });
      if (schema) {
        schemaStructure = schema.jsonSchema;
      }
    }

    // Remove attribute_hashes pois são informações técnicas de baixo nível
    const metadataToReturn = JSON.parse(JSON.stringify(manifest.signed_credential.credential));
    if (metadataToReturn.subject?.attribute_hashes) {
      delete metadataToReturn.subject.attribute_hashes;
    }
    
    // Retorna o manifesto completo (JSON embutido no PDF) para o usuário
    return NextResponse.json({ 
      valid: true, 
      errors: [], 
      metadata: {
        ...metadataToReturn,
        revealed_attributes: manifest.signed_credential.attribute_disclosures?.map((d: any) => ({
          path: d.path,
          value: d.value
        }))
      },
      schemaStructure: schemaStructure
    }, { status: 200 });
  }

  // 2. Verificação via Hash (Proof of Existence)
  if (contentType.includes("application/json")) {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { pdfHash } = body as { pdfHash?: string };

    if (pdfHash && typeof pdfHash === "string") {
      const credential = await prisma.verifiableCredential.findFirst({
        where: { pdfHash },
        select: { status: true, revokedAt: true, metadata: true, vcPayload: true }
      });

      if (!credential) {
        return NextResponse.json({ valid: false, errors: ["Nenhuma credencial encontrada para este hash de PDF."] }, { status: 200 });
      }

      if (credential.status === "REVOKED") {
        return NextResponse.json(
          {
            valid: false,
            errors: ["REVOKED_CREDENTIAL"],
            revokedAt: credential.revokedAt,
          },
          { status: 200 }
        );
      }

      const metadata = credential.metadata || credential.vcPayload || {};
      let schemaStructure = null;

      const schemaId = (metadata as any).schemaId || (metadata as any).credentialSubject?.credentialSchema?.id;
      if (schemaId) {
        const schema = await prisma.credentialSchema.findUnique({
          where: { id: schemaId },
          select: { jsonSchema: true }
        });
        if (schema) {
          schemaStructure = schema.jsonSchema;
        }
      }

      return NextResponse.json({ 
        valid: true, 
        errors: [], 
        metadata: metadata,
        schemaStructure: schemaStructure
      }, { status: 200 });
    }

    return NextResponse.json({ error: "Missing pdfHash" }, { status: 400 });
  }

  return NextResponse.json({ error: "Unsupported Content-Type" }, { status: 415 });
}