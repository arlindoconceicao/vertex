const fs = require("fs");
const path = require("path");
import crypto from "crypto";
const core = require("./ssi_pq_core.node");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

async function main() {
  console.log("=================================================");
  console.log("📱 SIMULANDO APP MÓVEL: CONSULTA DE DIDs E SCHEMAS");
  console.log("=================================================\n");

  const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const secretsStr = process.env.SIGNER_SECRETS || process.env.SIGNER_SECRET;
  const signerSecret = secretsStr ? secretsStr.split(",")[0].trim() : "mobile-signer-secret-token";

  const keysFilePath = path.join(__dirname, "keys.txt");
  const walletPath = path.join(__dirname, "mobile_wallet.db");

  if (!fs.existsSync(keysFilePath) || !fs.existsSync(walletPath)) {
    console.error("❌ [ERRO] Banco SQLite da wallet ou keys.txt não encontrados.");
    process.exit(1);
  }

  const walletPassword = fs.readFileSync(keysFilePath, "utf-8").trim();

  let registeredDids = [];
  try {
    core.walletOpen(walletPath, walletPassword);
    registeredDids = core.walletListDids(walletPath, walletPassword);
  } catch (err: any) {
    console.error("❌ [ERRO] Falha ao abrir a wallet SQLite:", err.message);
    process.exit(1);
  }

  if (registeredDids.length === 0) {
    console.error("❌ [ERRO] Nenhuma DID registrada na wallet local.");
    process.exit(1);
  }

  const activeDidData = registeredDids[registeredDids.length - 1];
  const signerDid = activeDidData.did;
  console.log(`🔑 Carteira Desbloqueada. DID Ativo: ${signerDid}\n`);

  // --- 1. SIMULAÇÃO DE BUSCA DE DID (M2M Token + Challenge) ---
  console.log("▶️ INICIANDO BUSCA DE DID (Simulando Mobile App)...");

  // A. Gerar o token M2M (Bearer HMAC)
  const m2mToken = crypto.createHmac("sha256", signerSecret as string).update(signerDid).digest("hex");

  // Precisamos do requesterId (ID do usuário no banco). Vamos buscar diretamente via Prisma 
  // apenas para o propósito do teste, já que o App Mobile armazena seu próprio ID de usuário após o login.
  const { prisma } = require("../src/lib/prisma");
  const requester = await prisma.user.findFirst({ where: { did: signerDid } });

  if (!requester) {
    console.error("❌ Usuário associado a esta DID não encontrado no banco.");
    process.exit(1);
  }

  const authHeaders = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${m2mToken}`
  };

  console.log(`⏳ 1. Solicitando desafio (Challenge) para o usuário ${requester.email}...`);
  const challengeRes = await fetch(`${APP_URL}/api/dids/search/challenge`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ requesterId: requester.id })
  });

  if (!challengeRes.ok) {
    console.error("❌ Falha ao solicitar desafio:", await challengeRes.text());
    process.exit(1);
  }

  const challengeData = await challengeRes.json();
  console.log(`✅ Desafio recebido: ${challengeData.nonce}`);

  console.log(`⏳ 2. Gerando Credencial Verificável (PoP) com o desafio recebido...`);
  
  const authPayload = {
    action: "did_search_auth",
    nonce: challengeData.nonce,
    timestamp: new Date().toISOString()
  };

  const authSchema = core.createSchemaFromAttributes(authPayload, {
    version: "1",
    createdAt: authPayload.timestamp
  });

  let authCredential;
  try {
    authCredential = core.walletIssueCredentialFromSchema(
      walletPath,
      walletPassword,
      signerDid,
      authSchema,
      authPayload,
      {
        credentialId: `did-search-auth-${Date.now()}`,
        issuedAt: authPayload.timestamp,
        visiblePaths: ["action", "nonce", "timestamp"]
      }
    );
    console.log(`✅ Credencial PoP gerada com sucesso!`);
  } catch (err: any) {
    console.error("❌ Falha ao gerar credencial PoP:", err.message);
    process.exit(1);
  }

  const authCredentialBase64 = Buffer.from(JSON.stringify(authCredential)).toString("base64");

  console.log(`⏳ 3. Consultando o endpoint /api/dids/search testando a busca flexível (por did)...`);
  const searchHeaders = {
    "Authorization": `Bearer ${m2mToken}`,
    "x-requester-id": requester.id,
    "x-challenge-id": challengeData.id,
    "x-signer-auth-credential": authCredentialBase64
  };

  const searchRes = await fetch(`${APP_URL}/api/dids/search?did=${signerDid}`, {
    method: 'GET',
    headers: searchHeaders
  });

  if (!searchRes.ok) {
    console.error("❌ Falha na busca de DID:", await searchRes.text());
  } else {
    const searchResult = await searchRes.json();
    console.log("\n📦 RESULTADO DO ENDPOINT DE DID (/api/dids/search):");
    console.log(JSON.stringify(searchResult, null, 2));
  }


  // --- 2. SIMULAÇÃO DE CONSULTA DE SCHEMAS ---
  console.log("\n-------------------------------------------------");
  console.log("▶️ CONSULTA DE SCHEMAS (/api/schemas)");
  console.log("Como os endpoints de schemas utilizam sessão de navegador (NextAuth) e não Token M2M,");
  console.log("estamos consultando diretamente a camada de banco de dados para demonstrar a estrutura de retorno exata.");

  const schemas = await prisma.credentialSchema.findMany({
    where: { creatorId: requester.id },
    select: {
      id: true,
      name: true,
      version: true,
      visibility: true,
      storageLocation: true,
      ipfsCid: true,
      pinataFileId: true,
      publishedAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 1
  });

  const gateway = process.env.GATEWAY_PINATA;
  const schemasWithUrl = schemas.map((schema: any) => ({
    ...schema,
    ipfsUrl: schema.ipfsCid && gateway ? `https://${gateway}/ipfs/${schema.ipfsCid}` : null
  }));

  console.log("\n📦 RESULTADO DO ENDPOINT DE SCHEMAS (/api/schemas?mine=true):");
  console.log(JSON.stringify(schemasWithUrl, null, 2));

  if (schemas.length > 0) {
    const singleSchemaId = schemas[0].id;
    console.log(`\n▶️ CONSULTA DE SCHEMA INDIVIDUAL (/api/schemas/${singleSchemaId})`);
    
    const singleSchema = await prisma.credentialSchema.findUnique({
      where: { id: singleSchemaId },
      select: {
        id: true,
        name: true,
        version: true,
        visibility: true,
        storageLocation: true,
        ipfsCid: true,
        pinataFileId: true,
        publishedAt: true,
        createdAt: true,
      }
    });

    const singleSchemaWithUrl = {
      ...singleSchema,
      ipfsUrl: singleSchema?.ipfsCid && gateway ? `https://${gateway}/ipfs/${singleSchema.ipfsCid}` : null
    };

    console.log(`\n📦 RESULTADO DO ENDPOINT DE SCHEMA INDIVIDUAL (/api/schemas/${singleSchemaId}):`);
    console.log(JSON.stringify(singleSchemaWithUrl, null, 2));
  }

  await prisma.$disconnect();
  console.log("\n=================================================");
  console.log("✅ Teste finalizado.");
}

main().catch(console.error);
