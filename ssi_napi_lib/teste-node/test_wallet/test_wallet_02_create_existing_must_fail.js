// WALLET_PASS="minha_senha_teste" RESET_WALLET=1 node teste-node/test_wallet/test_wallet_02_create_existing_must_fail.js
"use strict";

const assert = require("assert");
const {
  loadNative,
  cfgFromEnv,
  resetTestDirs,
  walletDbPath,
  assertRejectsCode,
} = require("./_util");

(async () => {
  console.log("🚀 TESTE WALLET 02: create existing must fail");

  const cfg = cfgFromEnv();
  resetTestDirs(cfg);

  const { IndyAgent } = loadNative();
  const agent = new IndyAgent();

  const db = walletDbPath(cfg, "w02");

  console.log("1) wallet_create (primeira vez)...");
  await agent.walletCreate(db, cfg.WALLET_PASS);

  console.log("2) wallet_create (segunda vez) deve falhar...");
  await assertRejectsCode(
    () => agent.walletCreate(db, cfg.WALLET_PASS),
    "WalletAlreadyExists"
  );

  console.log("✅ OK: TESTE WALLET 02 passou.\n");
})().catch((e) => {
  console.error("❌ FALHA TESTE WALLET 02:", e);
  process.exit(1);
});
