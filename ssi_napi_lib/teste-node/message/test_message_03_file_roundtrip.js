// teste-node/message/test_message_03_file_roundtrip.js
//
// TESTE MESSAGE 03 — file roundtrip (encrypt -> salvar JSON -> ler JSON -> decrypt) OFFLINE
//
// Executar:
//   WALLET_PASS="minha_senha_teste" RESET_WALLET=1 node teste-node/message/test_message_03_file_roundtrip.js
//
// O fluxo:
// 1) cria/abre wallet do sender e do receiver (offline)
// 2) cria DID do sender e DID do receiver
// 3) sender cifra mensagem -> obtém encrypted_json (string JSON)
// 4) salva encrypted_json em arquivo no disco (teste-node/message/out/)
// 5) lê o arquivo do disco e decifra no receiver
// 6) assert plaintext == mensagem original
//
// Observação:
// - Este teste simula transporte via arquivo, garantindo que o pacote JSON é suficiente.

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

function atomicWriteFile(filePath, content) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });

  const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, content, { encoding: "utf8" });
  fs.renameSync(tmp, filePath);
}

(async () => {
  const WALLET_PASS = process.env.WALLET_PASS || "minha_senha_teste";
  const RESET_WALLET = String(process.env.RESET_WALLET || "0") === "1";

  const walletsDir = path.join(__dirname, "..", "wallets");
  fs.mkdirSync(walletsDir, { recursive: true });

  const senderWalletPath = path.join(walletsDir, "msg_sender_03.db");
  const receiverWalletPath = path.join(walletsDir, "msg_receiver_03.db");

  const outDir = path.join(__dirname, "out");
  const outFile = path.join(outDir, `encrypted_pkg_${Date.now()}.json`);

  console.log("🚀 TESTE MESSAGE 03: file roundtrip (offline)");
  console.log("Config:", {
    senderWalletPath,
    receiverWalletPath,
    outFile,
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
    const message = `Roundtrip file ✅ ${Date.now()} — Olá SSI`;

    const encryptedJsonStr = await sender.encryptMessage(
      senderDid,
      receiverVerkey,
      message
    );

    const pkg = safeJsonParse(encryptedJsonStr);
    if (!pkg) {
      throw new Error(`encryptMessage não retornou JSON válido: ${String(encryptedJsonStr).slice(0, 250)}...`);
    }
    if (!pkg.ciphertext || !pkg.nonce) {
      throw new Error("Pacote cifrado inválido: ciphertext/nonce ausente.");
    }

    console.log("✅ Pacote cifrado gerado. Salvando em disco...");

    // -------------------------
    // Save to disk
    // -------------------------
    atomicWriteFile(outFile, encryptedJsonStr);

    const stat = fs.statSync(outFile);
    if (!stat.isFile() || stat.size <= 0) throw new Error("Falha ao salvar arquivo: tamanho inválido.");

    console.log("💾 Arquivo salvo:", { path: outFile, bytes: stat.size });

    // -------------------------
    // Read from disk
    // -------------------------
    console.log("6) Lendo arquivo do disco...");
    const readStr = fs.readFileSync(outFile, "utf8");
    const readPkg = safeJsonParse(readStr);
    if (!readPkg) throw new Error("Arquivo lido não contém JSON válido.");
    if (!readPkg.ciphertext || !readPkg.nonce) throw new Error("Arquivo lido: pacote inválido (ciphertext/nonce ausente).");

    console.log("✅ Arquivo lido e parseado.");

    // -------------------------
    // Decrypt
    // -------------------------
    console.log("7) Receiver decifrando do arquivo...");
    const plaintext = await receiver.decryptMessage(
      receiverDid,
      senderVerkey,
      readStr
    );

    console.log("📥 Plaintext:", plaintext);

    if (String(plaintext) !== String(message)) {
      throw new Error(`❌ plaintext diferente. esperado="${message}" obtido="${plaintext}"`);
    }

    console.log("✅ OK: roundtrip por arquivo funcionou (plaintext confere).");
    console.log("✅ OK: TESTE MESSAGE 03 passou.");
  } finally {
    try { console.log("🔒 Fechando wallet sender..."); await sender.walletClose(); } catch (_) {}
    try { console.log("🔒 Fechando wallet receiver..."); await receiver.walletClose(); } catch (_) {}
  }
})().catch((e) => {
  console.error("❌ FALHA TESTE MESSAGE 03:", e?.message || e);
  console.error(e?.stack || "");
  process.exit(1);
});
