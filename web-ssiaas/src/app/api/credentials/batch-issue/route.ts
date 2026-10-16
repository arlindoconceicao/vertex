import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import crypto from "crypto";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const { schemaId, expiresAt, credentials } = await request.json();

    if (!schemaId || !Array.isArray(credentials) || credentials.length === 0) {
      return NextResponse.json({ error: "Invalid data." }, { status: 400 });
    }

    const schema = await prisma.credentialSchema.findUnique({
      where: { id: schemaId },
    });

    if (!schema) {
      return NextResponse.json({ error: "Schema not found." }, { status: 404 });
    }

    const issuer = await prisma.user.findUnique({
      where: { id: session.user.id },
    });

    if (!issuer?.did) {
      return NextResponse.json(
        { error: "You must register a DID before issuing credentials." },
        { status: 400 }
      );
    }

    // Processar expiração, se houver
    let expirationDate: Date | null = null;
    if (expiresAt) {
      expirationDate = new Date(expiresAt);
      if (expirationDate <= new Date()) {
        return NextResponse.json(
          { error: "Expiration date must be in the future." },
          { status: 400 }
        );
      }
    }

    // Preparar dados do lote
    const batchId = crypto.randomUUID();
    const emails = credentials.map((c: any) => c.holderEmail);

    const holders = await prisma.user.findMany({
      where: { email: { in: emails } },
      select: { id: true, email: true },
    });

    const holderMap = new Map(holders.map(h => [h.email, h.id]));

    // Construir VCs baseadas nos templates W3C
    const now = new Date();
    
    // Configurações do ambiente SSI
    const ISSUANCE_DATE = now.toISOString();
    const ISSUER_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

    const vcsToCreate = [];

    for (const item of credentials) {
      const holderId = holderMap.get(item.holderEmail);
      if (!holderId) continue; // Skip if holder doesn't exist

      const vcPayload = {
        "@context": [
          "https://www.w3.org/2018/credentials/v1",
          `${ISSUER_URL}/api/schemas/${schema.id}`
        ],
        type: ["VerifiableCredential", schema.name.replace(/\s+/g, "")],
        issuer: issuer.did,
        issuanceDate: ISSUANCE_DATE,
        ...(expirationDate && { expirationDate: expirationDate.toISOString() }),
        credentialSubject: {
          id: `did:placeholder:${holderId}`, // Will be updated on claim
          ...item.credentialSubject
        }
      };

      vcsToCreate.push({
        vcPayload,
        metadata: {
          schemaName: schema.name,
          schemaVersion: schema.version,
          issuerName: issuer.name || issuer.email,
          issuerEmail: issuer.email,
        },
        issuerId: issuer.id,
        holderId: holderId,
        status: "OFFERED" as const,
        issuedAt: now,
        expiresAt: expirationDate,
        batchId: batchId,
      });
    }

    if (vcsToCreate.length === 0) {
      return NextResponse.json({ error: "No valid holders found." }, { status: 400 });
    }

    await prisma.verifiableCredential.createMany({
      data: vcsToCreate,
    });

    return NextResponse.json({ success: true, batchId, count: vcsToCreate.length });
  } catch (error) {
    console.error("Batch issue error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
