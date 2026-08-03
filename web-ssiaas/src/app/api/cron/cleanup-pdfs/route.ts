import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  // Validate CRON_SECRET for security
  const authHeader = request.headers.get("authorization");
  const expectedSecret = process.env.CRON_SECRET;

  if (!expectedSecret || authHeader !== `Bearer ${expectedSecret}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    // Find all credentials that have a PDF file and were downloaded at least once
    const credentials = await prisma.verifiableCredential.findMany({
      where: {
        pdfFile: { not: null },
        pdfDownloadedAt: { not: null },
      },
      select: {
        id: true,
        pdfDownloadedAt: true
      }
    });

    const now = new Date();
    const idsToDelete: string[] = [];

    // Calculate expiration date using an absolute global maximum of 15 days
    for (const cred of credentials) {
      if (cred.pdfDownloadedAt) {
        const expirationDate = new Date(cred.pdfDownloadedAt);
        expirationDate.setDate(expirationDate.getDate() + 15);
        
        // If current time is past expiration time, mark for deletion
        if (now > expirationDate) {
          idsToDelete.push(cred.id);
        }
      }
    }

    // Delete PDF binaries (set to null) in a single bulk operation
    if (idsToDelete.length > 0) {
      await prisma.verifiableCredential.updateMany({
        where: { id: { in: idsToDelete } },
        data: { pdfFile: null }
      });
    }

    return NextResponse.json({
      success: true,
      cleanedCount: idsToDelete.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("[CRON] Cleanup PDFs Error:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
