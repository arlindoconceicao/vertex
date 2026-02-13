// teste-node/message/test_message_15_large_file_truncate_pkg_must_fail.js
//
// TESTE MESSAGE 15 — NEGATIVO: truncar o arquivo .ssifile2 DEVE falhar (download incompleto/corrupção)
// Esperado: erro de parsing/chunk incompleto/AEAD fail e NÃO gerar arquivo final.
//
// Executar:
//   WALLET_PASS="minha_senha_teste" RESET_WALLET=1 node teste-node/message/test_message_15_large_file_truncate_pkg_must_fail.js
//
// O fluxo:
// 1) cria/abre wallet do sender e do receiver (offline)
// 2) cria DID do sender e DID do receiver
// 3) gera arquivo grande (30MB) em disco
// 4) encryptFileLarge -> gera pacote .ssifile2
// 5) copia pacote e TRUNCA o final (remove bytes)
// 6) decryptFileLarge no pacote truncado -> DEVE FALHAR
// 7) garante que não ficou arquivo decrypted final e remove tmp leftovers
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

function truncateFileCopy(inFile, outFile, cutBytes) {
  const st = fs.statSync(inFile);
  if (!st.isFile() || st.size <= 0) throw new Error("Arquivo para truncar inválido.");
  if (cutBytes <= 0) throw new Error("cutBytes deve ser > 0.");
  if (st.size <= cutBytes + 16) throw new Error("Arquivo pequeno demais para truncar com segurança.");

  fs.copyFileSync(inFile, outFile);
  const newSize = st.size - cutBytes;
  fs.truncateSync(outFile, newSize);
  const st2 = fs.statSync(outFile);
  if (st2.size !== newSize) throw new Error("Falha ao truncar: tamanho final inesperado.");

  return { oldSize: st.size, newSize, cutBytes };
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

  const senderWalletPath = path.join(walletsDir, "msg_sender_15.db");
  const receiverWalletPath = path.join(walletsDir, "msg_receiver_15.db");

  const outDir = path.join(__dirname, "out");
  fs.mkdirSync(outDir, { recursive: true });

  const ts = Date.now();
  const originalFile = path.join(outDir, `large_original_${ts}.bin`);
  const encryptedPkgFile = path.join(outDir, `large_encrypted_${ts}.ssifile2`);
  const truncatedPkgFile = path.join(outDir, `large_encrypted_${ts}.truncated.ssifile2`);
  const decryptedFile = path.join(outDir, `large_decrypted_${ts}.bin`);

  const TOTAL_BYTES = 30 * 1024 * 1024;
  const CHUNK_SIZE = 1024 * 1024;

  // Quantidade de bytes removidos do final do pacote:
  // - 64KB é bom para simular download interrompido em chunk final.
  const CUT_BYTES = 64 * 1024;

  console.log("🚀 TESTE MESSAGE 15: NEGATIVO (truncate pkg must fail)");
  console.log("Config:", {
    senderWalletPath,
    receiverWalletPath,
    originalFile,
    encryptedPkgFile,
    truncatedPkgFile,
    decryptedFile,
    TOTAL_BYTES,
    CHUNK_SIZE,
    CUT_BYTES,
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
  safeUnlink(truncatedPkgFile);
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

    console.log(`7) Truncando o pacote .ssifile2 (removendo ${CUT_BYTES} bytes do final)...`);
    const truncInfo = truncateFileCopy(encryptedPkgFile, truncatedPkgFile, CUT_BYTES);
    console.log("💾 Pacote truncado salvo:", { path: truncatedPkgFile, ...truncInfo });

    console.log("8) Receiver tentando decifrar pacote TRUNCADO (deve falhar)...");
    let failed = false;
    try {
      await receiver.decryptFileLarge(receiverDid, senderVerkey, truncatedPkgFile, decryptedFile);
      failed = false;
    } catch (e) {
      failed = true;
      const msg = String(e?.message || e);
      console.log("✅ Falhou como esperado:", msg);

      // Mensagens prováveis:
      // - "Unexpected EOF" / "chunk incomplete" / "read_exact" / "AEAD decrypt failed (chunk)"
      if (!/EOF|eof|incomplete|trunc|chunk|AEAD|decrypt failed|read_exact/i.test(msg)) {
        console.log("ℹ️ Observação: falhou (ok), mas msg não parece de trunc/EOF. Ainda aceitável conforme implementação.");
      }
    }

    if (!failed) {
      throw new Error("❌ decryptFileLarge NÃO falhou com pacote truncado (esperado: falhar).");
    }

    if (fileExistsNonEmpty(decryptedFile)) {
      throw new Error("❌ Arquivo decrypted foi gerado mesmo com pacote truncado (não esperado).");
    }

    const leftovers = cleanupTmpLeftovers(decryptedFile);
    if (leftovers.length) console.log("🧹 Removidos tmp leftovers:", leftovers);

    console.log("✅ OK: decryptFileLarge falhou com pacote truncado (comportamento correto).");
    console.log("✅ OK: TESTE MESSAGE 15 passou.");
  } finally {
    try { console.log("🔒 Fechando wallet sender..."); await sender.walletClose(); } catch (_) {}
    try { console.log("🔒 Fechando wallet receiver..."); await receiver.walletClose(); } catch (_) {}
  }
})().catch((e) => {
  console.error("❌ FALHA TESTE MESSAGE 15:", e?.message || e);
  console.error(e?.stack || "");
  process.exit(1);
});
