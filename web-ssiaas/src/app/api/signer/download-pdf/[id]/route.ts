import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateSignerToken } from "@/lib/signer-auth";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authHeader = request.headers.get("authorization");

  if (!validateSignerToken(authHeader)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  
  const credential = await prisma.verifiableCredential.findUnique({
    where: { id },
    select: { pdfFile: true, pdfDownloadedAt: true, metadata: true }
  });

  if (!credential) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!credential.pdfFile) {
     return NextResponse.json({ error: "PDF not available" }, { status: 404 });
  }

  // Se for o primeiro download, registramos a data e apagamos o payload com PII
  if (!credential.pdfDownloadedAt) {
    await prisma.verifiableCredential.update({
      where: { id },
      data: {
        pdfDownloadedAt: new Date(),
        vcPayload: credential.metadata || {}, // Sobrescreve PII com metadados
      }
    });
  }

  return new NextResponse(credential.pdfFile, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="credential_${id}.pdf.enc"`,
    },
  });
}
