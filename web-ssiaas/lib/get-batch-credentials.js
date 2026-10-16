/**
 * Script de Simulação do Aplicativo Móvel: Consulta de Credenciais Oferecidas em Lote
 *
 * Este script simula o aplicativo móvel acessando a rota GET /api/signer/requests/offered
 * e agrupa as credenciais pelo batchId para ilustrar a visão de lote.
 */

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const core = require("./ssi_pq_core.node");

async function main() {
  const endpoint = process.env.NEXT_PUBLIC_APP_URL
      ? `${process.env.NEXT_PUBLIC_APP_URL}/api/signer/requests/offered`
      : "http://localhost:3000/api/signer/requests/offered";

  const secretsStr = process.env.SIGNER_SECRETS || process.env.SIGNER_SECRET;
  const signerSecret = secretsStr ? secretsStr.split(',')[0].trim() : "mobile-signer-secret-token";

  const keysFilePath = path.join(__dirname, "keys.txt");
  const walletPath = path.join(__dirname, "mobile_wallet.db");

  if (!fs.existsSync(keysFilePath) || !fs.existsSync(walletPath)) {
    console.error("❌ [ERRO] Banco SQLite da wallet (mobile_wallet.db) ou keys.txt não encontrados.");
    process.exit(1);
  }

  const walletPassword = fs.readFileSync(keysFilePath, "utf-8").trim();

  let registeredDids = [];
  try {
    core.walletOpen(walletPath, walletPassword);
    registeredDids = core.walletListDids(walletPath, walletPassword) || [];
  } catch (err) {
    console.error("\n❌ [ERRO] Falha ao abrir a wallet SQLite:", err.message);
    process.exit(1);
  }

  const activeDidData = registeredDids[registeredDids.length - 1];
  if (!activeDidData) {
    console.error("\n❌ [ERRO] Nenhuma DID encontrada na wallet móvel.");
    process.exit(1);
  }
  const signerDid = activeDidData.did;

  const timestamp = new Date().toISOString();
  
  const authCredentialData = {
    action: "offered_requests_auth",
    timestamp: timestamp
  };

  const schema = core.createSchemaFromAttributes(authCredentialData, {
    version: '1.0',
    createdAt: timestamp
  });

  const signedAuthCredential = core.walletIssueCredentialFromSchema(
    walletPath,
    walletPassword,
    signerDid,
    schema,
    authCredentialData,
    { credentialId: `auth-${Date.now()}`, issuedAt: timestamp, visiblePaths: ['action', 'timestamp'] }
  );

  const authHeaderBase64 = Buffer.from(JSON.stringify(signedAuthCredential)).toString('base64');
  const bearerToken = crypto.createHmac("sha256", signerSecret).update(signerDid).digest("hex");

  console.log("\n📡 Consultando credenciais oferecidas na plataforma (Visão em Lote)...");

  try {
    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        "x-signer-auth-credential": authHeaderBase64,
        "Authorization": `Bearer ${bearerToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      console.error(`\n❌ [ERRO] Falha na resposta da plataforma (HTTP ${response.status})`);
      process.exit(1);
    }

    const offeredRequests = await response.json();

    const batches = {};
    offeredRequests.forEach(req => {
       if (req.batchId) {
         if (!batches[req.batchId]) batches[req.batchId] = [];
         batches[req.batchId].push(req);
       }
    });

    console.log("\n=================================================");
    console.log(`✅ Lotes Oferecidos Encontrados: ${Object.keys(batches).length}`);
    console.log("=================================================");

    for (const [batchId, creds] of Object.entries(batches)) {
      console.log(`\n📋 [Lote: ${batchId}] - ${creds.length} credenciais`);
      creds.forEach((cred, idx) => {
        console.log(`\n   📄 Credencial [${idx + 1}/${creds.length}] (ID: ${cred.requestId})`);
        console.log(`      Holder: ${cred.unsignedPayload.credentialSubject.id}`);
        console.log(`      Payload:`);
        console.log(JSON.stringify(cred.unsignedPayload, null, 2));
      });
    }
  } catch (err) {
    console.error("\n❌ [ERRO DE CONEXÃO]:", err.message);
    process.exit(1);
  }
}

main();
