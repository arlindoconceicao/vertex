/**
 * Script de Simulação do Aplicativo Móvel: Conclusão do Pareamento DID
 *
 * Este script simula a ação do aplicativo móvel ao receber o desafio da web.
 * Ele gera as chaves pós-quânticas (ML-DSA-65 e ML-KEM-768), assina a mensagem
 * do desafio e envia a requisição HTTP POST para o endpoint da plataforma.
 *
 * Uso:
 *   node lib/complete-pairing.js '<JSON_PAYLOAD_COPIADO_DA_WEB>'
 * ou
 *   node lib/complete-pairing.js <pairingId> <nonce> [endpoint] [userId] [email]
 */

require("dotenv").config();

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

  console.log("=================================================");
  console.log("🚀 SIMULANDO APLICATIVO MÓVEL - PAREAMENTO DID");
  console.log("=================================================");
  console.log(`📌 Pairing ID : ${pairingId}`);
  console.log(`📌 Nonce      : ${nonce}`);
  console.log(`📌 Endpoint   : ${endpoint}`);
  if (email) console.log(`📌 Account    : ${email}`);

  // 1. Geração de Identidade DID e Chaves Pós-Quânticas no App Móvel
  console.log("\n🔑 1. Gerando DID e chaves pós-quânticas (ML-DSA-65 / ML-KEM-768)...");
  const mobileDid = core.createDid({
    mldsa: "ML-DSA-65",
    mlkem: "ML-KEM-768",
    createdAt: new Date().toISOString(),
  });

  console.log(`   ✔ DID Gerado : ${mobileDid.did}`);

  // Extrai as chaves públicas
  const mldsaKeyObj = mobileDid.didDocument.keys.find(
    (k) => k.type === "ML-DSA-65"
  );
  const mlkemKeyObj = mobileDid.didDocument.keys.find(
    (k) => k.type === "ML-KEM-768"
  );

  const mlDsaPublicKey = mldsaKeyObj ? mldsaKeyObj.public_key_multibase : "";
  const mlKemPublicKey = mlkemKeyObj ? mlkemKeyObj.public_key_multibase : "";

  // 2. Montagem e Canonicalização do Payload de Assinatura do Desafio
  console.log("\n✍️  2. Assinando o desafio com ML-DSA-65...");
  const challengeDataToSign = {
    pairingId,
    nonce,
    expiresAt,
    did: mobileDid.did,
  };

  const canonicalString = core.canonicalJson(JSON.stringify(challengeDataToSign));
  const messageBuffer = Buffer.from(canonicalString, "utf-8");

  const proofValue = core.mldsaSign(
    "ML-DSA-65",
    mobileDid.privateKeys.mldsaPrivateKey,
    messageBuffer,
    "did-pairing-challenge"
  );

  console.log(`   ✔ Assinatura ML-DSA gerada (length: ${proofValue.length})`);

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
    proof: {
      type: "ML-DSA-65",
      created: new Date().toISOString(),
      verificationMethod: `${mobileDid.did}#mldsa-1`,
      proofValue,
    },
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
