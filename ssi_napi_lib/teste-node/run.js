const fs = require("fs");
const path = require("path");
const { cfg, logStep, ensureDir, cleanupWalletFiles } = require("./_helpers");

ensureDir("./wallets");

if (cfg.RESET_WALLET) {
  logStep("🧹 RESET_WALLET=1: removendo wallets A e B...");
  cleanupWalletFiles(cfg.WALLET_PATH_A);
  cleanupWalletFiles(cfg.WALLET_PATH_B);
}

function listTestFiles(dir) {
  const full = path.resolve(__dirname, dir);
  const files = fs.readdirSync(full)
    .filter(f => f.endsWith(".test.js"))
    .sort()
    .map(f => path.join(full, f));
  return files;
}

async function run() {
  console.log("🚀 DID test suite");
  console.log("Config:", {
    genesisFile: cfg.GENESIS_FILE,
    walletPath: cfg.WALLET_PATH,
    flags: {
      RUN_SUITE: cfg.RUN_SUITE,
      RESET_WALLET: cfg.RESET_WALLET,
      TEST_LEDGER: cfg.TEST_LEDGER,
    }
  });

  ensureDir(path.dirname(cfg.WALLET_PATH));

  if (cfg.RESET_WALLET) {
    logStep("🧹 RESET_WALLET=1: removendo wallet + sidecar...");
    cleanupWalletFiles(cfg.WALLET_PATH);
  }

  const tests = [
    ...listTestFiles("did"),
  ];

  const results = [];
  for (const file of tests) {
    const name = path.basename(file);
    try {
      logStep(`\n▶ ${name}`);
      const testFn = require(file);
      await testFn();
      logStep(`✅ ${name}`);
      results.push({ test: name, ok: true });
    } catch (e) {
      logStep(`❌ ${name}`);
      logStep(String(e && e.stack ? e.stack : e));
      results.push({ test: name, ok: false, err: String(e?.message || e) });
    }
  }

  console.log("\nRESULTS:");
  for (const r of results) {
    console.log(`- ${r.ok ? "OK" : "FAIL"}: ${r.test}${r.ok ? "" : " :: " + r.err}`);
  }

  const failed = results.filter(r => !r.ok).length;
  process.exit(failed ? 1 : 0);
}

run().catch((e) => {
  console.error("Runner error:", e);
  process.exit(1);
});
