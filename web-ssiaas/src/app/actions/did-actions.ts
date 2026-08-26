"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { pinata } from "@/lib/pinata";

type ActionResult =
  | { success: true }
  | { success: false; error: string };

// ── Registrar DID ────────────────────────────────────────────
// Chamada uma única vez. Após o registro, a DID é imutável
export async function registerDid(
  did: string,
  publicKey: string,
  didDocument?: Record<string, unknown>
): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Unauthorized." };
  }

  if (!did.trim()) {
    return { success: false, error: "DID is required." };
  }

  if (!didDocument && !publicKey.trim()) {
    return { success: false, error: "Both DID and public key are required." };
  }

  // Validação de formato — DIDs devem começar com "did:"
  if (!did.trim().startsWith("did:")) {
    return { success: false, error: "Invalid DID format: must start with 'did:'." };
  }

  // Verifica se já tem DID registrada
  const existing = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { did: true },
  });

  if (existing?.did) {
    return { success: false, error: "You already have a registered DID." };
  }

  try {
    await prisma.user.update({
      where: { id: session.user.id },
      data: {
        did: did.trim(),
        didPublicKey: publicKey.trim() || null,
        didDocument: (didDocument ?? {
          "@context": ["https://www.w3.org/ns/did/v1"],
          id: did.trim(),
          verificationMethod: [
            {
              id: `${did.trim()}#key-1`,
              type: "Ed25519VerificationKey2020",
              controller: did.trim(),
              publicKeyMultibase: publicKey.trim(),
            },
          ],
          authentication: [`${did.trim()}#key-1`],
        }) as any,
      },
    });

    revalidatePath("/settings");
    revalidatePath("/dashboard");
    return { success: true };
  } catch (error) {
    // P2002 = violação de unique — outra conta já tem essa DID
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code: string }).code === "P2002"
    ) {
      return { success: false, error: "This DID is already registered to another account." };
    }

    console.error("[registerDid] Error:", error);
    return { success: false, error: "Failed to register DID." };
  }
}

export async function publishDidDocumentToIpfs(): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Unauthorized." };
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { 
      did: true, 
      didDocument: true,
      didPublishedAt: true
    },
  });

  if (!user) return { success: false, error: "User not found." };
  if (!user.did || !user.didDocument) return { success: false, error: "DID Document not found." };
  if (user.didPublishedAt) return { success: false, error: "Already published." };

  try {
    const upload = await pinata.upload.public
      .json(user.didDocument as Record<string, unknown>)
      .name(`DID-${user.did}.json`)
      .keyvalues({
        resourceType: "did-document",
        userDid: user.did,
      });

    await prisma.user.update({
      where: { id: session.user.id },
      data: {
        didIpfsCid: upload.cid,
        didPinataFileId: upload.id,
        didPublishedAt: new Date(),
      },
    });

    revalidatePath("/settings");
    return { success: true };
  } catch (error) {
    console.error("[publishDidDocumentToIpfs] Error:", error);
    return { success: false, error: "Failed to publish DID Document." };
  }
}