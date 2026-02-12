/*
PARA RODAR ESTE TESTE:
TRUSTEE_SEED="000000000000000000000000Trustee1" \
TRUSTEE_DID="V4SGRU86Z58d6TV7PBUe6f" \
WALLET_PASS="minha_senha_teste" GENESIS_FILE=./genesis.txn \
node teste-node/credentials/test_reject_credential_offer_strict_files.js

O QUE ESTE TESTE FAZ (REJEIÇÃO STRICT FILE EXCHANGE):
- Cria DIDs do issuer e do holder via createOwnDid()
- Registra ambos no ledger via Trustee
- Issuer cria Schema + CredDef (CPF) e gera um Credential Offer
- Offer é enviado apenas por ARQUIVO cifrado (authcrypt)
- Holder decripta o Offer e REJEITA (não cria request)
- Holder envia um "reject receipt" por arquivo cifrado para o issuer
- Valida que holder NÃO armazenou credencial (total=0)
- Valida que issuer recebeu o receipt de rejeição

IMPORTANTE:
- Tudo sensível trafega por arquivo cifrado.
- Exceção: arquivos públicos de bootstrap (did, verkey).
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

function writeJson(filePath, obj) {
  writeFileAtomic(filePath, JSON.stringify(obj, null, 2));
}

function readJson(filePath) {
  return JSON.parse(readFileUtf8(filePath));
}

// -------------------------
// Crypto file exchange (AuthCrypt)
// -------------------------
async function encryptToFile(senderAgent, senderDid, recipientVerkey, plaintext, filePath) {
  const encryptedJson = await senderAgent.encryptMessage(senderDid, recipientVerkey, plaintext);
  writeFileAtomic(filePath, encryptedJson);
}

async function decryptFromFile(receiverAgent, receiverDid, senderVerkey, filePath) {
  const encryptedJson = readFileUtf8(filePath);
  const plaintext = await receiverAgent.decryptMessage(receiverDid, senderVerkey, encryptedJson);
  return plaintext;
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
// Paths
// -------------------------
function pExchange(exchangeDir, name) {
  return path.join(exchangeDir, name);
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

  const exchangeDir = path.join(__dirname, "exchange_reject_offer_strict_files");
  fs.mkdirSync(exchangeDir, { recursive: true });

  const issuerWalletPath = path.join(walletsDir, "issuer_reject_offer.db");
  const holderWalletPath = path.join(walletsDir, "holder_reject_offer.db");
  rmIfExists(issuerWalletPath);
  rmIfExists(holderWalletPath);

  const issuer = new IndyAgent();
  const holder = new IndyAgent();

  const issuerPubFile = pExchange(exchangeDir, "pub_issuer.json");
  const holderPubFile = pExchange(exchangeDir, "pub_holder.json");
  const ledgerIdsFile = pExchange(exchangeDir, "ledger_ids.json");

  try {
    // Setup
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

    console.log("5) Criando DIDs (createOwnDid)...");
    const [issuerDid, issuerVerkey] = await issuer.createOwnDid();
    const [holderDid, holderVerkey] = await holder.createOwnDid();
    writeJson(issuerPubFile, { did: issuerDid, verkey: issuerVerkey });
    writeJson(holderPubFile, { did: holderDid, verkey: holderVerkey });

    console.log("6) Registrando DIDs no ledger (NYM) via Trustee...");
    await tryRegisterDid(issuer, GENESIS_FILE, TRUSTEE_DID, issuerDid, issuerVerkey, "ENDORSER");
    await tryRegisterDid(issuer, GENESIS_FILE, TRUSTEE_DID, holderDid, holderVerkey, null);

    console.log("7) Issuer criando Schema + CredDef (CPF)...");
    const schemaCpfId = await issuer.createAndRegisterSchema(
      GENESIS_FILE,
      issuerDid,
      "cpf",
      `1.0.${Date.now()}`,
      ["nome", "cpf", "idade"]
    );

    const credDefCpfId = await issuer.createAndRegisterCredDef(
      GENESIS_FILE,
      issuerDid,
      schemaCpfId,
      `TAG_CPF_${Date.now()}`
    );

    writeJson(ledgerIdsFile, { schemaCpfId, credDefCpfId });

    console.log("8) Garantindo Link Secret no holder...");
    try { await holder.createLinkSecret("default"); } catch (_) {}

    // Check inicial: holder sem credenciais
    console.log("\n9) Holder listCredentialsView('compact') (esperado 0)...");
    const before = JSON.parse(await holder.listCredentialsView("compact"));
    if (before.length !== 0) {
      throw new Error(`Holder deveria iniciar com 0 credenciais, mas tem ${before.length}`);
    }
    console.log("✅ OK: holder inicia vazio.");

    // Issuer cria offer e manda por arquivo cifrado
    console.log("\n10) Issuer criando Offer CPF e gravando (cifrado)...");
    const offerId = `offer-cpf-reject-${Date.now()}`;
    const offerJson = await issuer.createCredentialOffer(credDefCpfId, offerId);

    const issuerPub = readJson(issuerPubFile);
    const holderPub = readJson(holderPubFile);

    const offerFile = pExchange(exchangeDir, "cpf_01_offer.enc.json");
    await encryptToFile(issuer, issuerPub.did, holderPub.verkey, offerJson, offerFile);

    // Holder decripta e REJEITA (não cria request)
    console.log("\n11) Holder lendo Offer (cifrado) e REJEITANDO (sem request)...");
    const offerPlain = await decryptFromFile(holder, holderPub.did, issuerPub.verkey, offerFile);

    const offerObj = JSON.parse(offerPlain);
    if (!offerObj?.nonce) throw new Error("Offer inválido: sem nonce.");
    if (!offerObj?.cred_def_id) throw new Error("Offer inválido: sem cred_def_id.");
    console.log("✅ Offer válido. Holder decidiu rejeitar.");

    // Envia um receipt de rejeição cifrado para o issuer (opcional mas útil)
    console.log("\n12) Holder enviando receipt de rejeição (cifrado)...");
    const rejectReceipt = JSON.stringify({
      ok: true,
      step: "rejectOffer",
      reason: "Usuário rejeitou a oferta (teste)",
      offer_id: offerId,
      cred_def_id: offerObj.cred_def_id,
      nonce: offerObj.nonce,
      ts: Date.now()
    });

    const rejectFile = pExchange(exchangeDir, "cpf_02_reject_receipt.enc.json");
    await encryptToFile(holder, holderPub.did, issuerPub.verkey, rejectReceipt, rejectFile);

    // Issuer lê receipt
    console.log("\n13) Issuer lendo receipt de rejeição (cifrado)...");
    const rejectPlain = await decryptFromFile(issuer, issuerPub.did, holderPub.verkey, rejectFile);
    const r = JSON.parse(rejectPlain);
    if (!r?.ok || r?.step !== "rejectOffer") throw new Error("Receipt de rejeição inválido.");
    console.log("✅ OK: issuer recebeu rejeição.");

    // Valida que holder NÃO armazenou nada
    console.log("\n14) Holder listCredentialsView('compact') após rejeição (esperado 0)...");
    const after = JSON.parse(await holder.listCredentialsView("compact"));
    if (after.length !== 0) {
      console.log("DEBUG itens:", after);
      throw new Error(`Holder NÃO deveria ter credenciais, mas tem ${after.length}`);
    }
    console.log("✅ OK: holder continua sem credenciais (rejeição efetiva).");

    console.log(`\n📁 Arquivos gerados em: ${exchangeDir}`);
    console.log("\n✅ OK: fluxo de REJEIÇÃO (sem request) funcionando.");
  } finally {
    try { await issuer.walletClose(); } catch (_) {}
    try { await holder.walletClose(); } catch (_) {}
  }
})().catch((e) => {
  console.error("❌ FALHA NO TESTE:", e?.message || e);
  console.error(e?.stack || "");
  process.exit(1);
});
