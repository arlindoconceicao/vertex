// PARA RODAR USE:
// WALLET_PASS="minha_senha_teste" node teste-node/envelope/test_env_05_anoncrypt_roundtrip.js

/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");

const { IndyAgent } = require(path.join(__dirname, "..", "..", "index.node"));

// -------------------------
// Helpers FS
// -------------------------
function rmIfExists(walletDbPath) {
  const sidecar = `${walletDbPath}.kdf.json`;
  try { fs.unlinkSync(walletDbPath); } catch (_) {}
  try { fs.unlinkSync(sidecar); } catch (_) {}
  try { fs.unlinkSync(`${sidecar}.tmp`); } catch (_) {}
  try { fs.unlinkSync(`${walletDbPath}-shm`); } catch (_) {}
  try { fs.unlinkSync(`${walletDbPath}-wal`); } catch (_) {}
}

function mustString(x, label) {
  if (typeof x !== "string" || !x.length) throw new Error(`${label}: esperado string não-vazia`);
}

// -------------------------
// MAIN
// -------------------------
(async () => {
  const WALLET_PASS = process.env.WALLET_PASS || "minha_senha_teste";

  const walletsDir = path.join(__dirname, "..", "wallets");
  fs.mkdirSync(walletsDir, { recursive: true });

  const walletPath = path.join(walletsDir, "env_test_05_anoncrypt.db");
  rmIfExists(walletPath);

  const agent = new IndyAgent();

  try {
    console.log("1) Criando wallet...");
    await agent.walletCreate(walletPath, WALLET_PASS);

    console.log("2) Abrindo wallet...");
    await agent.walletOpen(walletPath, WALLET_PASS);

    console.log("3) Criando DID do receiver...");
    const [receiverDid, receiverVerkey] = await agent.createOwnDid();
    mustString(receiverDid, "receiverDid");
    mustString(receiverVerkey, "receiverVerkey");

    console.log("4) Gerando plaintext...");
    const plaintextObj = { msg: "anoncrypt", ts: Date.now(), ok: true };
    const plaintext = JSON.stringify(plaintextObj);

    console.log("5) Fazendo envelopePackAnoncrypt...");
    const threadId = `th_env05_${Date.now()}`;
    const envJson = agent.envelopePackAnoncrypt(
      receiverVerkey,                 // recipient_verkey
      "test/env05/anoncrypt",          // kind
      threadId,                        // thread_id
      plaintext,                       // plaintext
      null,                            // expires_at_ms
      JSON.stringify({ test: 5 })      // meta_json
    );
    mustString(envJson, "envJson");

    console.log("6) Validando envelopeParse...");
    const parsed = JSON.parse(agent.envelopeParse(envJson));
    if (parsed.v !== 1) throw new Error("Envelope parse: v != 1");
    if (parsed.crypto?.mode !== "anoncrypt") throw new Error(`Envelope parse: mode != anoncrypt (${parsed.crypto?.mode})`);
    if (parsed.crypto?.recipient_verkey !== receiverVerkey) throw new Error("Envelope parse: recipient_verkey mismatch");
    if (parsed.thread_id !== threadId) throw new Error("Envelope parse: thread_id mismatch");

    console.log("7) Fazendo envelopeUnpackAuto...");
    const out = await agent.envelopeUnpackAuto(receiverDid, envJson);
    mustString(out, "out");

    console.log("8) Comparando plaintext...");
    if (out !== plaintext) {
      throw new Error("Roundtrip mismatch: plaintext de saída diferente do original");
    }

    console.log("✅ test_env_05_anoncrypt_roundtrip OK");
  } finally {
    try { await agent.walletClose(); } catch (_) {}
  }
})().catch((e) => {
  console.error("❌ test_env_05_anoncrypt_roundtrip FAIL:", e?.message || e);
  console.error(e?.stack || "");
  process.exit(1);
});
