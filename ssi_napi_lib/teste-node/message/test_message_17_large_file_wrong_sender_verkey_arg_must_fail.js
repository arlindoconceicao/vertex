// teste-node/message/test_message_17_large_file_wrong_sender_verkey_arg_must_fail.js
//
// TESTE MESSAGE 17 — NEGATIVO: passar sender_verkey ERRADA como ARGUMENTO no decryptFileLarge deve falhar
// Cenário: o pacote .ssifile2 está íntegro, mas o chamador informa sender_verkey incorreta na API.
// Esperado: falha por mismatch (ex.: "Header sender_verkey != sender_verkey informado") ou
// "Signature verification failed" / erro equivalente, e NÃO gerar arquivo final.
//
// Executar:
//   WALLET_PASS="minha_senha_teste" RESET_WALLET=1 node teste-node/message/test_message_17_large_file_wrong_sender_verkey_arg_must_fail.js
//
// O fluxo:
// 1) cria/abre wallet do sender e do receiver (offline)
// 2) cria DID do sender e DID do receiver
// 3) cria DID extra (para obter sender_verkey fake)
// 4) gera arquivo grande (30MB)
// 5) encryptFileLarge -> pacote .ssifile2 (header correto)
// 6) decryptFileLarge passando sender_verkey FAKE (arg) -> DEVE FALHAR
// 7) garante que não ficou arquivo decrypted final e remove tmp leftovers

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

  const senderWalletPath = path.join(walletsDir, "msg_sender_17.db");
  const receiverWalletPath = path.join(walletsDir, "msg_receiver_17.db");

  const outDir = path.join(__dirname, "out");
  fs.mkdirSync(outDir, { recursive: true });

  const ts = Date.now();
  const originalFile = path.join(outDir, `large_original_${ts}.bin`);
  const encryptedPkgFile = path.join(outDir, `large_encrypted_${ts}.ssifile2`);
  const decryptedFile = path.join(outDir, `large_decrypted_${ts}.bin`);

  const TOTAL_BYTES = 30 * 1024 * 1024;
  const CHUNK_SIZE = 1024 * 1024;

  console.log("🚀 TESTE MESSAGE 17: NEGATIVO (wrong sender_verkey arg must fail - large)");
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

    console.log("3.1) Criando DID fake (para obter sender_verkey errada)...");
    const [fakeDid, fakeSenderVerkey] = await sender.createOwnDid();
    console.log("✅ Fake sender:", { fakeDid, fakeSenderVerkey });

    console.log("4) Criando DID do receiver...");
    const [receiverDid, receiverVerkey] = await receiver.createOwnDid();
    console.log("✅ Receiver:", { receiverDid, receiverVerkey });

    console.log("5) Gerando arquivo grande (30MB) em disco...");
    const written = await generateLargeFile(originalFile, TOTAL_BYTES, 1024 * 1024);
    const stOrig = fs.statSync(originalFile);
    if (!stOrig.isFile() || stOrig.size !== TOTAL_BYTES) {
      throw new Error(`Arquivo original inválido: size=${stOrig.size} esperado=${TOTAL_BYTES}`);
    }
    console.log("💾 Arquivo original gerado:", { path: originalFile, bytes: written });

    console.log("6) Sender cifrando ARQUIVO GRANDE (encryptFileLarge)...");
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

    console.log("7) Receiver tentando decifrar com sender_verkey ARGUMENTO ERRADA (deve falhar)...");
    let failed = false;
    try {
      await receiver.decryptFileLarge(
        receiverDid,
        fakeSenderVerkey,     // <-- ERRADO (argumento)
        encryptedPkgFile,
        decryptedFile
      );
      failed = false;
    } catch (e) {
      failed = true;
      const msg = String(e?.message || e);
      console.log("✅ Falhou como esperado:", msg);

      // Mensagens prováveis:
      // - "Header sender_verkey != sender_verkey informado"
      // - "Signature verification failed"
      // - ou alguma mensagem específica de mismatch
      if (!/Header sender_verkey|sender_verkey|Signature verification failed|signature/i.test(msg)) {
        console.log("ℹ️ Observação: falhou (ok), mas msg não foi mismatch/signature. Ainda aceitável.");
      }
    }

    if (!failed) {
      throw new Error("❌ decryptFileLarge NÃO falhou com sender_verkey (arg) errada (esperado: falhar).");
    }

    if (fileExistsNonEmpty(decryptedFile)) {
      throw new Error("❌ Arquivo decrypted foi gerado mesmo com sender_verkey (arg) errada (não esperado).");
    }

    const leftovers = cleanupTmpLeftovers(decryptedFile);
    if (leftovers.length) console.log("🧹 Removidos tmp leftovers:", leftovers);

    console.log("✅ OK: decryptFileLarge falhou com sender_verkey (arg) errada (comportamento correto).");
    console.log("✅ OK: TESTE MESSAGE 17 passou.");
  } finally {
    try { console.log("🔒 Fechando wallet sender..."); await sender.walletClose(); } catch (_) {}
    try { console.log("🔒 Fechando wallet receiver..."); await receiver.walletClose(); } catch (_) {}
  }
})().catch((e) => {
  console.error("❌ FALHA TESTE MESSAGE 17:", e?.message || e);
  console.error(e?.stack || "");
  process.exit(1);
});
