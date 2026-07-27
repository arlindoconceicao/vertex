/**
 * Script de Simulação de Ataque: Forjamento de Assinatura no Pareamento DID
 *
 * Este script simula uma tentativa de ataque ou adulteração no pareamento.
 * Ele gera chaves pós-quânticas válidas, mas altera propositalmente os bytes
 * da assinatura ML-DSA-65 antes de enviar a requisição HTTP POST para a plataforma.
 *
 * Uso:
 *   node lib/complete-pairing-forged.js '<JSON_PAYLOAD_COPIADO_DA_WEB>'
 * ou
 *   node lib/complete-pairing-forged.js <pairingId> <nonce> [endpoint] [userId] [email]
 */

require("dotenv").config();

const core = require("./ssi_pq_core.node");

async function main() {
  const arg1 = process.argv[2];

  if (!arg1) {
    console.error(`
[ERRO] Argumentos ausentes.
Uso:
  node lib/complete-pairing-forged.js '<JSON_PAYLOAD_COPIADO_DA_WEB>'

Exemplo:
  node lib/complete-pairing-forged.js '{"pairingId":"abc...","nonce":"xyz...","endpoint":"http://localhost:3000/api/v1/did-pairings/abc.../complete","email":"teste@gmail.com"}'
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
  console.log("⚠️  SIMULANDO ATAQUE / ASSINATURA FORJADA (DID)");
  console.log("=================================================");
  console.log(`📌 Pairing ID : ${pairingId}`);
  console.log(`📌 Nonce      : ${nonce}`);
  console.log(`📌 Endpoint   : ${endpoint}`);
  if (email) console.log(`📌 Account    : ${email}`);

  // 1. Geração de Identidade DID e Chaves Pós-Quânticas no App Móvel
  console.log("\n🔑 1. Gerando DID e chaves pós-quânticas válidas...");
  const mobileDid = core.createDid({
    mldsa: "ML-DSA-65",
    mlkem: "ML-KEM-768",
    createdAt: new Date().toISOString(),
  });

  console.log(`   ✔ DID Gerado : ${mobileDid.did}`);

  const mldsaKeyObj = mobileDid.didDocument.keys.find(
    (k) => k.type === "ML-DSA-65"
  );
  const mlkemKeyObj = mobileDid.didDocument.keys.find(
    (k) => k.type === "ML-KEM-768"
  );

  const mlDsaPublicKey = mldsaKeyObj ? mldsaKeyObj.public_key_multibase : "";
  const mlKemPublicKey = mlkemKeyObj ? mlkemKeyObj.public_key_multibase : "";

  // 2. Geração da Assinatura e Alteração Proposital (Forjamento)
  console.log("\n✍️  2. Gerando e ADULTERANDO propositalmente a assinatura ML-DSA...");
  const challengeDataToSign = {
    pairingId,
    nonce,
    expiresAt,
    did: mobileDid.did,
  };

  const canonicalString = core.canonicalJson(JSON.stringify(challengeDataToSign));
  const messageBuffer = Buffer.from(canonicalString, "utf-8");

  const validProofValue = core.mldsaSign(
    "ML-DSA-65",
    mobileDid.privateKeys.mldsaPrivateKey,
    messageBuffer,
    "did-pairing-challenge"
  );

  // Adultera alguns caracteres da assinatura em base64url para simular forjamento
  const forgedProofValue =
    validProofValue.slice(0, 10) +
    (validProofValue[10] === "A" ? "B" : "A") +
    validProofValue.slice(11);

  console.log(`   ✔ Assinatura Original Válida (length: ${validProofValue.length})`);
  console.log(`   💥 Assinatura Adulterada (length: ${forgedProofValue.length})`);

  // 3. Envio da Requisição HTTP POST para a Plataforma Web
  console.log(`\n📡 3. Enviando requisição com assinatura forjada para a plataforma...`);

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
      proofValue: forgedProofValue, // Assinatura forjada!
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
    if (!response.ok && response.status === 400) {
      console.log("🛡️  SUCESSO NO TESTE DE SEGURANÇA!");
      console.log("   A PLATAFORMA DETECTOU E REJEITOU A ASSINATURA ADULTERADA!");
      console.log("=================================================");
      console.log(` Status HTTP : ${response.status}`);
      console.log(` Resposta    :`, JSON.stringify(responseData, null, 2));
      console.log(
        "\n✅ O mecanismo de validação criptográfica ML-DSA-65 funcionou perfeitamente!"
      );
    } else {
      console.log(`❌ FALHA DE SEGURANÇA! A resposta não foi HTTP 400 (Status: ${response.status})`);
      console.log("=================================================");
      console.log(JSON.stringify(responseData, null, 2));
    }
  } catch (err) {
    console.error("\n❌ ERRO DE CONEXÃO AO ACESSAR O ENDPOINT:", err.message);
  }
}

main();
