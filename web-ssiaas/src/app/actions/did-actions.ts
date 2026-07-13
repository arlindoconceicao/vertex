"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

type ActionResult =
  | { success: true }
  | { success: false; error: string };

// ── Registrar DID ────────────────────────────────────────────
// Chamada uma única vez. Após o registro, a DID é imutável
export async function registerDid(
  did: string,
  publicKey: string
): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Unauthorized." };
  }

  if (!did.trim() || !publicKey.trim()) {
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
        didPublicKey: publicKey.trim(),
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