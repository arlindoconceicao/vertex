import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  
  const credential = await prisma.verifiableCredential.findUnique({
    where: { id },
    select: { 
      pdfFile: true, 
      holderId: true, 
      pdfDownloadedAt: true, 
      metadata: true, 
      vcPayload: true,
      issuer: {
        select: {
          pdfRetentionDays: true
        }
      }
    }
  });

  if (!credential) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Apenas o destinatário tem autorização para baixar a própria credencial cifrada
  if (credential.holderId !== session.user.id) {
     return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!credential.pdfFile) {
     return NextResponse.json({ error: "PDF not available" }, { status: 404 });
  }

  // Verificar Expiração Lógica
  if (credential.pdfDownloadedAt && credential.issuer?.pdfRetentionDays) {
    const expirationDate = new Date(credential.pdfDownloadedAt);
    expirationDate.setDate(expirationDate.getDate() + credential.issuer.pdfRetentionDays);
    const now = new Date();
    
    if (now > expirationDate) {
      return NextResponse.json({ error: "PDF expired" }, { status: 410 });
    }
  }

  // Se for o primeiro download, registramos a data e apagamos o payload com PII
  if (!credential.pdfDownloadedAt) {
    // Extrai as chaves dos atributos para manter visível após a deleção do PII
    const oldPayload = credential.vcPayload as Record<string, any> || {};
    const oldSubject = oldPayload.credentialSubject || {};
    const strippedSubject = Object.keys(oldSubject).reduce((acc, key) => {
      acc[key] = "Ocultado (PII removido)";
      return acc;
    }, {} as Record<string, string>);

    const newPayload = {
      ...(credential.metadata as object || {}),
      credentialSubject: strippedSubject
    };

    await prisma.verifiableCredential.update({
      where: { id },
      data: {
        pdfDownloadedAt: new Date(),
        vcPayload: newPayload, // Sobrescreve PII mas mantém as chaves do schema
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
