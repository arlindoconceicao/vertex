// teste-node/message/test_message_14_large_file_tamper_sender_verkey_must_fail.js
//
// TESTE MESSAGE 14 — NEGATIVO: adulterar sender_verkey no HEADER do .ssifile2 DEVE falhar
// (header v2 assinado -> mudar sender_verkey sem recomputar sig => Signature verification failed)
//
// Executar:
//   WALLET_PASS="minha_senha_teste" RESET_WALLET=1 node teste-node/message/test_message_14_large_file_tamper_sender_verkey_must_fail.js
//
// O fluxo:
// 1) cria/abre wallet do sender e do receiver (offline)
// 2) cria DID do sender e DID do receiver
// 3) gera arquivo grande (30MB) em disco
// 4) encryptFileLarge -> gera pacote .ssifile2
// 5) altera SOMENTE o header JSON: sender_verkey = verkey fake
// 6) decryptFileLarge no pacote adulterado -> DEVE FALHAR com Signature verification failed
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

function tamperHeaderSenderVerkeySSIFILE2(inFile, outFile, fakeSenderVerkey) {
  const buf = fs.readFileSync(inFile);
  if (buf.length < 12) throw new Error("Arquivo SSIFILE2 inválido (muito pequeno).");

  const magic = buf.slice(0, 8).toString("utf8");
  if (magic !== "SSIFILE2") throw new Error(`MAGIC inesperado: "${magic}"`);

  const headerLen = buf.readUInt32LE(8);
  const headerStart = 12;
  const headerEnd = headerStart + headerLen;
  if (headerEnd > buf.length) throw new Error("Header_len aponta além do arquivo.");

  const headerStr = buf.slice(headerStart, headerEnd).toString("utf8");
  let header;
  try { header = JSON.parse(headerStr); } catch (_) {
    throw new Error("Header JSON inválido (não parseou).");
  }

  const oldSenderVerkey = header.sender_verkey;
  header.sender_verkey = fakeSenderVerkey;
  header.note = "sender_verkey adulterada no header (deve falhar por assinatura v2)";

  // não tocar na assinatura
  const newHeaderStr = JSON.stringify(header);
  const newHeaderBuf = Buffer.from(newHeaderStr, "utf8");
  const rest = buf.slice(headerEnd);

  const out = Buffer.alloc(8 + 4 + newHeaderBuf.length + rest.length);
  out.write("SSIFILE2", 0, "utf8");
  out.writeUInt32LE(newHeaderBuf.length, 8);
  newHeaderBuf.copy(out, 12);
  rest.copy(out, 12 + newHeaderBuf.length);

  fs.writeFileSync(outFile, out);

  return {
    oldHeaderLen: headerLen,
    newHeaderLen: newHeaderBuf.length,
    oldSenderVerkey,
    fakeSenderVerkey,
    fileSize: buf.length,
    outSize: out.length,
  };
}

(async () => {
  const WALLET_PASS = process.env.WALLET_PASS || "minha_senha_teste";
  const RESET_WALLET = String(process.env.RESET_WALLET || "0") === "1";

  const walletsDir = path.join(__dirname, "..", "wallets");
  fs.mkdirSync(walletsDir, { recursive: true });

  const senderWalletPath = path.join(walletsDir, "msg_sender_14.db");
  const receiverWalletPath = path.join(walletsDir, "msg_receiver_14.db");

  const outDir = path.join(__dirname, "out");
  fs.mkdirSync(outDir, { recursive: true });

  const ts = Date.now();
  const originalFile = path.join(outDir, `large_original_${ts}.bin`);
  const encryptedPkgFile = path.join(outDir, `large_encrypted_${ts}.ssifile2`);
  const tamperedPkgFile = path.join(outDir, `large_encrypted_${ts}.tampered_sender_verkey.ssifile2`);
  const decryptedFile = path.join(outDir, `large_decrypted_${ts}.bin`);

  const TOTAL_BYTES = 30 * 1024 * 1024;
  const CHUNK_SIZE = 1024 * 1024;

  console.log("🚀 TESTE MESSAGE 14: NEGATIVO (tamper sender_verkey/header must fail)");
  console.log("Config:", {
    senderWalletPath,
    receiverWalletPath,
    originalFile,
    encryptedPkgFile,
    tamperedPkgFile,
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
  safeUnlink(tamperedPkgFile);
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

    // Fake DID/verkey (só para adulterar o header)
    console.log("4.1) Criando DID fake (para obter sender_verkey errada)...");
    const [fakeDid, fakeVerkey] = await sender.createOwnDid();
    console.log("✅ Fake:", { fakeDid, fakeVerkey });

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

    console.log("7) Adulterando sender_verkey no HEADER do .ssifile2 (sem ajustar assinatura)...");
    const info = tamperHeaderSenderVerkeySSIFILE2(encryptedPkgFile, tamperedPkgFile, fakeVerkey);
    console.log("💾 Pacote adulterado salvo:", { path: tamperedPkgFile, bytes: fs.statSync(tamperedPkgFile).size, ...info });

    console.log("8) Receiver tentando decifrar pacote com sender_verkey adulterada (deve falhar)...");
    let failed = false;
    try {
      await receiver.decryptFileLarge(receiverDid, senderVerkey, tamperedPkgFile, decryptedFile);
      failed = false;
    } catch (e) {
      failed = true;
      const msg = String(e?.message || e);
      console.log("✅ Falhou como esperado:", msg);

      if (!/Signature verification failed/i.test(msg)) {
        console.log("ℹ️ Observação: falhou (ok), mas msg não foi exatamente 'Signature verification failed'. Ainda aceitável conforme implementação.");
      }
    }

    if (!failed) {
      throw new Error("❌ decryptFileLarge NÃO falhou após adulteração de sender_verkey no header (esperado: falhar).");
    }

    if (fileExistsNonEmpty(decryptedFile)) {
      throw new Error("❌ Arquivo decrypted foi gerado mesmo com sender_verkey adulterada (não esperado).");
    }

    console.log("✅ OK: decryptFileLarge falhou com sender_verkey adulterada no header (correto em v2 assinado).");
    console.log("✅ OK: TESTE MESSAGE 14 passou.");
  } finally {
    try { console.log("🔒 Fechando wallet sender..."); await sender.walletClose(); } catch (_) {}
    try { console.log("🔒 Fechando wallet receiver..."); await receiver.walletClose(); } catch (_) {}
  }
})().catch((e) => {
  console.error("❌ FALHA TESTE MESSAGE 14:", e?.message || e);
  console.error(e?.stack || "");
  process.exit(1);
});
