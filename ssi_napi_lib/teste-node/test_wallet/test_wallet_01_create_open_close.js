// node teste-node/test_wallet/test_wallet_01_create_open_close.js

// WALLET_PASS="minha_senha_teste" RESET_WALLET=1 node teste-node/test_wallet/test_wallet_01_create_open_close.js

"use strict";

const assert = require("assert");
const fs = require("fs");
const {
  loadNative,
  cfgFromEnv,
  resetTestDirs,
  walletDbPath,
} = require("./_util");

(async () => {
  console.log("🚀 TESTE WALLET 01: create -> open -> close");

  const cfg = cfgFromEnv();
  resetTestDirs(cfg);

  const { IndyAgent } = loadNative();
  const agent = new IndyAgent();

  const db = walletDbPath(cfg, "w01");

  console.log("1) wallet_create...");
  const r1 = await agent.walletCreate(db, cfg.WALLET_PASS);
  assert.strictEqual(r1, "Carteira criada com sucesso!");
  assert.ok(fs.existsSync(db), "DB não foi criada.");

  console.log("2) wallet_open...");
  const r2 = await agent.walletOpen(db, cfg.WALLET_PASS);
  assert.strictEqual(r2, "Conectado ao SQLite nativo com sucesso!");

  console.log("3) wallet_close...");
  const r3 = await agent.walletClose();
  assert.strictEqual(r3, true);

  console.log("✅ OK: TESTE WALLET 01 passou.\n");
})().catch((e) => {
  console.error("❌ FALHA TESTE WALLET 01:", e);
  process.exit(1);
});
