// WALLET_PASS="minha_senha_teste" RESET_WALLET=1 node teste-node/test_wallet/test_wallet_11_verify_pass.js

"use strict";

const assert = require("assert");
const { loadNative, cfgFromEnv, resetTestDirs, walletDbPath, assertRejectsCode } = require("./_util");

(async () => {
  console.log("🚀 TESTE WALLET 11: verify pass");

  const cfg = cfgFromEnv();
  resetTestDirs(cfg);

  const { IndyAgent } = loadNative();
  const agent = new IndyAgent();

  const db = walletDbPath(cfg, "w11");
  const pass = cfg.WALLET_PASS;

  console.log("1) walletCreate...");
  await agent.walletCreate(db, pass);

  console.log("2) walletVerifyPass correto => true");
  const ok1 = await agent.walletVerifyPass(db, pass);
  assert.strictEqual(ok1, true);

  console.log("3) walletVerifyPass errado => false");
  const ok2 = await agent.walletVerifyPass(db, "senha_errada");
  assert.strictEqual(ok2, false);

  console.log("4) walletVerifyPass em db inexistente deve falhar WalletNotFound");
  await assertRejectsCode(
    () => agent.walletVerifyPass(db + ".nao_existe", pass),
    "WalletNotFound"
  );

  console.log("✅ OK: TESTE WALLET 11 passou.\n");
})().catch((e) => {
  console.error("❌ FALHA TESTE WALLET 11:", e);
  process.exit(1);
});
