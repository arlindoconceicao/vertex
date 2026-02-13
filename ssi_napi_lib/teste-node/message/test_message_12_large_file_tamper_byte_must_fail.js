// teste-node/message/test_message_12_large_file_tamper_byte_must_fail.js
//
// TESTE MESSAGE 12 — NEGATIVO: adulterar 1 byte no .ssifile2 DEVE falhar (decryptFileLarge)
// (tamper ciphertext em algum chunk -> AEAD tag inválida)
//
// Executar:
//   WALLET_PASS="minha_senha_teste" RESET_WALLET=1 node teste-node/message/test_message_12_large_file_tamper_byte_must_fail.js
//
// O fluxo:
// 1) cria/abre wallet do sender e do receiver (offline)
// 2) cria DID do sender e DID do receiver
// 3) gera arquivo grande (30MB) em disco
// 4) encryptFileLarge -> gera pacote .ssifile2
// 5) copia pacote e adultera 1 byte no meio (fora do header)
// 6) decryptFileLarge no pacote adulterado -> DEVE FALHAR
// 7) garante que não ficou arquivo decrypted final (e remove tmp se existir)
//
// Requisitos:
// - encryptFileLarge(senderDid, receiverVerkey, inPath, outPkgPath[, chunkSize])
// - decryptFileLarge(receiverDid, senderVerkey, inPkgPath, outPlainPath)

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

function readU32LE(fd, pos) {
  const b = Buffer.alloc(4);
  fs.readSync(fd, b, 0, 4, pos);
  return b.readUInt32LE(0);
}

function tamperOneByteAfterHeader(inFile, outFile) {
  // Formato:
  // MAGIC (8) + HEADER_LEN (4) + HEADER_JSON (len) + chunks...
  // Vamos adulterar 1 byte em algum lugar após o header, mas evitando o final do arquivo.
  fs.copyFileSync(inFile, outFile);

  const fd = fs.openSync(outFile, "r+");
  try {
    const st = fs.statSync(outFile);
    if (st.size < 8 + 4 + 2 + 64) throw new Error("Pacote pequeno demais para tamper.");

    // validar magic
    const magic = Buffer.alloc(8);
    fs.readSync(fd, magic, 0, 8, 0);
    if (magic.toString("utf8") !== "SSIFILE2") {
      throw new Error(`MAGIC inesperado: "${magic.toString("utf8")}"`);
    }

    const headerLen = readU32LE(fd, 8);
    const dataStart = 8 + 4 + headerLen;

    // escolher posição de tamper: meio do conteúdo após header, com margem
    const minPos = dataStart + 64;               // pula começo do 1º chunk
    const maxPos = st.size - 64;                 // evita final
    if (maxPos <= minPos) throw new Error("Arquivo não tem espaço suficiente pós-header.");

    const pos = Math.floor((minPos + maxPos) / 2);

    const one = Buffer.alloc(1);
    fs.readSync(fd, one, 0, 1, pos);
    one[0] = one[0] ^ 0x01; // flip 1 bit

    fs.writeSync(fd, one, 0, 1, pos);

    return { dataStart, headerLen, tamperPos: pos, fileSize: st.size };
  } finally {
    fs.closeSync(fd);
  }
}

