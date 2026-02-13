// teste-node/message/test_message_08_file_json_tamper_nonce_must_fail.js
//
// TESTE MESSAGE 08 — NEGATIVO: adulterar nonce no pacote deve falhar (offline)
//
// Executar:
//   WALLET_PASS="minha_senha_teste" RESET_WALLET=1 node teste-node/message/test_message_08_file_json_tamper_nonce_must_fail.js
//
// O fluxo:
// 1) cria/abre wallet do sender e do receiver (offline)
// 2) cria DID do sender e DID do receiver
// 3) cria JSON original e salva em disco
// 4) sender cifra arquivo JSON (encryptFile) -> pacote cifrado em arquivo
// 5) lê o pacote cifrado, altera 1 bit do nonce (base64), salva em arquivo "tampered"
// 6) receiver tenta decifrar o pacote adulterado -> deve falhar
//
// Requisitos:
// - métodos N-API:
//    - walletCreate / walletOpen / walletClose
//    - createOwnDid
//    - encryptFile(senderDid, receiverVerkey, inPath, outPkgPath)
//    - decryptFile(receiverDid, senderVerkey, inPkgPath, outPlainPath)

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

function atomicWriteFile(filePath, content) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });

  const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, content, { encoding: "utf8" });
  fs.renameSync(tmp, filePath);
}

function safeJsonParse(s) {
  try { return JSON.parse(s); } catch (_) { return null; }
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

function readFileUtf8OrThrow(p) {
  const st = fs.statSync(p);
  if (!st.isFile() || st.size <= 0) throw new Error(`Arquivo inválido/empty: ${p}`);
  return fs.readFileSync(p, "utf8");
}

// Adultera uma string base64 SEM quebrar o parse:
// - decodifica base64
// - flipa 1 bit em posição segura
// - re-encoda base64
function tamperBase64(b64) {
  const buf = Buffer.from(b64, "base64");
  if (buf.length < 4) throw new Error("campo base64 muito pequeno para tamper");
  const i = Math.floor(buf.length / 2);
  buf[i] = buf[i] ^ 0x01;
  return buf.toString("base64");
}

(async () => {
  const WALLET_PASS = process.env.WALLET_PASS || "minha_senha_teste";
  const RESET_WALLET = String(process.env.RESET_WALLET || "0") === "1";

  const walletsDir = path.join(__dirname, "..", "wallets");
  fs.mkdirSync(walletsDir, { recursive: true });

  const senderWalletPath = path.join(walletsDir, "msg_sender_08.db");
  const receiverWalletPath = path.join(walletsDir, "msg_receiver_08.db");

  const outDir = path.join(__dirname, "out");
  fs.mkdirSync(outDir, { recursive: true });

  const ts = Date.now();
  const originalFile = path.join(outDir, `json_original_${ts}.json`);
  const encryptedPkgFile = path.join(outDir, `encrypted_pkg_${ts}.json`);
  const tamperedPkgFile = path.join(outDir, `encrypted_pkg_${ts}.tampered_nonce.json`);
  const decryptedFile = path.join(outDir, `json_decrypted_${ts}.json`);

  console.log("🚀 TESTE MESSAGE 08: NEGATIVO (tamper nonce must fail)");
  console.log("Config:", {
    senderWalletPath,
    receiverWalletPath,
    originalFile,
    encryptedPkgFile,
    tamperedPkgFile,
    decryptedFile,
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
    // Criar JSON e salvar em disco
    // -------------------------
    console.log("5) Criando JSON original e salvando em disco...");
    const payload = {
      v: 1,
      type: "roundtrip-json-negative-tamper-nonce",
      ts,
      from: { did: senderDid, verkey: senderVerkey },
      to: { did: receiverDid, verkey: receiverVerkey },
      data: { msg: `Olá SSI ✅ ${ts}`, n: 101112, ok: true },
    };
    atomicWriteFile(originalFile, JSON.stringify(payload, null, 2));
    console.log("💾 JSON original salvo:", { path: originalFile, bytes: fs.statSync(originalFile).size });

    // -------------------------
    // Encrypt File
    // -------------------------
    console.log("6) Sender cifrando ARQUIVO JSON (encryptFile)...");
    const encRespStr = await sender.encryptFile(
      senderDid,
      receiverVerkey,
      originalFile,
      encryptedPkgFile
    );
    try { console.log("✅ encryptFile resp:", JSON.parse(encRespStr)); } catch (_) {
      console.log("✅ encryptFile resp:", String(encRespStr).slice(0, 200));
    }

    if (!fileExistsNonEmpty(encryptedPkgFile)) {
      throw new Error("Pacote cifrado não foi gerado (arquivo ausente ou vazio).");
    }
    console.log("💾 Pacote cifrado salvo:", { path: encryptedPkgFile, bytes: fs.statSync(encryptedPkgFile).size });

    // -------------------------
    // Tamper nonce
    // -------------------------
    console.log("7) Adulterando nonce no pacote (tamper)...");
    const pkgStr = readFileUtf8OrThrow(encryptedPkgFile);
    const pkg = safeJsonParse(pkgStr);
    if (!pkg) throw new Error("Pacote cifrado não é JSON válido.");
    if (!pkg.ciphertext || !pkg.nonce) throw new Error("Pacote cifrado inválido (ciphertext/nonce ausente).");

    const originalNonce = pkg.nonce;
    const tamperedNonce = tamperBase64(originalNonce);

    if (tamperedNonce === originalNonce) {
      throw new Error("Tamper falhou: nonce não mudou.");
    }

    const tamperedPkg = { ...pkg, nonce: tamperedNonce };
    atomicWriteFile(tamperedPkgFile, JSON.stringify(tamperedPkg, null, 2));

    if (!fileExistsNonEmpty(tamperedPkgFile)) {
      throw new Error("Falha ao salvar pacote adulterado.");
    }
    console.log("💾 Pacote adulterado salvo:", { path: tamperedPkgFile, bytes: fs.statSync(tamperedPkgFile).size });

    // -------------------------
    // Decrypt tampered (DEVE FALHAR)
    // -------------------------
    console.log("8) Receiver tentando decifrar pacote com nonce adulterado (deve falhar)...");
    let failedAsExpected = false;

    try {
      await receiver.decryptFile(
        receiverDid,
        senderVerkey,
        tamperedPkgFile,
        decryptedFile
      );
      failedAsExpected = false;
    } catch (e) {
      failedAsExpected = true;
      console.log("✅ Falhou como esperado:", e?.message || e);
    }

    if (!failedAsExpected) {
      const leaked = fileExistsNonEmpty(decryptedFile)
        ? ` (⚠️ e ainda gerou arquivo decrypted: ${decryptedFile})`
        : "";
      throw new Error(`❌ BUG: decryptFile NÃO falhou com nonce adulterado${leaked}`);
    }

    if (fileExistsNonEmpty(decryptedFile)) {
      throw new Error(`❌ BUG: decryptFile falhou mas gerou arquivo decrypted não-vazio: ${decryptedFile}`);
    }

    console.log("✅ OK: decryptFile falhou com nonce adulterado (comportamento correto).");
    console.log("✅ OK: TESTE MESSAGE 08 passou.");
  } finally {
    try { console.log("🔒 Fechando wallet sender..."); await sender.walletClose(); } catch (_) {}
    try { console.log("🔒 Fechando wallet receiver..."); await receiver.walletClose(); } catch (_) {}
  }
})().catch((e) => {
  console.error("❌ FALHA TESTE MESSAGE 08:", e?.message || e);
  console.error(e?.stack || "");
  process.exit(1);
});
