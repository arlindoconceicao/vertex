import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { language } = body;

    if (!language || typeof language !== "string") {
      return NextResponse.json(
        { error: "Invalid language parameter" },
        { status: 400 }
      );
    }

    const updatedUser = await prisma.user.update({
      where: { id: session.user.id },
      data: { language: language.trim().toLowerCase() },
      select: { id: true, language: true },
    });

    return NextResponse.json(updatedUser, { status: 200 });
  } catch (error) {
    console.error("[PATCH /api/users/preferences] Error updating preference:", error);
    return NextResponse.json(
      { error: "Failed to update language preference" },
      { status: 500 }
    );
  }
}
