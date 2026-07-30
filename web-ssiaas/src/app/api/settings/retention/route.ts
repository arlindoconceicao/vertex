import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { pdfRetentionDays } = await request.json();

    if (
      typeof pdfRetentionDays !== "number" ||
      pdfRetentionDays < 1 ||
      pdfRetentionDays > 15
    ) {
      return NextResponse.json(
        { error: "Invalid retention days. Must be between 1 and 15." },
        { status: 400 }
      );
    }

    await prisma.user.update({
      where: { id: session.user.id },
      data: { pdfRetentionDays },
    });

    return NextResponse.json({ success: true, pdfRetentionDays });
  } catch (error) {
    console.error("Error updating retention settings:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
