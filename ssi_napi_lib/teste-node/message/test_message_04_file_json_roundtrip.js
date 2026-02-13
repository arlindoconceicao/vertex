// teste-node/message/test_message_04_file_json_roundtrip.js
//
// TESTE MESSAGE 04 — file JSON roundtrip (JSON -> salvar -> encryptFile -> salvar pkg -> ler pkg -> decryptFile -> comparar JSON) OFFLINE
//
// Executar:
//   WALLET_PASS="minha_senha_teste" RESET_WALLET=1 node teste-node/message/test_message_04_file_json_roundtrip.js
//
// O fluxo:
// 1) cria/abre wallet do sender e do receiver (offline)
// 2) cria DID do sender e DID do receiver
// 3) cria JSON original e salva em disco (teste-node/message/out/)
// 4) sender cifra o ARQUIVO JSON (encryptFile) -> gera pacote cifrado em arquivo
// 5) receiver lê o arquivo cifrado e decifra (decryptFile) -> gera JSON restaurado em arquivo
// 6) assert JSON.parse(original) deepEqual JSON.parse(restaurado)
//
// Observação:
// - Este teste simula transporte via arquivo, garantindo que o pacote JSON é suficiente.
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
const assert = require("assert");

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

function readFileUtf8OrThrow(p) {
  const stat = fs.statSync(p);
  if (!stat.isFile() || stat.size <= 0) {
    throw new Error(`Arquivo inválido (não é file ou size=0): ${p}`);
  }
  return fs.readFileSync(p, "utf8");
}

function deepSort(obj) {
  // Normaliza ordem de chaves para comparação estável
  if (Array.isArray(obj)) return obj.map(deepSort);
  if (obj && typeof obj === "object") {
    return Object.keys(obj).sort().reduce((acc, k) => {
      acc[k] = deepSort(obj[k]);
      return acc;
    }, {});
  }
  return obj;
}

(async () => {
  const WALLET_PASS = process.env.WALLET_PASS || "minha_senha_teste";
  const RESET_WALLET = String(process.env.RESET_WALLET || "0") === "1";

  const walletsDir = path.join(__dirname, "..", "wallets");
  fs.mkdirSync(walletsDir, { recursive: true });

  const senderWalletPath = path.join(walletsDir, "msg_sender_04.db");
  const receiverWalletPath = path.join(walletsDir, "msg_receiver_04.db");

  const outDir = path.join(__dirname, "out");
  fs.mkdirSync(outDir, { recursive: true });

  const ts = Date.now();
  const originalFile = path.join(outDir, `json_original_${ts}.json`);
  const encryptedPkgFile = path.join(outDir, `encrypted_pkg_${ts}.json`);
  const decryptedFile = path.join(outDir, `json_decrypted_${ts}.json`);

  console.log("🚀 TESTE MESSAGE 04: file JSON roundtrip (offline)");
  console.log("Config:", {
    senderWalletPath,
    receiverWalletPath,
    originalFile,
    encryptedPkgFile,
    decryptedFile,
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
    // Criar JSON e salvar em disco
    // -------------------------
    console.log("5) Criando JSON original e salvando em disco...");
    const payload = {
      v: 1,
      type: "roundtrip-json",
      ts,
      from: { did: senderDid, verkey: senderVerkey },
      to: { did: receiverDid, verkey: receiverVerkey },
      data: {
        msg: `Olá SSI ✅ ${ts}`,
        attrs: {
          cpf: "12345678900",
          idade: "35",
          cidade: "São Paulo",
        },
        flags: ["a", "b", "c"],
        nested: { ok: true, n: 42 },
      },
    };

    atomicWriteFile(originalFile, JSON.stringify(payload, null, 2));

    const statOrig = fs.statSync(originalFile);
    if (!statOrig.isFile() || statOrig.size <= 0) throw new Error("Falha ao salvar JSON original.");
    console.log("💾 JSON original salvo:", { path: originalFile, bytes: statOrig.size });

    // valida se está OK
    const origStr = readFileUtf8OrThrow(originalFile);
    const origObj = safeJsonParse(origStr);
    if (!origObj) throw new Error("JSON original salvo não é JSON válido.");

    // -------------------------
    // Encrypt File -> pacote cifrado em arquivo
    // -------------------------
    console.log("6) Sender cifrando ARQUIVO JSON (encryptFile)...");
    // encryptFile(senderDid, receiverVerkey, inPath, outPkgPath)
    const encRespStr = await sender.encryptFile(
      senderDid,
      receiverVerkey,
      originalFile,
      encryptedPkgFile
    );

    // resp pode ser JSON string (ok/meta) — não é obrigatório, mas validamos se vier
    const encResp = safeJsonParse(encRespStr);
    if (encRespStr && !encResp) {
      console.log("ℹ️ encryptFile retornou string não-JSON (ok):", String(encRespStr).slice(0, 150));
    } else if (encResp) {
      console.log("✅ encryptFile resp:", encResp);
    }

    const pkgStr = readFileUtf8OrThrow(encryptedPkgFile);
    const pkg = safeJsonParse(pkgStr);
    if (!pkg) throw new Error("Pacote cifrado (arquivo) não contém JSON válido.");
    if (!pkg.ciphertext || !pkg.nonce) throw new Error("Pacote cifrado inválido: ciphertext/nonce ausente.");
    console.log("💾 Pacote cifrado salvo:", { path: encryptedPkgFile, bytes: fs.statSync(encryptedPkgFile).size });

    // -------------------------
    // Decrypt File -> JSON restaurado em arquivo
    // -------------------------
    console.log("7) Receiver decifrando PACOTE (decryptFile) -> arquivo JSON restaurado...");
    // decryptFile(receiverDid, senderVerkey, inPkgPath, outPlainPath)
    const decRespStr = await receiver.decryptFile(
      receiverDid,
      senderVerkey,
      encryptedPkgFile,
      decryptedFile
    );

    const decResp = safeJsonParse(decRespStr);
    if (decRespStr && !decResp) {
      console.log("ℹ️ decryptFile retornou string não-JSON (ok):", String(decRespStr).slice(0, 150));
    } else if (decResp) {
      console.log("✅ decryptFile resp:", decResp);
    }

    const decStr = readFileUtf8OrThrow(decryptedFile);
    const decObj = safeJsonParse(decStr);
    if (!decObj) throw new Error("JSON restaurado não é JSON válido.");

    console.log("💾 JSON restaurado salvo:", { path: decryptedFile, bytes: fs.statSync(decryptedFile).size });

    // -------------------------
    // Compare JSON (deep equal)
    // -------------------------
    console.log("8) Comparando JSON original vs restaurado...");
    assert.deepStrictEqual(deepSort(decObj), deepSort(origObj));

    console.log("✅ OK: JSON roundtrip por arquivo funcionou (deep equal).");
    console.log("✅ OK: TESTE MESSAGE 04 passou.");
  } finally {
    try { console.log("🔒 Fechando wallet sender..."); await sender.walletClose(); } catch (_) {}
    try { console.log("🔒 Fechando wallet receiver..."); await receiver.walletClose(); } catch (_) {}
  }
})().catch((e) => {
  console.error("❌ FALHA TESTE MESSAGE 04:", e?.message || e);
  console.error(e?.stack || "");
  process.exit(1);
});
