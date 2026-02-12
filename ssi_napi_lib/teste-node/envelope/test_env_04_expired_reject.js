// PARA RODAR USE
// WALLET_PASS="minha_senha_teste" node teste-node/envelope/test_env_04_expired_reject.js

/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const { IndyAgent } = require(path.join(__dirname, "..", "..", "index.node"));
const { rmIfExists } = require("./helpers");

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const WALLET_PASS = process.env.WALLET_PASS || "minha_senha_teste";
  const walletsDir = path.join(__dirname, "..", "wallets");
  fs.mkdirSync(walletsDir, { recursive: true });

  const walletPath = path.join(walletsDir, "env_expired.db");
  rmIfExists(walletPath);

  const agent = new IndyAgent();

  try {
    await agent.walletCreate(walletPath, WALLET_PASS);
    await agent.walletOpen(walletPath, WALLET_PASS);

    const [didA] = await agent.createOwnDid();
    const [didB, verkeyB] = await agent.createOwnDid();

    const plaintext = JSON.stringify({ msg: "expired", ts: Date.now() });
    const expiresSoon = Date.now() + 50;

    const envJson = await agent.envelopePackAuthcrypt(
      didA,
      verkeyB,
      "test/expired",
      "th_exp_01",
      plaintext,
      expiresSoon,
      null
    );

    await sleep(80);

    let failed = false;
    try {
      await agent.envelopeUnpackAuto(didB, envJson);
    } catch (e) {
      failed = true;
    }

    if (!failed) throw new Error("esperava falha por expiração, mas unpack passou");
    console.log("✅ test_env_04_expired_reject OK");
  } finally {
    try { await agent.walletClose(); } catch (_) { }
  }
})().catch((e) => {
  console.error("❌ test_env_04_expired_reject FAIL:", e?.message || e);
  process.exit(1);
});
