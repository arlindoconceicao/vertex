/**
 * Script de Simulação do Aplicativo Móvel: Assinatura de Credenciais em Lote
 *
 * Este script simula o aplicativo móvel acessando a rota GET /api/signer/requests/pending,
 * baixando as credenciais de um lote e assinando criptograficamente cada uma
 * com a chave privada ML-DSA armazenada localmente na wallet do dispositivo móvel.
 *
 * Os dados assinados e PDFs são salvos localmente em lib/offline_signed_batches.json,
 * prontos para serem enviados na etapa de upload.
 *
 * Uso:
 *   node lib/sign-batch-credentials.js [batchId] [--upload]
 *
 * Exemplos:
 *   node lib/sign-batch-credentials.js
 *   node lib/sign-batch-credentials.js de44a5e9-5944-4d30-88c5-4995d0432ad5
 *   node lib/sign-batch-credentials.js --upload
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const core = require("./ssi_pq_core.node");

async function main() {
  const args = process.argv.slice(2);
  const shouldUpload = args.includes("--upload") || args.includes("-u");
  const targetBatchId = args.find(a => !a.startsWith("-"));

  const pendingEndpoint = process.env.NEXT_PUBLIC_APP_URL
      ? `${process.env.NEXT_PUBLIC_APP_URL}/api/signer/requests/pending`
      : "http://localhost:3000/api/signer/requests/pending";

  const secretsStr = process.env.SIGNER_SECRETS || process.env.SIGNER_SECRET;
  const signerSecret = secretsStr ? secretsStr.split(',')[0].trim() : "mobile-signer-secret-token";

  const keysFilePath = path.join(__dirname, "keys.txt");
  const walletPath = path.join(__dirname, "mobile_wallet.db");
  const offlineStoragePath = path.join(__dirname, "offline_signed_batches.json");

  console.log("=================================================");
  console.log("🚀 SIMULANDO APLICATIVO MÓVEL - ASSINATURA DE LOTE");
  console.log("=================================================");

  if (!fs.existsSync(keysFilePath) || !fs.existsSync(walletPath)) {
    console.error("❌ [ERRO] Wallet não inicializada. Rode o complete-pairing.js primeiro.");
    process.exit(1);
  }

  const walletPassword = fs.readFileSync(keysFilePath, "utf-8").trim();

  // 1. Acesso à carteira local e obtenção do DID do emissor
  let registeredDids = [];
  try {
    core.walletOpen(walletPath, walletPassword);
    registeredDids = core.walletListDids(walletPath, walletPassword) || [];
  } catch (err) {
    console.error("❌ [ERRO] Falha ao abrir wallet:", err.message);
    process.exit(1);
  }

  const activeDidData = registeredDids[registeredDids.length - 1];
  if (!activeDidData) {
    console.error("❌ [ERRO] Nenhuma DID encontrada na wallet móvel.");
    process.exit(1);
  }
  const signerDid = activeDidData.did;

  // 2. Autenticação Segura (Proof of Possession + Bearer M2M)
  const timestamp = new Date().toISOString();
  const authCredentialData = { action: "pending_requests_auth", timestamp };
  const authSchema = core.createSchemaFromAttributes(authCredentialData, { version: '1.0', createdAt: timestamp });
  const signedAuth = core.walletIssueCredentialFromSchema(
    walletPath, walletPassword, signerDid, authSchema, authCredentialData,
    { credentialId: `auth-${Date.now()}`, issuedAt: timestamp, visiblePaths: ['action', 'timestamp'] }
  );

  const authHeaderBase64 = Buffer.from(JSON.stringify(signedAuth)).toString('base64');
  const bearerToken = crypto.createHmac("sha256", signerSecret).update(signerDid).digest("hex");

  console.log("\n📡 [App Mobile] Conectando ao servidor para baixar pendências de assinatura...");
  const response = await fetch(pendingEndpoint, {
    method: "GET",
    headers: {
      "x-signer-auth-credential": authHeaderBase64,
      "Authorization": `Bearer ${bearerToken}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    console.error(`❌ [ERRO] Falha ao buscar credenciais pendentes (HTTP ${response.status}).`);
    process.exit(1);
  }

  const pendingRequests = await response.json();
  const batchRequests = pendingRequests.filter(r => r.batchId);

  if (batchRequests.length === 0) {
    console.log("ℹ️  Nenhum lote pendente de assinatura encontrado na plataforma.");
    process.exit(0);
  }

  // Agrupa os requests por batchId
  const batches = {};
  batchRequests.forEach(req => {
    if (!batches[req.batchId]) batches[req.batchId] = [];
    batches[req.batchId].push(req);
  });

  const batchToSign = targetBatchId || Object.keys(batches)[0];
  const reqsToSign = batches[batchToSign];

  if (!reqsToSign) {
    console.error(`❌ Lote ${batchToSign} não encontrado ou sem credenciais pendentes.`);
    process.exit(1);
  }

  console.log(`\n=================================================`);
  console.log(`✍️  ASSINANDO LOTE: ${batchToSign} (${reqsToSign.length} credenciais)`);
  console.log(`=================================================\n`);

  let offlineStorage = [];
  if (fs.existsSync(offlineStoragePath)) {
    try {
      offlineStorage = JSON.parse(fs.readFileSync(offlineStoragePath, "utf-8"));
    } catch (_) {
      offlineStorage = [];
    }
  }

  // 3. Itera pelas credenciais e assina localmente no dispositivo móvel
  for (let i = 0; i < reqsToSign.length; i++) {
    const req = reqsToSign[i];
    console.log(`⏳ [${i+1}/${reqsToSign.length}] Assinando ID: ${req.requestId}...`);

    const subject = req.unsignedPayload.credentialSubject || {};
    const recipientDid = subject.id || "unknown";
    const credentialData = { ...subject };
    delete credentialData.id; // Remover o ID do payload visual para que não vire atributo solto

    // Obter todos os caminhos do subject para o PDF e labels
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

    const dynamicSchema = core.createSchemaFromAttributes(credentialData, {
      version: "1.0",
      createdAt: new Date().toISOString()
    });

    const issueOptions = {
      credentialId: req.requestId,
      issuedAt: req.createdAt || new Date().toISOString(),
      visiblePaths: visiblePaths.length > 0 ? visiblePaths : Object.keys(credentialData)
    };

    if (req.unsignedPayload.expirationDate) {
      issueOptions.expiresAt = req.unsignedPayload.expirationDate;
      issueOptions.expirationDate = req.unsignedPayload.expirationDate;
    }

    // Assinatura pós-quântica ML-DSA usando a chave da carteira local
    const signedVcPayload = core.walletIssueCredentialFromSchema(
      walletPath,
      walletPassword,
      signerDid,
      dynamicSchema,
      credentialData,
      issueOptions
    );

    // Geração do PDF no app com layout e assinatura embutida
    const pdfBaseBuffer = Buffer.from(
      core.signedCredentialToPdf(signedVcPayload, {
        labels: pdfLabels
      })
    );

    const finalPdfBuffer = Buffer.from(
      core.walletEmbedSignedCredentialInPdf(
        walletPath,
        walletPassword,
        signerDid,
        pdfBaseBuffer,
        signedVcPayload
      )
    );

    const pdfHash = crypto.createHash("sha256").update(finalPdfBuffer).digest("hex");
    const pdfContentBase64 = finalPdfBuffer.toString("base64");

    const metadata = {
      requestId: req.requestId,
      issuerDid: signerDid,
      recipientDid: recipientDid,
      timestamp: new Date().toISOString(),
      pdfHash: pdfHash,
      schemaId: req.unsignedPayload.credentialSchema?.id || "N/A",
      expirationDate: req.unsignedPayload.expirationDate || null
    };

    const callbackData = {
      requestId: req.requestId,
      metadata: metadata,
      signedPayload: signedVcPayload,
      encryptedPdfBase64: pdfContentBase64
    };

    offlineStorage.push(callbackData);
    console.log(`   ✔ Assinada com sucesso com chave ML-DSA e PDF gerado (${finalPdfBuffer.length} bytes).`);
  }

  // 4. Salva a fila de saída no armazenamento interno do app
  fs.writeFileSync(offlineStoragePath, JSON.stringify(offlineStorage, null, 2));

  console.log(`\n=================================================`);
  console.log(`🎉 ASSINATURA DO LOTE CONCLUÍDA NO DISPOSITIVO MÓVEL!`);
  console.log(`   Credenciais armazenadas em: ${offlineStoragePath}`);
  console.log(`=================================================`);

  // 5. Se foi solicitada sincronização imediata (--upload), executa o upload
  if (shouldUpload) {
    console.log(`\n🚀 Opção --upload detectada. Iniciando envio automático para a plataforma...`);
    const uploader = require("./upload-batch-credentials");
    await uploader.main();
  } else {
    console.log(`\n👉 PRÓXIMO PASSO: Enviar as credenciais assinadas para a plataforma:`);
    console.log(`   node lib/upload-batch-credentials.js\n`);
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };
