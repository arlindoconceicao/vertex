// teste-node/attrib/test_attrib_02_read.js
//
// TESTE ATTRIB 02 — leitura de ATTRIB do ledger (write → read → assert)
//
// Executar:
//   WALLET_PASS="minha_senha_teste" GENESIS_FILE=./genesis.txn RESET_WALLET=1 node teste-node/attrib/test_attrib_02_read.js
//
// O fluxo:
// 1) cria/abre wallet
// 2) conecta no ledger
// 3) importa Trustee DID
// 4) cria DID do issuer e registra no ledger (ENDORSER)
// 5) escreve ATTRIB no próprio DID
// 6) lê ATTRIB do ledger e valida valor

/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");

// ✅ index.node fica na RAIZ do projeto
// teste-node/attrib -> ../../index.node
const { IndyAgent } = require(path.join(__dirname, "..", "..", "index.node"));

// Remove artefatos da wallet, se existirem, para permitir recriar do zero
function rmIfExists(walletDbPath) {
  const sidecar = `${walletDbPath}.kdf.json`;

  try { fs.unlinkSync(walletDbPath); } catch (_) { }
  try { fs.unlinkSync(sidecar); } catch (_) { }
  try { fs.unlinkSync(`${sidecar}.tmp`); } catch (_) { }

  try { fs.unlinkSync(`${walletDbPath}-shm`); } catch (_) { }
  try { fs.unlinkSync(`${walletDbPath}-wal`); } catch (_) { }
}

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Env ${name} não definida.`);
  return v;
}

function safeJsonParse(s) {
  try { return JSON.parse(s); } catch (_) { return null; }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

(async () => {
  // -------------------------
  // Config do teste
  // -------------------------
  const GENESIS_FILE = mustEnv("GENESIS_FILE"); // ex: ./genesis.txn
  const WALLET_PASS = process.env.WALLET_PASS || "minha_senha_teste";
  const RESET_WALLET = String(process.env.RESET_WALLET || "0") === "1";

  // von-network padrão
  const TRUSTEE_SEED = process.env.TRUSTEE_SEED || "000000000000000000000000Trustee1";
  const TRUSTEE_DID = process.env.TRUSTEE_DID || "V4SGRU86Z58d6TV7PBUe6f";

  // Pasta teste-node/wallets
  const walletsDir = path.join(__dirname, "..", "wallets");
  fs.mkdirSync(walletsDir, { recursive: true });

  const issuerWalletPath = path.join(walletsDir, "issuer_attrib_02.db");

  console.log("🚀 TESTE ATTRIB 02: read ATTRIB do ledger");
  console.log("Config:", {
    issuerWalletPath,
    RESET_WALLET,
    GENESIS_FILE,
    WALLET_PASS: "***",
  });

  if (RESET_WALLET) {
    console.log("🧹 RESET_WALLET=1: removendo wallet artifacts...");
    rmIfExists(issuerWalletPath);
  }

  const issuer = new IndyAgent();

  try {
    // -------------------------
    // Wallet + Network
    // -------------------------
    console.log("1) Criando wallet...");
    await issuer.walletCreate(issuerWalletPath, WALLET_PASS);
    console.log("✅ Wallet criada:", issuerWalletPath);

    console.log("2) Abrindo wallet...");
    await issuer.walletOpen(issuerWalletPath, WALLET_PASS);
    console.log("✅ Wallet aberta.");

    console.log("3) Conectando na rede...");
    await issuer.connectNetwork(GENESIS_FILE);
    console.log("✅ Pool conectado.");

    console.log("4) Importando Trustee DID no issuer...");
    await issuer.importDidFromSeed(TRUSTEE_SEED);
    console.log("✅ Trustee importado.");

    // -------------------------
    // DID do issuer + registrar
    // -------------------------
    console.log("5) Criando DID do emissor (issuer)...");
    const [issuerDid, issuerVerkey] = await issuer.createOwnDid();
    console.log("✅ Issuer DID:", issuerDid);

    console.log("6) Registrando DID do emissor no ledger (ENDORSER)...");
    await issuer.registerDidOnLedger(
      GENESIS_FILE,
      TRUSTEE_DID,
      issuerDid,
      issuerVerkey,
      "ENDORSER"
    );
    console.log("✅ DID do issuer registrado no ledger.");

    // -------------------------
    // ATTRIB write (preparo para leitura)
    // -------------------------
    console.log("7) Escrevendo ATTRIB no ledger...");
    const key = "email";
    const expectedValue = "user@example.com";

    const writeRespStr = await issuer.writeAttribOnLedger(
      GENESIS_FILE,
      issuerDid,
      key,
      expectedValue
    );

    const writeJson = safeJsonParse(writeRespStr);
    if (!writeJson) {
      throw new Error(`Resposta do write não é JSON válido: ${String(writeRespStr).slice(0, 250)}...`);
    }
    const op = writeJson.op || writeJson?.result?.op;
    if (op && String(op).toUpperCase() !== "REPLY") {
      throw new Error(`Write: ledger não respondeu REPLY. op=${op} resp=${writeRespStr}`);
    }
    if (writeJson.reason || writeJson?.result?.reason) {
      throw new Error(`Write: ledger retornou reason: ${writeJson.reason || writeJson?.result?.reason}`);
    }

    const txnTime =
      writeJson?.result?.txnMetadata?.txnTime ??
      writeJson?.result?.txnTime ??
      writeJson?.txnMetadata?.txnTime;

    const seqNo =
      writeJson?.result?.txnMetadata?.seqNo ??
      writeJson?.result?.seqNo ??
      writeJson?.txnMetadata?.seqNo;

    console.log("✅ ATTRIB escrito com sucesso:", { did: issuerDid, key, expectedValue });
    console.log("📨 Write reply (resumo):", { op: writeJson.op, txnTime, seqNo });

    // Pequeno backoff para evitar consistência eventual (ledger)
    await sleep(250);

    // -------------------------
    // ATTRIB read + assert
    // -------------------------
    console.log("8) Lendo ATTRIB do ledger...");
    const readValue = await issuer.readAttribFromLedger(GENESIS_FILE, issuerDid, key);

    // A lib costuma retornar string (o value) diretamente.
    // Se vier JSON (por alguma mudança), tentamos extrair.
    let normalized = readValue;
    if (typeof readValue === "string") {
      // Se vier algo como {"email":"..."} (não esperado), tenta extrair
      const maybeObj = safeJsonParse(readValue);
      if (maybeObj && typeof maybeObj === "object" && key in maybeObj) {
        normalized = maybeObj[key];
      }
    }

    console.log("📥 Read returned:", normalized);

    if (String(normalized) !== String(expectedValue)) {
      throw new Error(
        `❌ Valor lido diferente do esperado. ` +
        `key=${key} esperado="${expectedValue}" obtido="${normalized}"`
      );
    }

    console.log("✅ OK: valor lido confere com o valor escrito.");
    console.log("✅ OK: TESTE ATTRIB 02 passou.");
  } finally {
    try {
      console.log("🔒 Fechando wallet...");
      await issuer.walletClose();
    } catch (_) { }
  }
})().catch((e) => {
  console.error("❌ FALHA TESTE ATTRIB 02:", e?.message || e);
  console.error(e?.stack || "");
  process.exit(1);
});
