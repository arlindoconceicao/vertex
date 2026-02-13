// WALLET_PASS="minha_senha_teste" RESET_WALLET=1 node teste-node/test_wallet/test_wallet_04_open_missing_db_must_fail.js
"use strict";

const {
  loadNative,
  cfgFromEnv,
  resetTestDirs,
  walletDbPath,
  assertRejectsCode,
} = require("./_util");

(async () => {
  console.log("🚀 TESTE WALLET 04: open missing db must fail");

  const cfg = cfgFromEnv();
  resetTestDirs(cfg);

  const { IndyAgent } = loadNative();
  const agent = new IndyAgent();

  const db = walletDbPath(cfg, "w04_inexistente");

  console.log("1) wallet_open em db inexistente deve falhar...");
  await assertRejectsCode(
    () => agent.walletOpen(db, cfg.WALLET_PASS),
    "WalletNotFound"
  );

  console.log("✅ OK: TESTE WALLET 04 passou.\n");
})().catch((e) => {
  console.error("❌ FALHA TESTE WALLET 04:", e);
  process.exit(1);
});
