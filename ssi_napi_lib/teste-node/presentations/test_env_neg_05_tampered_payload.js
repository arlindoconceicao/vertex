/*
PARA RODAR ESTE TESTE:
TRUSTEE_SEED="000000000000000000000000Trustee1" \
TRUSTEE_DID="V4SGRU86Z58d6TV7PBUe6f" \
WALLET_PASS="minha_senha_teste" GENESIS_FILE=./genesis.txn \
node teste-node/presentations/test_env_neg_05_tampered_payload.js

O QUE ESTE TESTE FAZ (PAYLOAD ADULTERADO):
- Cria wallets + conecta no ledger
- Cria DID do issuer e DID do holder e registra no ledger
- Issuer cria um envelope authcrypt válido e grava em arquivo
- O teste adultera o payload interno (payload.ciphertext), alterando 1 byte do
  "ciphertext" base64 do pacote interno (sem tocar no resto do envelope)
- Holder tenta abrir via envelopeUnpackAuto e DEVE falhar com erro de decifra (AEAD)
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
    "neg_test_tampered_payload",
    null,
    plaintext,
    null,
    JSON.stringify({ test: "tampered_payload" })
  );
  writeFileAtomic(filePath, envelopeJson);
}

function tamperAuthcryptInnerCiphertextInFile(filePath) {
  // Estrutura:
  // envelope.payload.ciphertext = JSON-string do pkg interno:
  // { ciphertext: base64(ct), nonce: base64(nonce), sender_verkey, target_verkey }
  const envJson = readFileUtf8(filePath);
  const envObj = JSON.parse(envJson);

  if (!envObj.payload || typeof envObj.payload.ciphertext !== "string") {
    throw new Error("Envelope sem payload.ciphertext string.");
  }

  const pkgStr = envObj.payload.ciphertext;
  const pkg = JSON.parse(pkgStr);

  if (!pkg.ciphertext || typeof pkg.ciphertext !== "string") {
    throw new Error("Pacote interno sem ciphertext base64.");
  }

  // Adultera 1 char base64 (mantém string válida, mas muda bytes do ct)
  const ctB64 = pkg.ciphertext;
  if (ctB64.length < 8) throw new Error("ciphertext base64 muito curto.");

  const idx = Math.floor(ctB64.length / 2);
  const orig = ctB64[idx];

  // troca por um char diferente dentro do alfabeto base64
  const alt = orig === "A" ? "B" : "A";
  pkg.ciphertext = ctB64.slice(0, idx) + alt + ctB64.slice(idx + 1);

  envObj.payload.ciphertext = JSON.stringify(pkg);

  // marca meta para facilitar debug (opcional)
  envObj.meta = Object.assign({}, envObj.meta || {}, {
    tampered: true,
    tampered_field: "payload.ciphertext(pkg.ciphertext)",
    tampered_idx: idx,
    orig_char: orig,
    new_char: alt
  });

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

  const exchangeDir = path.join(__dirname, "exchange_env_neg_05_tampered_payload");
  fs.mkdirSync(exchangeDir, { recursive: true });

  const issuerWalletPath = path.join(walletsDir, "issuer_env_neg_05_tampered_payload.db");
  const holderWalletPath = path.join(walletsDir, "holder_env_neg_05_tampered_payload.db");
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
    const envFile = pExchange(exchangeDir, "tampered_payload_01.env.json");
    await packValidEnvelopeToFile(
      issuer,
      issuerDid,
      holderVerkey,
      "mensagem-original-nao-deveria-ser-lida",
      envFile
    );

    console.log("8) Adulterando payload.ciphertext (ciphertext interno base64)...");
    tamperAuthcryptInnerCiphertextInFile(envFile);

    console.log("9) Holder tentando desempacotar via envelopeUnpackAuto (DEVE falhar)...");
    try {
      const plaintext = await unpackEnvelopeFromFile(holder, holderDid, envFile);
      console.error("❌ FALHA: era esperado erro de decifra (payload adulterado), mas retornou:", plaintext);
      process.exit(1);
    } catch (e) {
      const msg = e?.message || String(e);
      console.log("✅ OK: falhou como esperado.");
      console.log("Mensagem de erro:", msg);

      // Aceita família de erro de decifra/AEAD/crypto_box_open
      if (!/AEAD|Decifra|crypto_box_open|decryption|open/i.test(msg)) {
        console.error("❌ Erro não parece ser de decifra/AEAD. Ajuste regex.");
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
