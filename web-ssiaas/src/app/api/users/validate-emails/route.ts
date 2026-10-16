import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { emails } = await request.json();

    if (!Array.isArray(emails)) {
      return NextResponse.json({ error: "Invalid data format" }, { status: 400 });
    }

    // Obter os usuários que existem na base
    const existingUsers = await prisma.user.findMany({
      where: {
        email: { in: emails },
      },
      select: {
        email: true,
      },
    });

    const existingEmails = new Set(existingUsers.map((u) => u.email));
    const invalidEmails = emails.filter((email) => !existingEmails.has(email));

    return NextResponse.json({
      success: true,
      invalidEmails,
    });
  } catch (error) {
    console.error("Error validating emails:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
