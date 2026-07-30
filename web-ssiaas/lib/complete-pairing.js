/**
 * Script de Simulação do Aplicativo Móvel: Conclusão do Pareamento DID
 *
 * Este script simula a ação do aplicativo móvel ao receber o desafio da web.
 * Ele gera as chaves pós-quânticas (ML-DSA-65 e ML-KEM-768), assina a mensagem
 * do desafio, envia a requisição HTTP POST para o endpoint da plataforma e
 * armazena as chaves e o DID em um banco SQLite cifrado (lib/mobile_wallet.db)
 * com senha mantida em lib/keys.txt.
 *
 * Uso:
 *   node lib/complete-pairing.js '<JSON_PAYLOAD_COPIADO_DA_WEB>'
 * ou
 *   node lib/complete-pairing.js <pairingId> <nonce> [endpoint] [userId] [email]
 */

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const core = require("./ssi_pq_core.node");

async function main() {
  const arg1 = process.argv[2];

  if (!arg1) {
    console.error(`
[ERRO] Argumentos ausentes.
Uso:
  node lib/complete-pairing.js '<JSON_PAYLOAD_COPIADO_DA_WEB>'

Exemplo:
  node lib/complete-pairing.js '{"pairingId":"abc...","nonce":"xyz...","endpoint":"http://localhost:3000/api/v1/did-pairings/abc.../complete","email":"teste@gmail.com"}'
`);
    process.exit(1);
  }

  let pairingId = "";
  let nonce = "";
  let expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  let endpoint = "";
  let userId = undefined;
  let email = undefined;
  let challengeId = undefined;

  // Verifica se o primeiro argumento é uma string JSON (copiada do botão da tela web)
  if (arg1.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(arg1);
      pairingId = parsed.pairingId;
      nonce = parsed.nonce;
      expiresAt = parsed.expiresAt || expiresAt;
      endpoint = parsed.endpoint;
      userId = parsed.userId;
      email = parsed.email;
      challengeId = parsed.id;
    } catch (err) {
      console.error("[ERRO] JSON inválido fornecido no argumento:", err.message);
      process.exit(1);
    }
  } else {
    // Argumentos posicionais: pairingId nonce [endpoint]
    pairingId = arg1;
    nonce = process.argv[3];
    endpoint =
      process.argv[4] ||
      `http://localhost:3000/api/v1/did-pairings/${pairingId}/complete`;
    userId = process.argv[5];
    email = process.argv[6];

    if (!pairingId || !nonce) {
      console.error("[ERRO] Informe pelo menos pairingId e nonce.");
      process.exit(1);
    }
  }

  if (!endpoint) {
    endpoint = `http://localhost:3000/api/v1/did-pairings/${pairingId}/complete`;
  }

  // 0. Gerenciamento do Arquivo de Chave (keys.txt) e Wallet SQLite (mobile_wallet.db)
  const keysFilePath = path.join(__dirname, "keys.txt");
  let walletPassword = "";

  if (fs.existsSync(keysFilePath)) {
    walletPassword = fs.readFileSync(keysFilePath, "utf-8").trim();
  } else {
    walletPassword = "senha-wallet-mobile-123";
    fs.writeFileSync(keysFilePath, walletPassword, "utf-8");
  }

  const walletPath = path.join(__dirname, "mobile_wallet.db");
  const isNewWallet = !fs.existsSync(walletPath);

  if (isNewWallet) {
    core.walletCreate(walletPath, walletPassword, {
      createdAt: new Date().toISOString(),
    });
  } else {
    core.walletOpen(walletPath, walletPassword);
  }

  console.log("=================================================");
  console.log("🚀 SIMULANDO APLICATIVO MÓVEL - PAREAMENTO DID");
  console.log("=================================================");
  console.log(`📌 Pairing ID : ${pairingId}`);
  console.log(`📌 Nonce      : ${nonce}`);
  console.log(`📌 Endpoint   : ${endpoint}`);
  if (email) console.log(`📌 Account    : ${email}`);
  console.log(`🔑 Wallet Key : ${keysFilePath}`);
  console.log(`💾 Wallet DB  : ${walletPath} (${isNewWallet ? "Nova" : "Existente"})`);

  // 1. Geração ou Carregamento de Identidade DID
  let mobileDid = null;
  let didDoc = null;
  let proofValue = null;

  if (isNewWallet) {
    console.log("\n🔑 1. Gerando novo DID e chaves pós-quânticas (ML-DSA-65 / ML-KEM-768)...");
    const createdAt = new Date().toISOString();
    mobileDid = core.createDid({
      mldsa: "ML-DSA-65",
      mlkem: "ML-KEM-768",
      createdAt,
    });

    core.walletCreateDid(walletPath, walletPassword, {
      label: `Mobile DID (${email || "Teste"})`,
      mldsa: "ML-DSA-65",
      mlkem: "ML-KEM-768",
      createdAt,
    });
    
    didDoc = mobileDid.didDocument;
    
    console.log("\n✍️  2. Assinando o desafio com ML-DSA-65...");
    const challengeDataToSign = {
      pairingId,
      nonce,
      expiresAt,
      did: mobileDid.did,
    };

    const canonicalString = core.canonicalJson(JSON.stringify(challengeDataToSign));
    const messageBuffer = Buffer.from(canonicalString, "utf-8");

    proofValue = core.mldsaSign(
      "ML-DSA-65",
      mobileDid.privateKeys.mldsaPrivateKey,
      messageBuffer,
      "did-pairing-challenge"
    );
    console.log(`   ✔ Assinatura ML-DSA gerada (length: ${proofValue.length})`);
  } else {
    console.log("\n🔑 1. Reaproveitando DID existente na Wallet DB...");
    const walletDidsList = core.walletListDids(walletPath, walletPassword);
    if (walletDidsList.length === 0) {
      console.error("❌ Wallet existe, mas não contém DIDs.");
      process.exit(1);
    }
    
    const targetDid = walletDidsList[0].did;
    didDoc = core.walletGetDidDocument(walletPath, walletPassword, targetDid);
    
    mobileDid = {
      did: targetDid,
      didDocument: didDoc
    };
    
    console.log(`   ✔ DID Recuperado da Wallet : ${mobileDid.did}`);
    console.log("\n✍️  2. Pulando assinatura pois a chave privada está segura na wallet (Autenticação baseada no DB).");
  }

  // Extrai as chaves públicas
  const mldsaKeyObj = didDoc.keys ? didDoc.keys.find((k) => k.type === "ML-DSA-65") : 
                      didDoc.verificationMethod ? didDoc.verificationMethod.find((k) => k.type === "ML-DSA-65" || k.type === "ML-DSA") : null;
  const mlkemKeyObj = didDoc.keys ? didDoc.keys.find((k) => k.type === "ML-KEM-768") :
                      didDoc.verificationMethod ? didDoc.verificationMethod.find((k) => k.type === "ML-KEM-768" || k.type === "ML-KEM") : null;

  const mlDsaPublicKey = mldsaKeyObj ? (mldsaKeyObj.public_key_multibase || mldsaKeyObj.publicKeyMultibase) : "";
  const mlKemPublicKey = mlkemKeyObj ? (mlkemKeyObj.public_key_multibase || mlkemKeyObj.publicKeyMultibase) : "";

  // 3. Envio da Requisição HTTP POST ao Endpoint da Plataforma Web
  console.log(`\n📡 3. Enviando resposta de pareamento para a plataforma...`);

  const requestBody = {
    id: challengeId,
    pairingId,
    nonce,
    expiresAt,
    userId,
    email,
    did: mobileDid.did,
    didDocument: mobileDid.didDocument,
    mlDsaPublicKey,
    mlKemPublicKey,
    ...(proofValue ? {
      proof: {
        type: "ML-DSA-65",
        created: new Date().toISOString(),
        verificationMethod: `${mobileDid.did}#mldsa-1`,
        proofValue,
      }
    } : {}),
  };

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    const responseData = await response.json();

    console.log("\n=================================================");
    if (response.ok) {
      console.log("✅ PAREAMENTO CONCLUÍDO COM SUCESSO PELA PLATAFORMA!");
      console.log("=================================================");
      console.log(JSON.stringify(responseData, null, 2));
      console.log(
        "\n👉 Agora observe a tela da plataforma web (http://localhost:3000/settings)!"
      );
      console.log("   Ela atualizará automaticamente para o estado PAREADO.");
    } else {
      console.log(`❌ ERRO NA RESPOSTA DA PLATAFORMA (HTTP ${response.status})`);
      console.log("=================================================");
      console.log(JSON.stringify(responseData, null, 2));
    }
  } catch (err) {
    console.error("\n❌ ERRO DE CONEXÃO AO ACESSAR O ENDPOINT:", err.message);
  }
}

main();

