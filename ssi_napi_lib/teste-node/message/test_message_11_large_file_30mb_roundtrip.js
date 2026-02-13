// teste-node/message/test_message_20_large_file_30mb_roundtrip.js
//
// TESTE MESSAGE 20 — LARGE FILE (30MB) roundtrip (encryptFileLarge/decryptFileLarge) OFFLINE
//
// Executar:
//   WALLET_PASS="minha_senha_teste" RESET_WALLET=1 node teste-node/message/test_message_11_large_file_30mb_roundtrip.js
//
// O fluxo:
// 1) cria/abre wallet do sender e do receiver (offline)
// 2) cria DID do sender e DID do receiver
// 3) gera arquivo grande (30MB) em disco (sem manter em RAM)
// 4) sender cifra arquivo grande (encryptFileLarge) -> pacote cifrado binário
// 5) receiver decifra (decryptFileLarge) -> arquivo restaurado
// 6) compara SHA-256 do original vs restaurado (sem carregar tudo na RAM)
//
// Requisitos:
// - métodos N-API:
//    - walletCreate / walletOpen / walletClose
//    - createOwnDid
//    - encryptFileLarge(senderDid, receiverVerkey, inPath, outPkgPath[, chunkSize])
//    - decryptFileLarge(receiverDid, senderVerkey, inPkgPath, outPlainPath)

 /* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

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

function safeUnlink(p) {
  try { fs.unlinkSync(p); } catch (_) {}
}

function fileExistsNonEmpty(p) {
  try {
    const st = fs.statSync(p);
    return st.isFile() && st.size > 0;
  } catch (_) {
    return false;
  }
}

function sha256File(p) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash("sha256");
    const s = fs.createReadStream(p);
    s.on("data", (chunk) => h.update(chunk));
    s.on("error", reject);
    s.on("end", () => resolve(h.digest("hex")));
  });
}

function generateLargeFile(p, totalBytes, blockBytes = 1024 * 1024) {
  // Gera arquivo grande sem manter tudo em RAM:
  // escreve blocos pseudo-randômicos (crypto.randomBytes por bloco).
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const out = fs.createWriteStream(p);

    let written = 0;

    out.on("error", reject);
    out.on("finish", () => resolve(written));

    function writeMore() {
      while (written < totalBytes) {
        const remaining = totalBytes - written;
        const n = Math.min(blockBytes, remaining);

        // bloco randômico
        const buf = crypto.randomBytes(n);
        written += n;

        if (!out.write(buf)) {
          out.once("drain", writeMore);
          return;
        }
      }
      out.end();
    }

    writeMore();
  });
}

(async () => {
  const WALLET_PASS = process.env.WALLET_PASS || "minha_senha_teste";
  const RESET_WALLET = String(process.env.RESET_WALLET || "0") === "1";

  const walletsDir = path.join(__dirname, "..", "wallets");
  fs.mkdirSync(walletsDir, { recursive: true });

  const senderWalletPath = path.join(walletsDir, "msg_sender_11.db");
  const receiverWalletPath = path.join(walletsDir, "msg_receiver_11.db");

  const outDir = path.join(__dirname, "out");
  fs.mkdirSync(outDir, { recursive: true });

  const ts = Date.now();
  const originalFile = path.join(outDir, `large_original_${ts}.bin`);
  const encryptedPkgFile = path.join(outDir, `large_encrypted_${ts}.ssifile2`);
  const decryptedFile = path.join(outDir, `large_decrypted_${ts}.bin`);

  // 30 MB
  const TOTAL_BYTES = 30 * 1024 * 1024;

  // chunkSize recomendado p/ teste: 1MB (ajuste se quiser)
  const CHUNK_SIZE = 1024 * 1024;

  console.log("🚀 TESTE MESSAGE 11: LARGE FILE 30MB roundtrip (offline)");
  console.log("Config:", {
    senderWalletPath,
    receiverWalletPath,
    originalFile,
    encryptedPkgFile,
    decryptedFile,
    TOTAL_BYTES,
    CHUNK_SIZE,
    RESET_WALLET,
    WALLET_PASS: "***",
  });

  if (RESET_WALLET) {
    console.log("🧹 RESET_WALLET=1: removendo wallet artifacts...");
    rmIfExists(senderWalletPath);
    rmIfExists(receiverWalletPath);
  }

  // limpeza defensiva
  safeUnlink(originalFile);
  safeUnlink(encryptedPkgFile);
  safeUnlink(decryptedFile);

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
    // Gerar arquivo grande
    // -------------------------
    console.log(`5) Gerando arquivo grande (${Math.round(TOTAL_BYTES / (1024 * 1024))}MB) em disco...`);
    const written = await generateLargeFile(originalFile, TOTAL_BYTES, 1024 * 1024);
    const stOrig = fs.statSync(originalFile);
    if (!stOrig.isFile() || stOrig.size !== TOTAL_BYTES) {
      throw new Error(`Arquivo original inválido: size=${stOrig.size} esperado=${TOTAL_BYTES}`);
    }
    console.log("💾 Arquivo original gerado:", { path: originalFile, bytes: written });

    // Hash original (stream)
    console.log("6) Calculando SHA-256 do original...");
    const h1 = await sha256File(originalFile);
    console.log("🔎 SHA-256 original:", h1);

    // -------------------------
    // Encrypt large
    // -------------------------
    console.log("7) Sender cifrando ARQUIVO GRANDE (encryptFileLarge)...");
    const encRespStr = await sender.encryptFileLarge(
      senderDid,
      receiverVerkey,
      originalFile,
      encryptedPkgFile,
      CHUNK_SIZE
    );

    try { console.log("✅ encryptFileLarge resp:", JSON.parse(encRespStr)); } catch (_) {
      console.log("✅ encryptFileLarge resp:", String(encRespStr).slice(0, 250));
    }

    if (!fileExistsNonEmpty(encryptedPkgFile)) {
      throw new Error("Pacote cifrado large não foi gerado (arquivo ausente ou vazio).");
    }
    console.log("💾 Pacote cifrado large salvo:", { path: encryptedPkgFile, bytes: fs.statSync(encryptedPkgFile).size });

    // -------------------------
    // Decrypt large
    // -------------------------
    console.log("8) Receiver decifrando ARQUIVO GRANDE (decryptFileLarge)...");
    const decRespStr = await receiver.decryptFileLarge(
      receiverDid,
      senderVerkey,
      encryptedPkgFile,
      decryptedFile
    );

    try { console.log("✅ decryptFileLarge resp:", JSON.parse(decRespStr)); } catch (_) {
      console.log("✅ decryptFileLarge resp:", String(decRespStr).slice(0, 250));
    }

    if (!fileExistsNonEmpty(decryptedFile)) {
      throw new Error("decryptFileLarge não gerou arquivo decrypted (ausente ou vazio).");
    }

    const stDec = fs.statSync(decryptedFile);
    if (!stDec.isFile() || stDec.size !== TOTAL_BYTES) {
      throw new Error(`Arquivo decifrado inválido: size=${stDec.size} esperado=${TOTAL_BYTES}`);
    }
    console.log("💾 Arquivo restaurado:", { path: decryptedFile, bytes: stDec.size });

    // Hash restaurado (stream)
    console.log("9) Calculando SHA-256 do restaurado...");
    const h2 = await sha256File(decryptedFile);
    console.log("🔎 SHA-256 restaurado:", h2);

    if (h1 !== h2) {
      throw new Error(`❌ Hash diferente! original=${h1} restaurado=${h2}`);
    }

    console.log("✅ OK: roundtrip LARGE (30MB) funcionou (SHA-256 confere).");
    console.log("✅ OK: TESTE MESSAGE 11 passou.");
  } finally {
    try { console.log("🔒 Fechando wallet sender..."); await sender.walletClose(); } catch (_) {}
    try { console.log("🔒 Fechando wallet receiver..."); await receiver.walletClose(); } catch (_) {}
  }
})().catch((e) => {
  console.error("❌ FALHA TESTE MESSAGE 11:", e?.message || e);
  console.error(e?.stack || "");
  process.exit(1);
});
