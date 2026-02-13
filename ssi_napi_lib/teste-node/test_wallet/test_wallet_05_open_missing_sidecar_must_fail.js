// WALLET_PASS="minha_senha_teste" RESET_WALLET=1 node teste-node/test_wallet/test_wallet_05_open_missing_sidecar_must_fail.js
"use strict";

const fs = require("fs");
const {
  loadNative,
  cfgFromEnv,
  resetTestDirs,
  walletDbPath,
  removePossibleSidecars,
  assertRejectsCode,
} = require("./_util");

(async () => {
  console.log("🚀 TESTE WALLET 05: open missing sidecar must fail");

  const cfg = cfgFromEnv();
  resetTestDirs(cfg);

  const { IndyAgent } = loadNative();
  const agent = new IndyAgent();

  const name = "w05";
  const db = walletDbPath(cfg, name);

  console.log("1) wallet_create...");
  await agent.walletCreate(db, cfg.WALLET_PASS);
  await agent.walletClose();

  console.log("2) removendo sidecar (para simular ausência)...");
  // ✅ Se você souber o nome exato do sidecar, pode fazer:
  // fs.rmSync(db + ".sidecar.json", { force: true });
  removePossibleSidecars(cfg, name);

  console.log("3) wallet_open deve falhar com KdfParamsMissing...");
  await assertRejectsCode(
    () => agent.walletOpen(db, cfg.WALLET_PASS),
    "KdfParamsMissing"
  );

  console.log("✅ OK: TESTE WALLET 05 passou.\n");
})().catch((e) => {
  console.error("❌ FALHA TESTE WALLET 05:", e);
  process.exit(1);
});
