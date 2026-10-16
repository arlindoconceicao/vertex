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
    const credentials = await prisma.verifiableCredential.findMany({
      where: {
        status: { in: ["OFFERED", "REJECTED"] }
      },
      include: {
        issuer: {
          select: {
            offerRetentionDays: true,
            rejectionRetentionDays: true
          }
        }
      }
    });

    const now = new Date();
    const idsToDelete: string[] = [];

    for (const cred of credentials) {
      if (!cred.issuer) continue;

      const expirationDate = new Date(cred.updatedAt || cred.issuedAt);

      if (cred.status === "OFFERED") {
        expirationDate.setDate(expirationDate.getDate() + cred.issuer.offerRetentionDays);
      } else if (cred.status === "REJECTED") {
        expirationDate.setDate(expirationDate.getDate() + cred.issuer.rejectionRetentionDays);
      }
      
      // If current time is past expiration time, mark for deletion
      if (now > expirationDate) {
        idsToDelete.push(cred.id);
      }
    }

    if (idsToDelete.length > 0) {
      await prisma.verifiableCredential.deleteMany({
        where: { id: { in: idsToDelete } }
      });
    }

    return NextResponse.json({
      success: true,
      cleanedCount: idsToDelete.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("[CRON] Cleanup Credentials Error:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
