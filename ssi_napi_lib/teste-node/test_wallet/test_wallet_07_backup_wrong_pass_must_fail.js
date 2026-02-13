// WALLET_PASS="minha_senha_teste" RESET_WALLET=1 node teste-node/test_wallet/test_wallet_07_backup_wrong_pass_must_fail.js
"use strict";

const assert = require("assert");
const path = require("path");
const { loadNative, cfgFromEnv, resetTestDirs, assertRejectsCode } = require("./_util");

(async () => {
  console.log("🚀 TESTE WALLET 07: backup wrong pass must fail");

  const cfg = cfgFromEnv();
  resetTestDirs(cfg);

  const { IndyAgent } = loadNative();
  const agent = new IndyAgent();

  const file = path.join(cfg.outDir, "backup_07.json");

  console.log("1) wallet_backup_create...");
  const ok = agent.walletBackupCreate(cfg.WALLET_PASS, "backup_pass_ok", file);
  assert.strictEqual(ok, true);

  console.log("2) wallet_backup_recover com senha errada deve falhar...");
  await assertRejectsCode(
    async () => agent.walletBackupRecover("backup_pass_errada", file),
    "BackupDecryptFailed"
  );

  console.log("✅ OK: TESTE WALLET 07 passou.\n");
})().catch((e) => {
  console.error("❌ FALHA TESTE WALLET 07:", e);
  process.exit(1);
});
