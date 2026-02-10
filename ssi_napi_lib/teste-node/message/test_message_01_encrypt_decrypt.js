// teste-node/message/test_message_01_encrypt_decrypt.js
//
// TESTE MESSAGE 01 — encrypt → decrypt (happy path) OFFLINE
//
// Executar:
//   WALLET_PASS="minha_senha_teste" RESET_WALLET=1 node teste-node/message/test_message_01_encrypt_decrypt.js
//
// O fluxo:
// 1) cria/abre wallet do sender e do receiver (offline)
// 2) cria DID do sender e DID do receiver
// 3) sender cifra mensagem usando receiver verkey (base58)
// 4) receiver decifra usando seu DID (pra achar chave privada) + sender verkey
// 5) assert plaintext == mensagem original

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

(async () => {
  const WALLET_PASS = process.env.WALLET_PASS || "minha_senha_teste";
  const RESET_WALLET = String(process.env.RESET_WALLET || "0") === "1";

  const walletsDir = path.join(__dirname, "..", "wallets");
  fs.mkdirSync(walletsDir, { recursive: true });

  const senderWalletPath = path.join(walletsDir, "msg_sender_01.db");
  const receiverWalletPath = path.join(walletsDir, "msg_receiver_01.db");

  console.log("🚀 TESTE MESSAGE 01: encrypt→decrypt (offline)");
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
    const message = `Olá SSI! ${Date.now()} — teste encrypt/decrypt ✅`;

    // JS binding camelCase: encryptMessage / decryptMessage
    const encryptedJsonStr = await sender.encryptMessage(
      senderDid,
      receiverVerkey, // target_verkey (base58)
      message
    );

    const pkg = safeJsonParse(encryptedJsonStr);
    if (!pkg) {
      throw new Error(`encryptMessage não retornou JSON válido: ${String(encryptedJsonStr).slice(0, 250)}...`);
    }

    // Sanidade do pacote
    if (!pkg.ciphertext || !pkg.nonce) throw new Error("Pacote cifrado inválido: ciphertext/nonce ausente.");
    if (pkg.sender_verkey && pkg.sender_verkey !== senderVerkey) {
      throw new Error(`sender_verkey divergente. esperado=${senderVerkey} obtido=${pkg.sender_verkey}`);
    }
    if (pkg.target_verkey && pkg.target_verkey !== receiverVerkey) {
      throw new Error(`target_verkey divergente. esperado=${receiverVerkey} obtido=${pkg.target_verkey}`);
    }

    console.log("✅ Pacote cifrado gerado:", {
      hasCiphertext: !!pkg.ciphertext,
      hasNonce: !!pkg.nonce,
      sender_verkey: pkg.sender_verkey,
      target_verkey: pkg.target_verkey,
    });

    // -------------------------
    // Decrypt
    // -------------------------
    console.log("6) Receiver decifrando mensagem...");
    const plaintext = await receiver.decryptMessage(
      receiverDid,     // receiver_did (pra achar chave privada)
      senderVerkey,    // sender_verkey (base58)
      encryptedJsonStr // pacote JSON string
    );

    console.log("📥 Plaintext:", plaintext);

    if (String(plaintext) !== String(message)) {
      throw new Error(`❌ plaintext diferente. esperado="${message}" obtido="${plaintext}"`);
    }

    console.log("✅ OK: plaintext confere com a mensagem original.");
    console.log("✅ OK: TESTE MESSAGE 01 passou.");
  } finally {
    try { console.log("🔒 Fechando wallet sender..."); await sender.walletClose(); } catch (_) {}
    try { console.log("🔒 Fechando wallet receiver..."); await receiver.walletClose(); } catch (_) {}
  }
})().catch((e) => {
  console.error("❌ FALHA TESTE MESSAGE 01:", e?.message || e);
  console.error(e?.stack || "");
  process.exit(1);
});
