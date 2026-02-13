// teste-node/message/test_message_16_large_file_wrong_receiver_did_must_fail.js
//
// TESTE MESSAGE 16 — NEGATIVO: usar receiver_did ERRADO no decryptFileLarge DEVE falhar
// Cenário: pacote foi cifrado para receiverVerkey REAL, mas o receiver tenta abrir usando um DID diferente
// (mesma wallet do receiver, mas DID "wrong", portanto chave privada usada não corresponde ao destinatário)
//
// Executar:
//   WALLET_PASS="minha_senha_teste" RESET_WALLET=1 node teste-node/message/test_message_16_large_file_wrong_receiver_did_must_fail.js
//
// O fluxo:
// 1) cria/abre wallet do sender e do receiver (offline)
// 2) cria DID do sender e DID do receiver (REAL)
// 3) cria DID extra no receiver (WRONG receiver DID)
// 4) gera arquivo grande (30MB)
// 5) encryptFileLarge -> pacote .ssifile2 para receiverVerkey REAL
// 6) decryptFileLarge usando receiverDid ERRADO -> DEVE FALHAR (AEAD falha/chunk)
// 7) garante que não ficou arquivo final e remove tmp leftovers
//
// Requisitos:
// - encryptFileLarge(senderDid, receiverVerkey, inPath, outPkgPath[, chunkSize])
// - decryptFileLarge(receiverDid, senderVerkey, inPkgPath, outPlainPath)

 /* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { IndyAgent } = require(path.join(__dirname, "..", "..", "index.node"));

function rmIfExists(walletDbPath) {
  const sidecar = `${walletDbPath}.kdf.json`;
  try { fs.unlinkSync(walletDbPath); } catch (_) {}
  try { fs.unlinkSync(sidecar); } catch (_) {}
  try { fs.unlinkSync(`${sidecar}.tmp`); } catch (_) {}
  try { fs.unlinkSync(`${walletDbPath}-shm`); } catch (_) {}
  try { fs.unlinkSync(`${walletDbPath}-wal`); } catch (_) {}
}

function safeUnlink(p) { try { fs.unlinkSync(p); } catch (_) {} }

function fileExistsNonEmpty(p) {
  try {
    const st = fs.statSync(p);
    return st.isFile() && st.size > 0;
  } catch (_) {
    return false;
  }
}

function generateLargeFile(p, totalBytes, blockBytes = 1024 * 1024) {
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

function cleanupTmpLeftovers(finalOutPath) {
  try {
    const dir = path.dirname(finalOutPath);
    const base = path.basename(finalOutPath);
    const entries = fs.readdirSync(dir);
    const leftovers = entries.filter((n) => n.startsWith(`${base}.tmp.`));
    leftovers.forEach((n) => safeUnlink(path.join(dir, n)));
    return leftovers;
  } catch (_) {
    return [];
  }
}

(async () => {
  const WALLET_PASS = process.env.WALLET_PASS || "minha_senha_teste";
  const RESET_WALLET = String(process.env.RESET_WALLET || "0") === "1";

  const walletsDir = path.join(__dirname, "..", "wallets");
  fs.mkdirSync(walletsDir, { recursive: true });

  const senderWalletPath = path.join(walletsDir, "msg_sender_16.db");
  const receiverWalletPath = path.join(walletsDir, "msg_receiver_16.db");

  const outDir = path.join(__dirname, "out");
  fs.mkdirSync(outDir, { recursive: true });

  const ts = Date.now();
  const originalFile = path.join(outDir, `large_original_${ts}.bin`);
  const encryptedPkgFile = path.join(outDir, `large_encrypted_${ts}.ssifile2`);
  const decryptedFile = path.join(outDir, `large_decrypted_${ts}.bin`);

  const TOTAL_BYTES = 30 * 1024 * 1024;
  const CHUNK_SIZE = 1024 * 1024;

  console.log("🚀 TESTE MESSAGE 16: NEGATIVO (wrong receiver DID must fail - large)");
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

  safeUnlink(originalFile);
  safeUnlink(encryptedPkgFile);
  safeUnlink(decryptedFile);

  const sender = new IndyAgent();
  const receiver = new IndyAgent();

  try {
    console.log("1) Criando wallets...");
    await sender.walletCreate(senderWalletPath, WALLET_PASS);
    await receiver.walletCreate(receiverWalletPath, WALLET_PASS);
    console.log("✅ Wallets criadas.");

    console.log("2) Abrindo wallets...");
    await sender.walletOpen(senderWalletPath, WALLET_PASS);
    await receiver.walletOpen(receiverWalletPath, WALLET_PASS);
    console.log("✅ Wallets abertas.");

    console.log("3) Criando DID do sender...");
    const [senderDid, senderVerkey] = await sender.createOwnDid();
    console.log("✅ Sender:", { senderDid, senderVerkey });

    console.log("4) Criando DID do receiver (REAL)...");
    const [receiverDid, receiverVerkey] = await receiver.createOwnDid();
    console.log("✅ Receiver REAL:", { receiverDid, receiverVerkey });

    console.log("4.1) Criando DID extra no receiver (WRONG receiver DID)...");
    const [wrongReceiverDid, wrongReceiverVerkey] = await receiver.createOwnDid();
    console.log("✅ Receiver WRONG:", { wrongReceiverDid, wrongReceiverVerkey });

    console.log("5) Gerando arquivo grande (30MB) em disco...");
    const written = await generateLargeFile(originalFile, TOTAL_BYTES, 1024 * 1024);
    const stOrig = fs.statSync(originalFile);
    if (!stOrig.isFile() || stOrig.size !== TOTAL_BYTES) {
      throw new Error(`Arquivo original inválido: size=${stOrig.size} esperado=${TOTAL_BYTES}`);
    }
    console.log("💾 Arquivo original gerado:", { path: originalFile, bytes: written });

    console.log("6) Sender cifrando ARQUIVO GRANDE (encryptFileLarge) para receiverVerkey REAL...");
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

    console.log("7) Receiver tentando decifrar com receiverDid ERRADO (deve falhar)...");
    let failed = false;
    try {
      await receiver.decryptFileLarge(
        wrongReceiverDid,       // <-- ERRADO
        senderVerkey,
        encryptedPkgFile,
        decryptedFile
      );
      failed = false;
    } catch (e) {
      failed = true;
      const msg = String(e?.message || e);
      console.log("✅ Falhou como esperado:", msg);

      // Mensagens prováveis:
      // - "AEAD decrypt failed (chunk)"
      // - "Crypto box AEAD decryption error"
      // - ou alguma mensagem específica de "wrong receiver"
      if (!/AEAD|decrypt|decryption|chunk|receiver|key/i.test(msg)) {
        console.log("ℹ️ Observação: falhou (ok), mas msg não parece de AEAD/wrong receiver. Ainda aceitável.");
      }
    }

    if (!failed) {
      throw new Error("❌ decryptFileLarge NÃO falhou com receiverDid errado (esperado: falhar).");
    }

    if (fileExistsNonEmpty(decryptedFile)) {
      throw new Error("❌ Arquivo decrypted foi gerado mesmo com receiverDid errado (não esperado).");
    }

    const leftovers = cleanupTmpLeftovers(decryptedFile);
    if (leftovers.length) console.log("🧹 Removidos tmp leftovers:", leftovers);

    console.log("✅ OK: decryptFileLarge falhou com receiverDid errado (comportamento correto).");
    console.log("✅ OK: TESTE MESSAGE 16 passou.");
  } finally {
    try { console.log("🔒 Fechando wallet sender..."); await sender.walletClose(); } catch (_) {}
    try { console.log("🔒 Fechando wallet receiver..."); await receiver.walletClose(); } catch (_) {}
  }
})().catch((e) => {
  console.error("❌ FALHA TESTE MESSAGE 16:", e?.message || e);
  console.error(e?.stack || "");
  process.exit(1);
});
