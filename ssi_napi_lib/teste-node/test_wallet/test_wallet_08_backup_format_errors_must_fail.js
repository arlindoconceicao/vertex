// WALLET_PASS="minha_senha_teste" RESET_WALLET=1 node teste-node/test_wallet/test_wallet_08_backup_format_errors_must_fail.js
"use strict";

const assert = require("assert");
const path = require("path");
const fs = require("fs");
const {
  loadNative,
  cfgFromEnv,
  resetTestDirs,
  readJson,
  writeJson,
  assertRejectsCode,
} = require("./_util");

(async () => {
  console.log("🚀 TESTE WALLET 08: backup format errors must fail");

  const cfg = cfgFromEnv();
  resetTestDirs(cfg);

  const { IndyAgent } = loadNative();
  const agent = new IndyAgent();

  const file = path.join(cfg.outDir, "backup_08.json");

  console.log("1) criar backup base...");
  agent.walletBackupCreate(cfg.WALLET_PASS, "backup_pass_ok", file);
  assert.ok(fs.existsSync(file));

  console.log("2) quebrar JSON (BackupParseFailed)...");
  fs.writeFileSync(file, "{ json quebrado", "utf-8");
  await assertRejectsCode(
    async () => agent.walletBackupRecover("backup_pass_ok", file),
    "BackupParseFailed"
  );

  console.log("3) restaurar backup e remover campo salt_b64 (BackupFormatInvalid)...");
  agent.walletBackupCreate(cfg.WALLET_PASS, "backup_pass_ok", file);
  {
    const v = readJson(file);
    delete v.salt_b64;
    writeJson(file, v);
  }
  await assertRejectsCode(
    async () => agent.walletBackupRecover("backup_pass_ok", file),
    "BackupFormatInvalid"
  );

  console.log("4) restaurar backup e corromper nonce (BackupNonceInvalid)...");
  agent.walletBackupCreate(cfg.WALLET_PASS, "backup_pass_ok", file);
  {
    const v = readJson(file);
    v.nonce_b64 = "AA=="; // 1 byte (nonce inválido; esperado 12 bytes)
    writeJson(file, v);
  }
  await assertRejectsCode(
    async () => agent.walletBackupRecover("backup_pass_ok", file),
    "BackupNonceInvalid"
  );

  console.log("✅ OK: TESTE WALLET 08 passou.\n");
})().catch((e) => {
  console.error("❌ FALHA TESTE WALLET 08:", e);
  process.exit(1);
});
