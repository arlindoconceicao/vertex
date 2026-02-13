// WALLET_PASS="minha_senha_teste" RESET_WALLET=1 node teste-node/test_wallet/test_wallet_03_open_wrong_pass_must_fail.js
"use strict";

const {
  loadNative,
  cfgFromEnv,
  resetTestDirs,
  walletDbPath,
  assertRejectsCode,
} = require("./_util");

(async () => {
  console.log("🚀 TESTE WALLET 03: open wrong pass must fail");

  const cfg = cfgFromEnv();
  resetTestDirs(cfg);

  const { IndyAgent } = loadNative();
  const agent = new IndyAgent();

  const db = walletDbPath(cfg, "w03");

  console.log("1) wallet_create...");
  await agent.walletCreate(db, cfg.WALLET_PASS);

  console.log("2) wallet_open com senha errada deve falhar...");
  await assertRejectsCode(
    () => agent.walletOpen(db, "senha_errada_123"),
    "WalletAuthFailed"
  );

  console.log("✅ OK: TESTE WALLET 03 passou.\n");
})().catch((e) => {
  console.error("❌ FALHA TESTE WALLET 03:", e);
  process.exit(1);
});
