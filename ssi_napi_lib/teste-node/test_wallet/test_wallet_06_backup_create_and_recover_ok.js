// WALLET_PASS="minha_senha_teste" RESET_WALLET=1 node teste-node/test_wallet/test_wallet_06_backup_create_and_recover_ok.js
"use strict";

const assert = require("assert");
const path = require("path");
const fs = require("fs");
const { loadNative, cfgFromEnv, resetTestDirs } = require("./_util");

(() => {
  console.log("🚀 TESTE WALLET 06: backup create + recover OK");

  const cfg = cfgFromEnv();
  resetTestDirs(cfg);

  const { IndyAgent } = loadNative();
  const agent = new IndyAgent();

  const walletPass = cfg.WALLET_PASS;
  const backupPass = "backup_pass_01";
  const file = path.join(cfg.outDir, "backup_06.json");

  console.log("1) wallet_backup_create...");
  const ok = agent.walletBackupCreate(walletPass, backupPass, file);
  assert.strictEqual(ok, true);
  assert.ok(fs.existsSync(file), "Arquivo de backup não foi criado.");

  console.log("2) wallet_backup_recover...");
  const recovered = agent.walletBackupRecover(backupPass, file);
  assert.strictEqual(recovered, walletPass);

  console.log("✅ OK: TESTE WALLET 06 passou.\n");
})();
