// teste-node/message/test_message_02_tamper.js
//
// TESTE MESSAGE 02 — tamper tests (ciphertext / nonce / sender_verkey) OFFLINE
//
// Executar:
//   WALLET_PASS="minha_senha_teste" RESET_WALLET=1 node teste-node/message/test_message_02_tamper.js
//
// O fluxo:
// 1) cria/abre wallet do sender e do receiver (offline)
// 2) cria DID do sender e DID do receiver
// 3) sender cifra mensagem
// 4) receiver tenta decifrar com:
//    4.1) ciphertext adulterado => deve falhar
//    4.2) nonce adulterado      => deve falhar
//    4.3) sender_verkey errado  => deve falhar
//
// Observação:
// - decryptMessage deve lançar erro N-API (promise rejeitada). Aqui tratamos como "passou".

/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");

// ✅ index.node na raiz
const { IndyAgent } = require(path.join(__dirname, "..", "..", "index.node"));

function rmIfExists(walletDbPath) {
  const sidecar = `${walletDbPath}.kdf.json`;

  try { fs.unlinkSync(walletDbPath); } catch (_) {}
  try { fs.unlinkSync(sidecar); } catch (_) {}
  try { fs.unlinkSync(`${sidecar}.tmp`); } catch (_) {}

  try { fs.unlinkSync(`${walletDbPath}-shm`); } catch (_) {}
  try { fs.unlinkSync(`${walletDbPath}-wal`); } catch (_) {}
}

function safeJsonParse(s) {
  try { return JSON.parse(s); } catch (_) { return null; }
}

function flipOneBitInBuffer(buf) {
  if (!Buffer.isBuffer(buf) || buf.length === 0) throw new Error("Buffer inválido para flip.");
  const out = Buffer.from(buf);
  const i = Math.floor(out.length / 2);
  out[i] = out[i] ^ 0x01; // flip 1 bit
  return out;
}

function tamperBase64(b64) {
  const buf = Buffer.from(b64, "base64");
  const tampered = flipOneBitInBuffer(buf);
  return tampered.toString("base64");
}

async function expectDecryptFail(label, fn) {
  try {
    await fn();
    throw new Error(`❌ ERA PARA FALHAR: ${label} (decryptMessage NÃO falhou)`);
  } catch (e) {
    // Passou se falhou (rejeitou)
    console.log(`✅ OK: falhou como esperado (${label})`);
    // Log curto (útil p/ debug sem poluir)
    const msg = e?.message || String(e);
    console.log(`   ↳ erro: ${msg.slice(0, 180)}`);
  }
}

(async () => {
  const WALLET_PASS = process.env.WALLET_PASS || "minha_senha_teste";
  const RESET_WALLET = String(process.env.RESET_WALLET || "0") === "1";

  const walletsDir = path.join(__dirname, "..", "wallets");
  fs.mkdirSync(walletsDir, { recursive: true });

  const senderWalletPath = path.join(walletsDir, "msg_sender_02.db");
  const receiverWalletPath = path.join(walletsDir, "msg_receiver_02.db");

  console.log("🚀 TESTE MESSAGE 02: tamper (offline)");
  console.log("Config:", {
    senderWalletPath,
    receiverWalletPath,
    RESET_WALLET,
    WALLET_PASS: "***",
  });

  if (RESET_WALLET) {
    console.log("🧹 RESET_WALLET=1: removendo wallet artifacts...");
    rmIfExists(senderWalletPath);
    rmIfExists(receiverWalletPath);
  }

  const sender = new IndyAgent();
  const receiver = new IndyAgent();

  try {
    // -------------------------
    // Wallets
    // -------------------------
    console.log("1) Criando wallets...");
    await sender.walletCreate(senderWalletPath, WALLET_PASS);
    await receiver.walletCreate(receiverWalletPath, WALLET_PASS);
    console.log("✅ Wallets criadas.");

    console.log("2) Abrindo wallets...");
    await sender.walletOpen(senderWalletPath, WALLET_PASS);
    await receiver.walletOpen(receiverWalletPath, WALLET_PASS);
    console.log("✅ Wallets abertas.");

    // -------------------------
    // DIDs locais (offline)
    // -------------------------
    console.log("3) Criando DID do sender...");
    const [senderDid, senderVerkey] = await sender.createOwnDid();
    console.log("✅ Sender:", { senderDid, senderVerkey });

    console.log("4) Criando DID do receiver...");
    const [receiverDid, receiverVerkey] = await receiver.createOwnDid();
    console.log("✅ Receiver:", { receiverDid, receiverVerkey });

    // -------------------------
    // Encrypt
    // -------------------------
    console.log("5) Sender cifrando mensagem...");
    const message = `MSG tamper test ${Date.now()} ✅`;

    const encryptedJsonStr = await sender.encryptMessage(
      senderDid,
      receiverVerkey,
      message
    );

    const pkg = safeJsonParse(encryptedJsonStr);
    if (!pkg) throw new Error(`encryptMessage não retornou JSON válido: ${String(encryptedJsonStr).slice(0, 250)}...`);

    if (!pkg.ciphertext || !pkg.nonce) throw new Error("Pacote cifrado inválido: ciphertext/nonce ausente.");

    console.log("✅ Pacote cifrado gerado.");

    // -------------------------
    // 6) TAMPER: ciphertext
    // -------------------------
    console.log("6) Tamper ciphertext (esperado: falhar)...");
    const tamperedCipherPkg = {
      ...pkg,
      ciphertext: tamperBase64(pkg.ciphertext),
    };
    const tamperedCipherStr = JSON.stringify(tamperedCipherPkg);

    await expectDecryptFail("ciphertext adulterado", async () => {
      await receiver.decryptMessage(receiverDid, senderVerkey, tamperedCipherStr);
    });

    // -------------------------
    // 7) TAMPER: nonce
    // -------------------------
    console.log("7) Tamper nonce (esperado: falhar)...");
    const tamperedNoncePkg = {
      ...pkg,
      nonce: tamperBase64(pkg.nonce),
    };
    const tamperedNonceStr = JSON.stringify(tamperedNoncePkg);

    await expectDecryptFail("nonce adulterado", async () => {
      await receiver.decryptMessage(receiverDid, senderVerkey, tamperedNonceStr);
    });

    // -------------------------
    // 8) TAMPER: sender verkey (passar verkey errada)
    // -------------------------
    console.log("8) Sender verkey errada (esperado: falhar)...");
    // Gera um DID extra só para obter uma verkey diferente (em outra wallet, não importa)
    const [fakeDid, fakeVerkey] = await sender.createOwnDid();
    if (!fakeDid || !fakeVerkey) throw new Error("Falha ao gerar verkey falsa.");

    await expectDecryptFail("sender_verkey errado", async () => {
      await receiver.decryptMessage(receiverDid, fakeVerkey, encryptedJsonStr);
    });

    console.log("✅ OK: TESTE MESSAGE 02 passou.");
  } finally {
    try { console.log("🔒 Fechando wallet sender..."); await sender.walletClose(); } catch (_) {}
    try { console.log("🔒 Fechando wallet receiver..."); await receiver.walletClose(); } catch (_) {}
  }
})().catch((e) => {
  console.error("❌ FALHA TESTE MESSAGE 02:", e?.message || e);
  console.error(e?.stack || "");
  process.exit(1);
});
