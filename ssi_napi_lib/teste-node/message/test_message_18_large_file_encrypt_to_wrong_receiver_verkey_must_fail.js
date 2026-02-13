// teste-node/message/test_message_18_large_file_encrypt_to_wrong_receiver_verkey_must_fail.js
//
// TESTE MESSAGE 18 — NEGATIVO: cifrar para receiverVerkey ERRADA deve falhar no decrypt
// Cenário: sender cifra para uma verkey "fake" (não pertencente ao receiver REAL).
// Esperado: decryptFileLarge no receiver REAL falha ao abrir KEK (ou AEAD fail), e NÃO gera arquivo final.
//
// Executar:
//   WALLET_PASS="minha_senha_teste" RESET_WALLET=1 node teste-node/message/test_message_18_large_file_encrypt_to_wrong_receiver_verkey_must_fail.js
//
// O fluxo:
// 1) cria/abre wallet do sender e do receiver (offline)
// 2) cria DID do sender
// 3) cria DID do receiver REAL
// 4) cria DID fake no sender (para obter receiverVerkey ERRADA / inexistente para o receiver)
// 5) gera arquivo grande (30MB)
// 6) encryptFileLarge -> pacote .ssifile2 usando receiverVerkey FAKE
// 7) receiver REAL tenta decryptFileLarge -> DEVE FALHAR
// 8) garante que não ficou arquivo decrypted final e remove tmp leftovers
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

  const senderWalletPath = path.join(walletsDir, "msg_sender_18.db");
  const receiverWalletPath = path.join(walletsDir, "msg_receiver_18.db");

  const outDir = path.join(__dirname, "out");
  fs.mkdirSync(outDir, { recursive: true });

  const ts = Date.now();
  const originalFile = path.join(outDir, `large_original_${ts}.bin`);
  const encryptedPkgFile = path.join(outDir, `large_encrypted_${ts}.ssifile2`);
  const decryptedFile = path.join(outDir, `large_decrypted_${ts}.bin`);

  const TOTAL_BYTES = 30 * 1024 * 1024;
  const CHUNK_SIZE = 1024 * 1024;

  console.log("🚀 TESTE MESSAGE 18: NEGATIVO (encrypt to wrong receiver verkey must fail - large)");
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

    console.log("4) Criando DID do receiver REAL...");
    const [receiverDid, receiverVerkey] = await receiver.createOwnDid();
    console.log("✅ Receiver REAL:", { receiverDid, receiverVerkey });

    console.log("4.1) Criando DID fake no sender (para obter receiverVerkey ERRADA)...");
    const [fakeReceiverDid, fakeReceiverVerkey] = await sender.createOwnDid();
    console.log("✅ Fake receiver verkey (não pertence ao receiver REAL):", { fakeReceiverDid, fakeReceiverVerkey });

    console.log("5) Gerando arquivo grande (30MB) em disco...");
    const written = await generateLargeFile(originalFile, TOTAL_BYTES, 1024 * 1024);
    const stOrig = fs.statSync(originalFile);
    if (!stOrig.isFile() || stOrig.size !== TOTAL_BYTES) {
      throw new Error(`Arquivo original inválido: size=${stOrig.size} esperado=${TOTAL_BYTES}`);
    }
    console.log("💾 Arquivo original gerado:", { path: originalFile, bytes: written });

    console.log("6) Sender cifrando ARQUIVO GRANDE (encryptFileLarge) para receiverVerkey ERRADA...");
    const encRespStr = await sender.encryptFileLarge(
      senderDid,
      fakeReceiverVerkey,   // <-- ERRADA (receiver não tem essa key)
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

    console.log("7) Receiver REAL tentando decifrar pacote cifrado para verkey ERRADA (deve falhar)...");
    let failed = false;
    try {
      await receiver.decryptFileLarge(
        receiverDid,
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
      // - "Falha abrir KEK: Crypto box AEAD decryption error"
      // - "AEAD decrypt failed (chunk)" (se pipeline tentar seguir)
      // - outras equivalentes
      if (!/KEK|AEAD|decrypt|decryption|error/i.test(msg)) {
        console.log("ℹ️ Observação: falhou (ok), mas msg não parece de AEAD/KEK. Ainda aceitável.");
      }
    }

    if (!failed) {
      throw new Error("❌ decryptFileLarge NÃO falhou com receiverVerkey errada (esperado: falhar).");
    }

    if (fileExistsNonEmpty(decryptedFile)) {
      throw new Error("❌ Arquivo decrypted foi gerado mesmo com receiverVerkey errada (não esperado).");
    }

    const leftovers = cleanupTmpLeftovers(decryptedFile);
    if (leftovers.length) console.log("🧹 Removidos tmp leftovers:", leftovers);

    console.log("✅ OK: decryptFileLarge falhou com pacote cifrado para receiverVerkey errada (comportamento correto).");
    console.log("✅ OK: TESTE MESSAGE 18 passou.");
  } finally {
    try { console.log("🔒 Fechando wallet sender..."); await sender.walletClose(); } catch (_) {}
    try { console.log("🔒 Fechando wallet receiver..."); await receiver.walletClose(); } catch (_) {}
  }
})().catch((e) => {
  console.error("❌ FALHA TESTE MESSAGE 18:", e?.message || e);
  console.error(e?.stack || "");
  process.exit(1);
});
