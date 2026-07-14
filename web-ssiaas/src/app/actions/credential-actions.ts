"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

type ActionResult =
  | { success: true }
  | { success: false; error: string };

type IssueResult =
  | { success: true; credentialId: string }
  | { success: false; error: string };

// ── Emitir Credencial ────────────────────────────────────────
// Monta o payload W3C/JSON-LD não-assinado, salva no banco com
// status PENDING e retorna o id gerado

export async function issueCredential(
  schemaId: string,
  holderEmail: string,
  credentialSubject: Record<string, unknown>,
  expiresAt?: string
): Promise<IssueResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Unauthorized." };
  }

  // Busca o schema para embutir o snapshot no payload
  const schema = await prisma.credentialSchema.findUnique({
    where: { id: schemaId },
    select: { id: true, name: true, version: true },
  });

  if (!schema) {
    return { success: false, error: "Schema not found." };
  }

  // Busca a DID do issuer - para emissão
  const issuer = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, did: true, name: true },
  });

  if (!issuer?.did) {
    return {
      success: false,
      error: "You must register a DID before issuing credentials. Go to Settings.",
    };
  }

  // Busca o holder pelo email
  const holder = await prisma.user.findUnique({
    where: { email: holderEmail.trim() },
    select: { id: true, did: true },
  });

  if (!holder) {
    return { success: false, error: "No user found with this email." };
  }

  if (holder.id === session.user.id) {
    return { success: false, error: "You cannot issue a credential to yourself." };
  }

  // Valida expiresAt se informado
  let parsedExpires: Date | null = null;
  if (expiresAt) {
    const date = new Date(expiresAt);
    if (isNaN(date.getTime()) || date <= new Date()) {
      return { success: false, error: "Expiration date must be in the future." };
    }
    parsedExpires = date;
  }

  // Gera o type secundário a partir do nome do schema
  const credentialTypeName = schema.name
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");

  const unsignedPayload = {
    "@context": ["https://www.w3.org/2018/credentials/v1"],
    type: ["VerifiableCredential", credentialTypeName],
    issuer: issuer.did,
    issuanceDate: new Date().toISOString(),
    ...(parsedExpires ? { expirationDate: parsedExpires.toISOString() } : {}),
    credentialSchema: {
      id: schema.id,
      name: schema.name,
      version: schema.version,
    },
    credentialSubject: {
      id: holder.did ?? `urn:vertex:users:${holder.id}`,
      ...credentialSubject,
    },
  };

  try {
    const credential = await prisma.verifiableCredential.create({
      data: {
        vcPayload: unsignedPayload,
        status: "PENDING",
        expiresAt: parsedExpires,
        issuerId: issuer.id,
        holderId: holder.id,
      },
      select: { id: true },
    });

    revalidatePath("/dashboard");
    revalidatePath("/credentials");
    return { success: true, credentialId: credential.id };
  } catch (error) {
    console.error("[issueCredential] Error:", error);
    return { success: false, error: "Failed to issue credential." };
  }
}

// ── Aceitar Credencial (Holder) ──────────────────────────────
export async function acceptCredential(
  credentialId: string
): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Unauthorized." };
  }

  const credential = await prisma.verifiableCredential.findUnique({
    where: { id: credentialId },
    select: { holderId: true, status: true },
  });

  if (!credential) {
    return { success: false, error: "Credential not found." };
  }

  if (credential.holderId !== session.user.id) {
    return { success: false, error: "Only the holder can accept this credential." };
  }

  if (credential.status !== "PENDING") {
    return {
      success: false,
      error: `Cannot accept: current status is '${credential.status}'.`,
    };
  }

  try {
    await prisma.verifiableCredential.update({
      where: { id: credentialId },
      data: { status: "ACTIVE" },
    });

    revalidatePath(`/credentials/${credentialId}`);
    revalidatePath("/dashboard");
    return { success: true };
  } catch (error) {
    console.error("[acceptCredential] Error:", error);
    return { success: false, error: "Failed to accept credential." };
  }
}

// ── Revogar Credencial (Issuer) ──────────────────────────────
export async function revokeCredential(
  credentialId: string
): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Unauthorized." };
  }

  const credential = await prisma.verifiableCredential.findUnique({
    where: { id: credentialId },
    select: { issuerId: true, status: true },
  });

  if (!credential) {
    return { success: false, error: "Credential not found." };
  }

  if (credential.issuerId !== session.user.id) {
    return { success: false, error: "Only the issuer can revoke this credential." };
  }

  if (credential.status !== "ACTIVE") {
    return {
      success: false,
      error: `Cannot revoke: current status is '${credential.status}'.`,
    };
  }

  try {
    await prisma.verifiableCredential.update({
      where: { id: credentialId },
      data: { status: "REVOKED" },
    });

    revalidatePath(`/credentials/${credentialId}`);
    revalidatePath("/dashboard");
    return { success: true };
  } catch (error) {
    console.error("[revokeCredential] Error:", error);
    return { success: false, error: "Failed to revoke credential." };
  }
}