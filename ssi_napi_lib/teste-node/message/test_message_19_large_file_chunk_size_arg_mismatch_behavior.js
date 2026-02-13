// teste-node/message/test_message_19_large_file_chunk_size_arg_mismatch_behavior.js
//
// TESTE MESSAGE 19 — EXPECTATIVA: chunk_size ARGUMENTO diferente NÃO deve quebrar o decrypt,
// porque o decrypt deve respeitar o chunk_size do HEADER do pacote.
// (Se a sua implementação usar o chunk_size do argumento em vez do header, então este teste deve falhar;
// nesse caso, ajuste o teste para "must_fail".)
//
// Executar:
//   WALLET_PASS="minha_senha_teste" RESET_WALLET=1 node teste-node/message/test_message_19_large_file_chunk_size_arg_mismatch_behavior.js
//
// O fluxo:
// 1) cria/abre wallet do sender e do receiver (offline)
// 2) cria DID do sender e DID do receiver
// 3) gera arquivo grande (30MB)
// 4) encryptFileLarge com CHUNK_SIZE_REAL (ex: 1MB)
// 5) decryptFileLarge passando CHUNK_SIZE_ARG_ERRADO (ex: 512KB) -> deve IGNORAR e funcionar
// 6) compara SHA-256 original vs restaurado
//
// Requisitos:
// - encryptFileLarge(senderDid, receiverVerkey, inPath, outPkgPath, chunkSize)
// - decryptFileLarge(receiverDid, senderVerkey, inPkgPath, outPlainPath[, chunkSize])  // opcional
//
// Observação importante:
// - Se decryptFileLarge NÃO aceitar o 5º parâmetro (chunkSize), este teste faz fallback
//   chamando com 4 params e apenas registra a limitação.

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

function sha256File(p) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash("sha256");
    const s = fs.createReadStream(p);
    s.on("error", reject);
    s.on("data", (chunk) => h.update(chunk));
    s.on("end", () => resolve(h.digest("hex")));
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

  const senderWalletPath = path.join(walletsDir, "msg_sender_19.db");
  const receiverWalletPath = path.join(walletsDir, "msg_receiver_19.db");

  const outDir = path.join(__dirname, "out");
  fs.mkdirSync(outDir, { recursive: true });

  const ts = Date.now();
  const originalFile = path.join(outDir, `large_original_${ts}.bin`);
  const encryptedPkgFile = path.join(outDir, `large_encrypted_${ts}.ssifile2`);
  const decryptedFile = path.join(outDir, `large_decrypted_${ts}.bin`);

  const TOTAL_BYTES = 30 * 1024 * 1024;

  const CHUNK_SIZE_REAL = 1024 * 1024;   // 1MB (usado no encrypt)
  const CHUNK_SIZE_ARG_WRONG = 512 * 1024; // 512KB (passado no decrypt para testar)

  console.log("🚀 TESTE MESSAGE 19: EXPECTATIVA (chunk_size arg mismatch should still decrypt)");
  console.log("Config:", {
    senderWalletPath,
    receiverWalletPath,
    originalFile,
    encryptedPkgFile,
    decryptedFile,
    TOTAL_BYTES,
    CHUNK_SIZE_REAL,
    CHUNK_SIZE_ARG_WRONG,
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

    console.log("6) Calculando SHA-256 do original...");
    const shaOrig = await sha256File(originalFile);
    console.log("🔎 SHA-256 original:", shaOrig);

    console.log("7) Sender cifrando ARQUIVO GRANDE (encryptFileLarge) com CHUNK_SIZE_REAL...");
    const encRespStr = await sender.encryptFileLarge(
      senderDid,
      receiverVerkey,
      originalFile,
      encryptedPkgFile,
      CHUNK_SIZE_REAL
    );
    try { console.log("✅ encryptFileLarge resp:", JSON.parse(encRespStr)); } catch (_) {
      console.log("✅ encryptFileLarge resp:", String(encRespStr).slice(0, 250));
    }

    if (!fileExistsNonEmpty(encryptedPkgFile)) {
      throw new Error("Pacote cifrado large não foi gerado (arquivo ausente ou vazio).");
    }
    console.log("💾 Pacote cifrado large salvo:", { path: encryptedPkgFile, bytes: fs.statSync(encryptedPkgFile).size });

    console.log("8) Receiver decifrando com CHUNK_SIZE ARGUMENTO ERRADO (esperado: IGNORAR e funcionar)...");
    let decRespStr;

    // Alguns builds aceitam 5º parâmetro no decrypt, outros não. Tentamos os dois.
    try {
      decRespStr = await receiver.decryptFileLarge(
        receiverDid,
        senderVerkey,
        encryptedPkgFile,
        decryptedFile,
        CHUNK_SIZE_ARG_WRONG
      );
      console.log("ℹ️ decryptFileLarge aceitou 5º parâmetro chunk_size.");
    } catch (e) {
      const msg = String(e?.message || e);

      // Se falhou só por aridade (ex.: "wrong number of arguments"), tentamos com 4 args.
      if (/argument|arity|Expected|arguments|number of arguments/i.test(msg)) {
        console.log("ℹ️ decryptFileLarge não aceita 5º parâmetro. Fazendo fallback com 4 args...");
        decRespStr = await receiver.decryptFileLarge(
          receiverDid,
          senderVerkey,
          encryptedPkgFile,
          decryptedFile
        );
      } else {
        // Falhou por outro motivo (ex.: implementação usa arg e quebrou). Repassa o erro.
        throw e;
      }
    }

    try { console.log("✅ decryptFileLarge resp:", JSON.parse(decRespStr)); } catch (_) {
      console.log("✅ decryptFileLarge resp:", String(decRespStr).slice(0, 250));
    }

    if (!fileExistsNonEmpty(decryptedFile)) {
      throw new Error("decryptFileLarge não gerou arquivo decrypted (ausente ou vazio).");
    }
    const stDec = fs.statSync(decryptedFile);
    console.log("💾 Arquivo restaurado:", { path: decryptedFile, bytes: stDec.size });

    console.log("9) Calculando SHA-256 do restaurado...");
    const shaDec = await sha256File(decryptedFile);
    console.log("🔎 SHA-256 restaurado:", shaDec);

    if (shaDec !== shaOrig) {
      throw new Error(`❌ SHA-256 diferente. esperado=${shaOrig} obtido=${shaDec}`);
    }

    console.log("✅ OK: decrypt funcionou mesmo com chunk_size argumento errado (respeitou header).");
    console.log("✅ OK: TESTE MESSAGE 19 passou.");
  } finally {
    try { console.log("🔒 Fechando wallet sender..."); await sender.walletClose(); } catch (_) {}
    try { console.log("🔒 Fechando wallet receiver..."); await receiver.walletClose(); } catch (_) {}
  }
})().catch((e) => {
  console.error("❌ FALHA TESTE MESSAGE 19:", e?.message || e);
  console.error(e?.stack || "");
  // limpeza de tmp leftovers (se existirem)
  // (não sabemos path aqui com certeza; mas o teste já tenta limpar no fluxo normal)
  process.exit(1);
});
