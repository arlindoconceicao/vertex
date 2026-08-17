import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { randomBytes } from "crypto";
import { validateSignerToken } from "@/lib/signer-auth";
import { DidSearchStatus } from "@prisma/client";

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");

    let body: { requesterId?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { requesterId } = body;

    if (!requesterId || typeof requesterId !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid field: requesterId" },
        { status: 400 }
      );
    }

    const requester = await prisma.user.findUnique({
      where: { id: requesterId },
      select: { id: true, did: true },
    });

    if (!requester) {
      return NextResponse.json({ error: "Requester not found" }, { status: 404 });
    }

    if (!requester.did) {
      return NextResponse.json(
        { error: "Requester does not have a registered DID" },
        { status: 403 }
      );
    }

    // Validate the M2M token using the requester's DID
    if (!validateSignerToken(authHeader, requester.did)) {
      return NextResponse.json({ error: "Unauthorized M2M token" }, { status: 401 });
    }

    const nonce = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes expiration

    const challenge = await prisma.didSearchChallenge.create({
      data: {
        requesterId: requester.id,
        nonce,
        expiresAt,
        status: DidSearchStatus.PENDING,
      },
      select: {
        id: true,
        nonce: true,
        expiresAt: true,
      },
    });

    return NextResponse.json(challenge, { status: 201 });
  } catch (error) {
    console.error("[POST /api/dids/search/challenge] Unexpected error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
