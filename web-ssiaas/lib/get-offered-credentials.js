/**
 * Script de Simulação do Aplicativo Móvel: Consulta de Credenciais Oferecidas
 *
 * Este script simula o aplicativo móvel acessando a rota GET /api/signer/requests/offered.
 * Ele lê as chaves/DIDs mantidas no banco SQLite cifrado (lib/mobile_wallet.db) usando
 * a senha em lib/keys.txt, autentica-se com o Bearer token (SIGNER_SECRET) e
 * retorna/exibe todas as credenciais oferecidas (aguardando aceite).
 *
 * Uso:
 *   node lib/get-offered-credentials.js [endpoint]
 * Exemplo:
 *   node lib/get-offered-credentials.js
 *   node lib/get-offered-credentials.js http://localhost:3000/api/signer/requests/offered
 */

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const core = require("./ssi_pq_core.node");

async function main() {
  const customEndpoint = process.argv[2];
  const endpoint =
    customEndpoint ||
      process.env.NEXT_PUBLIC_APP_URL
      ? `${process.env.NEXT_PUBLIC_APP_URL}/api/signer/requests/offered`
      : "http://localhost:3000/api/signer/requests/offered";

  const secretsStr = process.env.SIGNER_SECRETS || process.env.SIGNER_SECRET;
  const signerSecret = secretsStr ? secretsStr.split(',')[0].trim() : "mobile-signer-secret-token";

  // 1. Carregamento da Wallet SQLite e Chaves Locais do Usuário
  const keysFilePath = path.join(__dirname, "keys.txt");
  const walletPath = path.join(__dirname, "mobile_wallet.db");

  console.log("=================================================");
  console.log("🚀 SIMULANDO APLICATIVO MÓVEL - BUSCA DE CREDENCIAIS OFERECIDAS");
  console.log("=================================================");
  console.log(`📌 Endpoint   : ${endpoint}`);
  console.log(`🔑 Wallet Key : ${keysFilePath}`);
  console.log(`💾 Wallet DB  : ${walletPath}`);

  if (!fs.existsSync(keysFilePath) || !fs.existsSync(walletPath)) {
    console.error(
      "\n❌ [ERRO] Banco SQLite da wallet (mobile_wallet.db) ou keys.txt não encontrados."
    );
    console.error(
      "👉 Execute primeiro o pareamento DID (ex: node lib/complete-pairing.js) para inicializar a wallet."
    );
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

  console.log(`\n🆔 DIDs Registrados na Wallet Móvel (${registeredDids.length}):`);
  registeredDids.forEach((d, idx) => {
    console.log(`   [${idx + 1}] DID: ${d.did}`);
    if (d.label) console.log(`       Rótulo: ${d.label}`);
  });

  // Utilizaremos a última DID registrada na Wallet para autenticar (que já injetamos no DB)
  const activeDidData = registeredDids[registeredDids.length - 1];
  if (!activeDidData) {
    console.error("\n❌ [ERRO] Nenhuma DID encontrada na wallet móvel.");
    process.exit(1);
  }
  const signerDid = activeDidData.did;
  console.log(`\n🔑 Usando DID para autenticação: ${signerDid}`);

  // 2. Assinar Desafio usando Credencial Verificável (PoP via Wallet DB)
  const timestamp = new Date().toISOString();
  
  const authCredentialData = {
    action: "offered_requests_auth",
    timestamp: timestamp
  };

  const schema = core.createSchemaFromAttributes(authCredentialData, {
    version: '1.0',
    createdAt: timestamp
  });

  console.log(`✍️  Assinando desafio de autenticação (VC) via wallet interna...`);
  
  const signedAuthCredential = core.walletIssueCredentialFromSchema(
    walletPath,
    walletPassword,
    signerDid,
    schema,
    authCredentialData,
    {
      credentialId: `auth-${Date.now()}`,
      issuedAt: timestamp,
      visiblePaths: ['action', 'timestamp']
    }
  );

  console.log(`✔  Credencial de autenticação gerada com sucesso.`);

  // Codifica o JSON da credencial em base64 para enviar seguro no header
  const authHeaderBase64 = Buffer.from(JSON.stringify(signedAuthCredential)).toString('base64');
  
  // Gera o Token HMAC M2M Personalizado
  const bearerToken = crypto.createHmac("sha256", signerSecret).update(signerDid).digest("hex");

  // 3. Consulta de Requisições de Assinatura Pendentes na Plataforma
  console.log("\n📡 Consultando credenciais oferecidas na plataforma...");

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
      const errorText = await response.text();
      console.error(
        `\n❌ [ERRO] Falha na resposta da plataforma (HTTP ${response.status}):`,
        errorText
      );
      process.exit(1);
    }

    const offeredRequests = await response.json();

    console.log("\n=================================================");
    console.log(`✅ CONSULTA CONCLUÍDA: ${offeredRequests.length} credencial(is) oferecida(s)`);
    console.log("=================================================");

    if (offeredRequests.length === 0) {
      console.log("ℹ️  Nenhuma credencial oferecida aguardando aceite no momento.");
    } else {
      offeredRequests.forEach((req, idx) => {
        console.log(`\n📋 [Credencial Oferecida #${idx + 1}]`);
        console.log(`   • ID Requisição (VC ID) : ${req.requestId}`);
        console.log(`   • Data de Emissão        : ${req.createdAt}`);
        console.log(`   • Emissor                : ${req.issuer?.name || "N/A"} (${req.issuer?.did || "N/A"})`);
        console.log(`   • Payload Não Assinado   :`);
        console.log(JSON.stringify(req.unsignedPayload, null, 6));
      });
    }

    return offeredRequests;
  } catch (err) {
    console.error("\n❌ [ERRO DE CONEXÃO]:", err.message);
    process.exit(1);
  }
}

main();
