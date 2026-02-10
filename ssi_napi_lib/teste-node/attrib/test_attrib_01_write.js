// teste-node/attrib/test_attrib_01_write.js
//
// TESTE ATTRIB 01 — escrita de ATTRIB no ledger (happy path)
//
// Executar:
//   WALLET_PASS="minha_senha_teste" GENESIS_FILE=./genesis.txn RESET_WALLET=1 node teste-node/attrib/test_attrib_01_write.js

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

  const issuerWalletPath = path.join(walletsDir, "issuer_attrib_01.db");

  console.log("🚀 TESTE ATTRIB 01: write ATTRIB no ledger");
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
    // ATTRIB write
    // -------------------------
    console.log("7) Escrevendo ATTRIB no ledger...");
    const key = "email";
    const value = "user@example.com";

    // IMPORTANTE: no JS o método é camelCase
    const respStr = await issuer.writeAttribOnLedger(GENESIS_FILE, issuerDid, key, value);

    const json = safeJsonParse(respStr);
    if (!json) {
      throw new Error(`Resposta do ledger não é JSON válido: ${String(respStr).slice(0, 250)}...`);
    }

    const op = json.op || json?.result?.op;
    if (op && String(op).toUpperCase() !== "REPLY") {
      throw new Error(`Ledger não respondeu REPLY. op=${op} resp=${respStr}`);
    }
    if (json.reason || json?.result?.reason) {
      throw new Error(`Ledger retornou reason: ${json.reason || json?.result?.reason}`);
    }

    console.log("RAW reply:", respStr);
    console.log("keys:", Object.keys(json));
    console.log("result keys:", json.result ? Object.keys(json.result) : null);

    console.log("✅ ATTRIB escrito com sucesso:", { did: issuerDid, key, value });

    const txnTime =
      json?.result?.txnMetadata?.txnTime ??
      json?.result?.txnTime ??
      json?.txnMetadata?.txnTime;

    const seqNo =
      json?.result?.txnMetadata?.seqNo ??
      json?.result?.seqNo ??
      json?.txnMetadata?.seqNo;

    console.log("📨 Ledger reply (resumo):", { op: json.op, txnTime, seqNo });

    console.log("✅ OK: TESTE ATTRIB 01 passou.");
  } finally {
    try {
      console.log("🔒 Fechando wallet...");
      await issuer.walletClose();
    } catch (_) { }
  }
})().catch((e) => {
  console.error("❌ FALHA TESTE ATTRIB 01:", e?.message || e);
  console.error(e?.stack || "");
  process.exit(1);
});
