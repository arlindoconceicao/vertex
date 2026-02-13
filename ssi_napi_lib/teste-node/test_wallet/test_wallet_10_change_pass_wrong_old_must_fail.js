// WALLET_PASS="minha_senha_teste" RESET_WALLET=1 node teste-node/test_wallet/test_wallet_10_change_pass_wrong_old_must_fail.js

"use strict";

const assert = require("assert");
const { loadNative, cfgFromEnv, resetTestDirs, walletDbPath, assertRejectsCode } = require("./_util");

(async () => {
  console.log("🚀 TESTE WALLET 10: change pass wrong old must fail");

  const cfg = cfgFromEnv();
  resetTestDirs(cfg);

  const { IndyAgent } = loadNative();
  const agent = new IndyAgent();

  const db = walletDbPath(cfg, "w10");

  console.log("1) walletCreate...");
  await agent.walletCreate(db, cfg.WALLET_PASS);

  console.log("2) walletChangePass com senha antiga errada deve falhar...");
  await assertRejectsCode(
    () => agent.walletChangePass(db, "senha_errada", "nova_senha_123"),
    "WalletAuthFailed"
  );

  console.log("✅ OK: TESTE WALLET 10 passou.\n");
})().catch((e) => {
  console.error("❌ FALHA TESTE WALLET 10:", e);
  process.exit(1);
});
