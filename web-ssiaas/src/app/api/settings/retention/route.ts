import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { pdfRetentionDays, offerRetentionDays, rejectionRetentionDays } = await request.json();

    const dataToUpdate: any = {};

    if (pdfRetentionDays !== undefined) {
      if (typeof pdfRetentionDays !== "number" || pdfRetentionDays < 1 || pdfRetentionDays > 15) {
        return NextResponse.json({ error: "Invalid pdfRetentionDays. Must be between 1 and 15." }, { status: 400 });
      }
      dataToUpdate.pdfRetentionDays = pdfRetentionDays;
    }

    if (offerRetentionDays !== undefined) {
      if (typeof offerRetentionDays !== "number" || offerRetentionDays < 1 || offerRetentionDays > 15) {
        return NextResponse.json({ error: "Invalid offerRetentionDays. Must be between 1 and 15." }, { status: 400 });
      }
      dataToUpdate.offerRetentionDays = offerRetentionDays;
    }

    if (rejectionRetentionDays !== undefined) {
      if (typeof rejectionRetentionDays !== "number" || rejectionRetentionDays < 1 || rejectionRetentionDays > 15) {
        return NextResponse.json({ error: "Invalid rejectionRetentionDays. Must be between 1 and 15." }, { status: 400 });
      }
      dataToUpdate.rejectionRetentionDays = rejectionRetentionDays;
    }

    if (Object.keys(dataToUpdate).length === 0) {
       return NextResponse.json({ error: "No fields to update." }, { status: 400 });
    }

    await prisma.user.update({
      where: { id: session.user.id },
      data: dataToUpdate,
    });

    return NextResponse.json({ success: true, ...dataToUpdate });
  } catch (error) {
    console.error("Error updating retention settings:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