(async () => {
  const WALLET_PASS = process.env.WALLET_PASS || "minha_senha_teste";
  const RESET_WALLET = String(process.env.RESET_WALLET || "0") === "1";

  const walletsDir = path.join(__dirname, "..", "wallets");
  fs.mkdirSync(walletsDir, { recursive: true });

  const senderWalletPath = path.join(walletsDir, "msg_sender_12.db");
  const receiverWalletPath = path.join(walletsDir, "msg_receiver_12.db");

  const outDir = path.join(__dirname, "out");
  fs.mkdirSync(outDir, { recursive: true });

  const ts = Date.now();
  const originalFile = path.join(outDir, `large_original_${ts}.bin`);
  const encryptedPkgFile = path.join(outDir, `large_encrypted_${ts}.ssifile2`);
  const tamperedPkgFile = path.join(outDir, `large_encrypted_${ts}.tampered.ssifile2`);
  const decryptedFile = path.join(outDir, `large_decrypted_${ts}.bin`);

  // 30 MB
  const TOTAL_BYTES = 30 * 1024 * 1024;
  const CHUNK_SIZE = 1024 * 1024;

  console.log("🚀 TESTE MESSAGE 12: NEGATIVO (tamper 1 byte must fail)");
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

  // limpeza defensiva
  safeUnlink(originalFile);
  safeUnlink(encryptedPkgFile);
  safeUnlink(tamperedPkgFile);
  safeUnlink(decryptedFile);
  safeUnlink(`${decryptedFile}.tmp.${process.pid}`); // defensivo (se alguém mudar tmp)
  // seu Rust usa: `${out_path}.tmp.${pid}`; como não sabemos o pid do Rust, limpamos pattern abaixo depois se quiser.

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

    console.log(`5) Gerando arquivo grande (${Math.round(TOTAL_BYTES / (1024 * 1024))}MB) em disco...`);
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

    console.log("7) Adulterando 1 byte no pacote .ssifile2 (fora do header)...");
    const tamperInfo = tamperOneByteAfterHeader(encryptedPkgFile, tamperedPkgFile);
    console.log("💾 Pacote adulterado salvo:", {
      path: tamperedPkgFile,
      bytes: fs.statSync(tamperedPkgFile).size,
      ...tamperInfo,
    });

    console.log("8) Receiver tentando decifrar pacote adulterado (deve falhar)...");
    let failedAsExpected = false;

    try {
      await receiver.decryptFileLarge(receiverDid, senderVerkey, tamperedPkgFile, decryptedFile);
      failedAsExpected = false;
    } catch (e) {
      failedAsExpected = true;
      const msg = String(e?.message || e);
      console.log("✅ Falhou como esperado:", msg);

      // Mensagens prováveis:
      // - "AEAD decrypt failed (chunk)" (nosso Rust sugerido)
      // - ou alguma variação
      if (!/AEAD|decrypt failed|chunk|tag|auth/i.test(msg)) {
        console.log("ℹ️ Observação: falhou (ok), mas mensagem não parece de AEAD. Ainda aceitável dependendo da implementação.");
      }
    }

    if (!failedAsExpected) {
      throw new Error("❌ decryptFileLarge NÃO falhou após adulteração de byte (esperado: falhar).");
    }

    if (fileExistsNonEmpty(decryptedFile)) {
      throw new Error("❌ Arquivo decrypted foi gerado mesmo com pacote adulterado (não esperado).");
    }

    // limpeza defensiva: se o Rust escreveu tmp e não removeu (pode acontecer se crashar)
    try {
      const dir = path.dirname(decryptedFile);
      const base = path.basename(decryptedFile);
      const entries = fs.readdirSync(dir);
      const leftovers = entries.filter((n) => n.startsWith(`${base}.tmp.`));
      leftovers.forEach((n) => safeUnlink(path.join(dir, n)));
      if (leftovers.length) console.log("🧹 Removidos tmp leftovers:", leftovers);
    } catch (_) {}

    console.log("✅ OK: decryptFileLarge falhou com pacote adulterado (comportamento correto).");
    console.log("✅ OK: TESTE MESSAGE 12 passou.");
  } finally {
    try { console.log("🔒 Fechando wallet sender..."); await sender.walletClose(); } catch (_) {}
    try { console.log("🔒 Fechando wallet receiver..."); await receiver.walletClose(); } catch (_) {}
  }
})().catch((e) => {
  console.error("❌ FALHA TESTE MESSAGE 12:", e?.message || e);
  console.error(e?.stack || "");
  process.exit(1);
});
