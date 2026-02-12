/*
PARA RODAR ESTE TESTE:
TRUSTEE_SEED="000000000000000000000000Trustee1" \
TRUSTEE_DID="V4SGRU86Z58d6TV7PBUe6f" \
WALLET_PASS="minha_senha_teste" GENESIS_FILE=./genesis.txn \
node teste-node/presentations/test_env_neg_02_recipient_mismatch.js

O QUE ESTE TESTE FAZ (RECIPIENT MISMATCH):
- Cria 3 agentes/wallets: issuer, holderA (destinatário real), holderB (destinatário
  errado).
- Issuer empacota um envelope authcrypt destinado ao holderA (recipient_verkey=A).
- holderB tenta desempacotar usando receiver_did=B e DEVE falhar.
- O erro esperado é de "mismatch" (recipient_verkey não corresponde ao receiver DID)
  OU falha de decifra (porque a chave privada não bate). Aceitamos ambos.
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
async function packEnvelopeToFile(senderAgent, senderDid, recipientVerkey, plaintext, filePath) {
    const envelopeJson = await senderAgent.envelopePackAuthcrypt(
        senderDid,
        recipientVerkey,
        "neg_test_recipient_mismatch",
        null,
        plaintext,
        null,
        JSON.stringify({ test: "recipient_mismatch" })
    );
    writeFileAtomic(filePath, envelopeJson);
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

    const exchangeDir = path.join(__dirname, "exchange_env_neg_02_recipient_mismatch");
    fs.mkdirSync(exchangeDir, { recursive: true });

    // Wallets (reset)
    const issuerWalletPath = path.join(walletsDir, "issuer_env_neg_02_recipient_mismatch.db");
    const holderAWalletPath = path.join(walletsDir, "holderA_env_neg_02_recipient_mismatch.db");
    const holderBWalletPath = path.join(walletsDir, "holderB_env_neg_02_recipient_mismatch.db");
    rmIfExists(issuerWalletPath);
    rmIfExists(holderAWalletPath);
    rmIfExists(holderBWalletPath);

    const issuer = new IndyAgent();
    const holderA = new IndyAgent();
    const holderB = new IndyAgent();

    try {
        console.log("1) Criando wallets (issuer/holderA/holderB)...");
        await issuer.walletCreate(issuerWalletPath, WALLET_PASS);
        await holderA.walletCreate(holderAWalletPath, WALLET_PASS);
        await holderB.walletCreate(holderBWalletPath, WALLET_PASS);

        console.log("2) Abrindo wallets...");
        await issuer.walletOpen(issuerWalletPath, WALLET_PASS);
        await holderA.walletOpen(holderAWalletPath, WALLET_PASS);
        await holderB.walletOpen(holderBWalletPath, WALLET_PASS);

        console.log("3) Conectando na rede...");
        await issuer.connectNetwork(GENESIS_FILE);
        await holderA.connectNetwork(GENESIS_FILE);
        await holderB.connectNetwork(GENESIS_FILE);

        console.log("4) Importando Trustee DID no issuer...");
        await issuer.importDidFromSeed(TRUSTEE_SEED);

        console.log("5) Criando DIDs (issuer/holderA/holderB)...");
        const [issuerDid, issuerVerkey] = await issuer.createOwnDid();
        const [holderADid, holderAVerkey] = await holderA.createOwnDid();
        const [holderBDid, holderBVerkey] = await holderB.createOwnDid();

        console.log("6) Registrando DIDs no ledger...");
        await tryRegisterDid(issuer, GENESIS_FILE, TRUSTEE_DID, issuerDid, issuerVerkey, "ENDORSER");
        await tryRegisterDid(issuer, GENESIS_FILE, TRUSTEE_DID, holderADid, holderAVerkey, null);
        await tryRegisterDid(issuer, GENESIS_FILE, TRUSTEE_DID, holderBDid, holderBVerkey, null);

        console.log("7) Issuer criando envelope destinado ao holderA e gravando em arquivo...");
        const envFile = pExchange(exchangeDir, "recipient_mismatch_01.env.json");
        await packEnvelopeToFile(
            issuer,
            issuerDid,
            holderAVerkey, // destinatário REAL
            "mensagem-para-holderA",
            envFile
        );

        console.log("8) HolderB tentando desempacotar (DEVE falhar)...");
        try {
            const plaintext = await unpackEnvelopeFromFile(holderB, holderBDid, envFile);
            console.error("❌ FALHA: era esperado erro de recipient mismatch, mas retornou:", plaintext);
            process.exit(1);
        } catch (e) {
            const msg = e?.message || String(e);
            console.log("✅ OK: falhou como esperado.");
            console.log("Mensagem de erro:", msg);

            if (!/recipient_verkey.*não corresponde/i.test(msg)) {
                console.error("❌ Erro não é de recipient mismatch. Ajuste a mensagem/regex.");
                process.exit(1);
            }
        }

        console.log(`📁 Arquivos gerados em: ${exchangeDir}`);
    } finally {
        try { await issuer.walletClose(); } catch (_) { }
        try { await holderA.walletClose(); } catch (_) { }
        try { await holderB.walletClose(); } catch (_) { }
    }
})().catch((e) => {
    console.error("FALHA NO TESTE:", e?.message || e);
    console.error(e?.stack || "");
    process.exit(1);
});
