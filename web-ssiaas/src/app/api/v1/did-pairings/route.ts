import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { randomBytes } from "crypto";

import { DidPairingStatus } from "@prisma/client";

export async function POST() {
  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { cpf: true, did: true, didDocument: true, email: true },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (!user.cpf) {
      return NextResponse.json(
        {
          error: "User registration not complete",
          details: "CPF is required to start DID pairing.",
        },
        { status: 403 }
      );
    }

    if (user.did || user.didDocument) {
      return NextResponse.json(
        {
          error: "DID already paired",
          details: "This account already has a paired DID.",
        },
        { status: 409 }
      );
    }

    const pairingId = randomBytes(16).toString("hex");
    const nonce = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    const newChallenge = await prisma.$transaction(async (tx) => {
      await tx.didPairingChallenge.updateMany({
        where: {
          userId,
          status: DidPairingStatus.PENDING,
        },
        data: {
          status: DidPairingStatus.CANCELLED,
        },
      });

      return tx.didPairingChallenge.create({
        data: {
          userId,
          cpf: user.cpf!,
          email: user.email!,
          pairingId,
          nonce,
          expiresAt,
          status: DidPairingStatus.PENDING,
        },
        select: {
          id: true,
          pairingId: true,
          nonce: true,
          expiresAt: true,
        },
      });
    });

    return NextResponse.json(newChallenge, { status: 201 });
  } catch (error) {
    console.error("[POST /api/v1/did-pairings] Unexpected error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
