import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const credential = await prisma.verifiableCredential.findUnique({
      where: { id },
      select: { holderId: true, status: true },
    });

    if (!credential) {
      return NextResponse.json({ error: "Credential not found" }, { status: 404 });
    }

    if (credential.holderId !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (credential.status !== "OFFERED") {
      return NextResponse.json({ error: "Credential is not in OFFERED status" }, { status: 400 });
    }

    const updated = await prisma.verifiableCredential.update({
      where: { id },
      data: { status: "REJECTED" },
    });

    return NextResponse.json(updated, { status: 200 });
  } catch (error) {
    console.error("[POST /api/credentials/[id]/reject] Unexpected error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
