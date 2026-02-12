// para rodar use:
// WALLET_PASS="minha_senha_teste" node teste-node/envelope/test_env_03_authcrypt_roundtrip.js

/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const { IndyAgent } = require(path.join(__dirname, "..", "..", "index.node"));
const { rmIfExists } = require("./helpers");

(async () => {
  const WALLET_PASS = process.env.WALLET_PASS || "minha_senha_teste";
  const walletsDir = path.join(__dirname, "..", "wallets");
  fs.mkdirSync(walletsDir, { recursive: true });

  const walletPath = path.join(walletsDir, "env_roundtrip.db");
  rmIfExists(walletPath);

  const a = new IndyAgent();
  const b = new IndyAgent();

  try {
    await a.walletCreate(walletPath, WALLET_PASS);
    await a.walletOpen(walletPath, WALLET_PASS);

    // Cria 2 DIDs no mesmo wallet só para testar crypto_box localmente
    const [didA, verkeyA] = await a.createOwnDid();
    const [didB, verkeyB] = await a.createOwnDid();

    const plaintext = JSON.stringify({ msg: "hello", ts: Date.now() });

    const envJson = await a.envelopePackAuthcrypt(
      didA,
      verkeyB,
      "test/authcrypt",
      "th_auth_01",
      plaintext,
      null,
      JSON.stringify({ tags: ["authcrypt", "unit"] })
    );

    // Receiver usa o DID B para achar a key privada correta
    const out = await a.envelopeUnpackAuto(didB, envJson);

    if (out !== plaintext) throw new Error("roundtrip plaintext mismatch");

    console.log("✅ test_env_03_authcrypt_roundtrip OK");
  } finally {
    try { await a.walletClose(); } catch (_) {}
    try { await b.walletClose(); } catch (_) {}
  }
})().catch((e) => {
  console.error("❌ test_env_03_authcrypt_roundtrip FAIL:", e?.message || e);
  process.exit(1);
});
