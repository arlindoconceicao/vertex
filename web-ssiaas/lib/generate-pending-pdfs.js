const fs = require("fs");
const path = require("path");
const core = require("./ssi_pq_core.node");

async function main() {
  const endpoint = process.env.NEXT_PUBLIC_APP_URL
    ? `${process.env.NEXT_PUBLIC_APP_URL}/api/signer/requests/pending`
    : "http://localhost:3000/api/signer/requests/pending";

  const keysFilePath = path.join(__dirname, "keys.txt");
  const walletPath = path.join(__dirname, "mobile_wallet.db");

  console.log("=================================================");
  console.log("📄 GERANDO PDFs DE CREDENCIAIS PENDENTES");
  console.log("=================================================");

  if (!fs.existsSync(keysFilePath) || !fs.existsSync(walletPath)) {
    console.error("❌ [ERRO] Banco SQLite da wallet (mobile_wallet.db) ou keys.txt não encontrados.");
    process.exit(1);
  }

  const walletPassword = fs.readFileSync(keysFilePath, "utf-8").trim();

  let registeredDids = [];
  try {
    core.walletOpen(walletPath, walletPassword);
    registeredDids = core.walletListDids(walletPath, walletPassword);
  } catch (err) {
    console.error("❌ [ERRO] Falha ao abrir a wallet SQLite:", err.message);
    process.exit(1);
  }

  if (registeredDids.length === 0) {
    console.error("❌ [ERRO] Nenhuma DID registrada na wallet.");
    process.exit(1);
  }

  const activeDidData = registeredDids[registeredDids.length - 1];
  console.log(`🔑 Autenticando com DID: ${activeDidData.did}`);

  // Autenticação (PoP)
  const authPayload = { action: "pending_requests_auth", timestamp: new Date().toISOString() };
  const authSchema = core.createSchemaFromAttributes(authPayload, { version: "1", createdAt: authPayload.timestamp });
  
  const authCredential = core.walletIssueCredentialFromSchema(
    walletPath,
    walletPassword,
    activeDidData.did,
    authSchema,
    authPayload,
    {
      credentialId: `auth-${Date.now()}`,
      issuedAt: authPayload.timestamp,
      visiblePaths: ["action", "timestamp"]
    }
  );

  const authCredentialBase64 = Buffer.from(JSON.stringify(authCredential)).toString("base64");

  console.log("📡 Buscando credenciais pendentes...");
  let pendingRequests = [];
  try {
    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "x-signer-auth-credential": authCredentialBase64,
      },
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`HTTP ${response.status} - ${errText}`);
    }
    pendingRequests = await response.json();
  } catch (err) {
    console.error("❌ [ERRO] Falha ao consultar plataforma:", err.message);
    process.exit(1);
  }

  if (pendingRequests.length === 0) {
    console.log("✅ Nenhuma credencial pendente encontrada.");
    return;
  }

  console.log(`📋 Encontradas ${pendingRequests.length} credenciais pendentes. Gerando PDFs...`);

  for (let i = 0; i < pendingRequests.length; i++) {
    const request = pendingRequests[i];
    const subject = request.unsignedPayload.credentialSubject;
    const credentialData = { ...subject };
    delete credentialData.id; // Remover o ID do payload visual
    
    // Obter todos os caminhos do subject para o PDF
    const visiblePaths = [];
    const pdfLabels = {};

    function extractPaths(obj, prefix = "") {
      for (const [key, value] of Object.entries(obj)) {
        const pathStr = prefix ? `${prefix}.${key}` : key;
        if (typeof value === "object" && value !== null && !Array.isArray(value)) {
          pdfLabels[pathStr] = key.charAt(0).toUpperCase() + key.slice(1);
          extractPaths(value, pathStr);
        } else {
          visiblePaths.push(pathStr);
          pdfLabels[pathStr] = key.charAt(0).toUpperCase() + key.slice(1);
        }
      }
    }
    
    extractPaths(credentialData);

    const schema = core.createSchemaFromAttributes(credentialData, {
      version: "1",
      createdAt: new Date().toISOString()
    });

    const issuedAt = new Date().toISOString();
    
    const signedCredential = core.walletIssueCredentialFromSchema(
      walletPath,
      walletPassword,
      activeDidData.did,
      schema,
      credentialData,
      {
        credentialId: request.requestId,
        issuedAt: issuedAt,
        visiblePaths: visiblePaths
      }
    );

    const pdfBaseBuffer = Buffer.from(
      core.signedCredentialToPdf(signedCredential, {
        labels: pdfLabels
      })
    );

    const finalPdfBuffer = Buffer.from(
      core.walletEmbedSignedCredentialInPdf(
        walletPath,
        walletPassword,
        activeDidData.did,
        pdfBaseBuffer,
        signedCredential
      )
    );

    const pdfPath = path.join(__dirname, `credential_${request.requestId}.pdf`);
    fs.writeFileSync(pdfPath, finalPdfBuffer);
    
    console.log(`   ✔ PDF gerado (com assinatura embutida) para requisição ${request.requestId}: ${pdfPath}`);
  }
}

main().catch(console.error);
