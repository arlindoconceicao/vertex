/*
PARA RODAR ESTE TESTE:
TRUSTEE_SEED="000000000000000000000000Trustee1" \
TRUSTEE_DID="V4SGRU86Z58d6TV7PBUe6f" \
WALLET_PASS="minha_senha_teste" GENESIS_FILE=./genesis.txn \
node teste-node/presentations/test_env_neg_04_empty_kind_thread.js

O QUE ESTE TESTE FAZ (KIND/THREAD_ID VAZIOS):
- Cria wallets + conecta no ledger
- Cria DID do issuer e DID do holder e registra no ledger
- Issuer cria um envelope authcrypt válido e grava em arquivo
- O teste CORROMPE o envelope duas vezes:
  A) kind = "   " (vazio após trim) -> deve falhar: "Envelope: kind vazio"
  B) thread_id = "   " (vazio após trim) -> deve falhar: "Envelope: thread_id vazio"
- Cada caso é testado separadamente em seu próprio arquivo .env.json
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
  // kind e thread_id podem ser sobrescritos no "corrupt" depois
  const envelopeJson = await senderAgent.envelopePackAuthcrypt(
    senderDid,
    recipientVerkey,
    "neg_test_empty_fields",
    null, // thread_id auto
    plaintext,
    null,
    JSON.stringify({ test: "empty_kind_thread" })
  );
  writeFileAtomic(filePath, envelopeJson);
}

function corruptEnvelopeFieldsInFile(filePath, patchFn) {
  const envJson = readFileUtf8(filePath);
  const envObj = JSON.parse(envJson);
  patchFn(envObj);
  writeFileAtomic(filePath, JSON.stringify(envObj, null, 2));
}

async function unpackEnvelopeFromFile(receiverAgent, receiverDid, filePath) {
  const envelopeJson = readFileUtf8(filePath);
  return receiverAgent.envelopeUnpackAuto(receiverDid, envelopeJson);
}

async function expectUnpackFail(receiverAgent, receiverDid, filePath, regex, label) {
  try {
    const plaintext = await unpackEnvelopeFromFile(receiverAgent, receiverDid, filePath);
    console.error(`❌ FALHA (${label}): esperado erro, mas retornou:`, plaintext);
    process.exit(1);
  } catch (e) {
    const msg = e?.message || String(e);
    console.log(`✅ OK (${label}): falhou como esperado.`);
    console.log("Mensagem de erro:", msg);
    if (!regex.test(msg)) {
      console.error(`❌ (${label}) Erro inesperado (regex não bate).`);
      process.exit(1);
    }
  }
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

  const exchangeDir = path.join(__dirname, "exchange_env_neg_04_empty_kind_thread");
  fs.mkdirSync(exchangeDir, { recursive: true });

  // Wallets (reset)
  const issuerWalletPath = path.join(walletsDir, "issuer_env_neg_04_empty_kind_thread.db");
  const holderWalletPath = path.join(walletsDir, "holder_env_neg_04_empty_kind_thread.db");
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

    console.log("7) Criando envelope válido base...");
    const baseFile = pExchange(exchangeDir, "base_valid.env.json");
    await packValidEnvelopeToFile(
      issuer,
      issuerDid,
      holderVerkey,
      "mensagem-para-testar-kind-thread-vazio",
      baseFile
    );

    // Caso A: kind vazio
    console.log('8) Corrompendo: kind="   "...');
    const kindFile = pExchange(exchangeDir, "caseA_kind_empty.env.json");
    writeFileAtomic(kindFile, readFileUtf8(baseFile));
    corruptEnvelopeFieldsInFile(kindFile, (o) => { o.kind = "   "; });

    console.log("9) Holder tentando unpack do Caso A (DEVE falhar)...");
    await expectUnpackFail(
      holder,
      holderDid,
      kindFile,
      /Envelope:\s*kind vazio/i,
      "kind vazio"
    );

    // Caso B: thread_id vazio
    console.log('10) Corrompendo: thread_id="   "...');
    const threadFile = pExchange(exchangeDir, "caseB_thread_empty.env.json");
    writeFileAtomic(threadFile, readFileUtf8(baseFile));
    corruptEnvelopeFieldsInFile(threadFile, (o) => { o.thread_id = "   "; });

    console.log("11) Holder tentando unpack do Caso B (DEVE falhar)...");
    await expectUnpackFail(
      holder,
      holderDid,
      threadFile,
      /Envelope:\s*thread_id vazio/i,
      "thread_id vazio"
    );

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
