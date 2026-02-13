// WALLET_PASS="minha_senha_teste" RESET_WALLET=1 node teste-node/test_wallet/test_wallet_09_change_pass_ok.js

"use strict";

const assert = require("assert");
const { loadNative, cfgFromEnv, resetTestDirs, walletDbPath, assertRejectsCode } = require("./_util");

(async () => {
  console.log("🚀 TESTE WALLET 09: change pass OK");

  const cfg = cfgFromEnv();
  resetTestDirs(cfg);

  const { IndyAgent } = loadNative();
  const agent = new IndyAgent();

  const db = walletDbPath(cfg, "w09");
  const oldPass = cfg.WALLET_PASS;
  const newPass = "nova_senha_123";

  console.log("1) walletCreate...");
  await agent.walletCreate(db, oldPass);

  console.log("2) walletChangePass...");
  const ok = await agent.walletChangePass(db, oldPass, newPass);
  assert.strictEqual(ok, true);

  console.log("3) walletOpen com senha antiga deve falhar...");
  await assertRejectsCode(
    () => agent.walletOpen(db, oldPass),
    "WalletAuthFailed"
  );

  console.log("4) walletOpen com senha nova deve funcionar...");
  await agent.walletOpen(db, newPass);
  await agent.walletClose();

  console.log("✅ OK: TESTE WALLET 09 passou.\n");
})().catch((e) => {
  console.error("❌ FALHA TESTE WALLET 09:", e);
  process.exit(1);
});
