/*
PARA RODAR ESTE TESTE:
TRUSTEE_SEED="000000000000000000000000Trustee1" \
TRUSTEE_DID="V4SGRU86Z58d6TV7PBUe6f" \
WALLET_PASS="minha_senha_teste" GENESIS_FILE=./genesis.txn \
node teste-node/presentations/test_env_neg_03_invalid_mode.js

O QUE ESTE TESTE FAZ (INVALID MODE):
- Cria wallets + conecta no ledger
- Cria DID do issuer e DID do holder e registra no ledger
- Issuer cria um envelope authcrypt válido e grava em arquivo
- O teste CORROMPE o JSON do envelope mudando crypto.mode para "badmode"
- Holder tenta abrir via envelopeUnpackAuto e DEVE falhar na validação básica
  com: "Envelope: crypto.mode inválido"
*/

/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");

const { IndyAgent } = require(path.join(__dirname, "..", "..", "index.node"));

// -------------------------
// Helpers FS / ENV
// -------------------------
function rmIfExists(walletDbPath) {
  const sidecar = `${walletDbPath}.kdf.json`;
  try { fs.unlinkSync(walletDbPath); } catch (_) {}
  try { fs.unlinkSync(sidecar); } catch (_) {}
  try { fs.unlinkSync(`${sidecar}.tmp`); } catch (_) {}
  try { fs.unlinkSync(`${walletDbPath}-shm`); } catch (_) {}
  try { fs.unlinkSync(`${walletDbPath}-wal`); } catch (_) {}
}

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Env ${name} não definida.`);
  return v;
}

function writeFileAtomic(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, data, "utf8");
}

function readFileUtf8(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function pExchange(exchangeDir, name) {
  return path.join(exchangeDir, name);
}

// -------------------------
// Ledger: register DID (ignore if exists)
// -------------------------
async function tryRegisterDid(agent, GENESIS_FILE, submitterDid, did, verkey, role) {
  try {
    await agent.registerDidOnLedger(GENESIS_FILE, submitterDid, did, verkey, role);
  } catch (e) {
    const msg = e?.message || String(e);
    if (/already exists|exists|DID.*exist|NYM.*exist|Ledger/i.test(msg)) {
      console.log(`ℹ️ DID já estava no ledger, seguindo: ${did}`);
      return;
    }
    throw e;
  }
}

// -------------------------
// Envelope helpers
// -------------------------
async function packValidEnvelopeToFile(senderAgent, senderDid, recipientVerkey, plaintext, filePath) {
  const envelopeJson = await senderAgent.envelopePackAuthcrypt(
    senderDid,
    recipientVerkey,
    "neg_test_invalid_mode",
    null,
    plaintext,
    null,
    JSON.stringify({ test: "invalid_mode" })
  );
  writeFileAtomic(filePath, envelopeJson);
}

function corruptEnvelopeModeInFile(filePath, newMode) {
  const envJson = readFileUtf8(filePath);
  const envObj = JSON.parse(envJson);

  if (!envObj.crypto || typeof envObj.crypto !== "object") {
    throw new Error("Envelope sem campo crypto.");
  }

  envObj.crypto.mode = newMode;

  // (opcional) também corrompe alg para deixar claro que o envelope foi adulterado
  envObj.crypto.alg = `corrupted:${envObj.crypto.alg || "unknown"}`;

  writeFileAtomic(filePath, JSON.stringify(envObj, null, 2));
}

async function unpackEnvelopeFromFile(receiverAgent, receiverDid, filePath) {
  const envelopeJson = readFileUtf8(filePath);
  return receiverAgent.envelopeUnpackAuto(receiverDid, envelopeJson);
}

// -------------------------
// MAIN
// -------------------------
(async () => {
  const GENESIS_FILE = mustEnv("GENESIS_FILE");
  const WALLET_PASS = process.env.WALLET_PASS || "minha_senha_teste";
  const TRUSTEE_SEED = mustEnv("TRUSTEE_SEED");
  const TRUSTEE_DID = mustEnv("TRUSTEE_DID");

  const walletsDir = path.join(__dirname, "..", "wallets");
  fs.mkdirSync(walletsDir, { recursive: true });

  const exchangeDir = path.join(__dirname, "exchange_env_neg_03_invalid_mode");
  fs.mkdirSync(exchangeDir, { recursive: true });

  // Wallets (reset)
  const issuerWalletPath = path.join(walletsDir, "issuer_env_neg_03_invalid_mode.db");
  const holderWalletPath = path.join(walletsDir, "holder_env_neg_03_invalid_mode.db");
  rmIfExists(issuerWalletPath);
  rmIfExists(holderWalletPath);

  const issuer = new IndyAgent();
  const holder = new IndyAgent();

  try {
    console.log("1) Criando wallets...");
    await issuer.walletCreate(issuerWalletPath, WALLET_PASS);
    await holder.walletCreate(holderWalletPath, WALLET_PASS);

    console.log("2) Abrindo wallets...");
    await issuer.walletOpen(issuerWalletPath, WALLET_PASS);
    await holder.walletOpen(holderWalletPath, WALLET_PASS);

    console.log("3) Conectando na rede...");
    await issuer.connectNetwork(GENESIS_FILE);
    await holder.connectNetwork(GENESIS_FILE);

    console.log("4) Importando Trustee DID no issuer...");
    await issuer.importDidFromSeed(TRUSTEE_SEED);

    console.log("5) Criando DIDs (issuer/holder)...");
    const [issuerDid, issuerVerkey] = await issuer.createOwnDid();
    const [holderDid, holderVerkey] = await holder.createOwnDid();

    console.log("6) Registrando DIDs no ledger...");
    await tryRegisterDid(issuer, GENESIS_FILE, TRUSTEE_DID, issuerDid, issuerVerkey, "ENDORSER");
    await tryRegisterDid(issuer, GENESIS_FILE, TRUSTEE_DID, holderDid, holderVerkey, null);

    console.log("7) Issuer criando envelope válido (authcrypt) e gravando em arquivo...");
    const envFile = pExchange(exchangeDir, "invalid_mode_01.env.json");
    await packValidEnvelopeToFile(
      issuer,
      issuerDid,
      holderVerkey,
      "mensagem-para-testar-invalid-mode",
      envFile
    );

    console.log('8) Corrompendo envelope: crypto.mode="badmode"...');
    corruptEnvelopeModeInFile(envFile, "badmode");

    console.log("9) Holder tentando desempacotar via envelopeUnpackAuto (DEVE falhar)...");
    try {
      const plaintext = await unpackEnvelopeFromFile(holder, holderDid, envFile);
      console.error("❌ FALHA: era esperado erro de crypto.mode inválido, mas retornou:", plaintext);
      process.exit(1);
    } catch (e) {
      const msg = e?.message || String(e);
      console.log("✅ OK: falhou como esperado.");
      console.log("Mensagem de erro:", msg);

      if (!/crypto\.mode inválido/i.test(msg)) {
        console.error("❌ Erro não parece ser 'crypto.mode inválido'. Ajuste regex.");
        process.exit(1);
      }
    }

    console.log(`📁 Arquivos gerados em: ${exchangeDir}`);
  } finally {
    try { await issuer.walletClose(); } catch (_) {}
    try { await holder.walletClose(); } catch (_) {}
  }
})().catch((e) => {
  console.error("FALHA NO TESTE:", e?.message || e);
  console.error(e?.stack || "");
  process.exit(1);
});
