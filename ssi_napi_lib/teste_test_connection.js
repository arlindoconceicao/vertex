// teste_test_connection.js
const { IndyAgent } = require("./index.node");
const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");

function parseNapiError(e) {
  const msg = (e && e.message) ? String(e.message) : String(e);

  // 1) JSON puro
  try {
    const j = JSON.parse(msg);
    if (j && typeof j === "object") return j;
  } catch {}

  // 2) JSON embutido dentro do message: 'Error: {...}'
  const start = msg.indexOf("{");
  const end = msg.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const maybe = msg.slice(start, end + 1);
    try {
      const j = JSON.parse(maybe);
      if (j && typeof j === "object") return j;
    } catch {}
  }

  return { ok: false, code: "GenericFailure", message: msg };
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith("https://") ? https : http;

    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    const file = fs.createWriteStream(destPath);

    proto
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`Falha ao baixar genesis: HTTP ${res.statusCode}`));
          res.resume();
          return;
        }
        res.pipe(file);
        file.on("finish", () => file.close(() => resolve(true)));
      })
      .on("error", (err) => {
        try { fs.unlinkSync(destPath); } catch {}
        reject(err);
      });
  });
}

function sidecarPathFor(walletPath) {
  return `${walletPath}.kdf.json`;
}

function removeIfExists(p) {
  try {
    if (fs.existsSync(p)) fs.rmSync(p, { force: true });
  } catch {}
}

async function ensureGenesis(cfg) {
  if (!fs.existsSync(cfg.genesisFilePath)) {
    if (!cfg.genesisUrl) {
      throw new Error("Genesis não existe no disco e GENESIS_URL não foi informado.");
    }
    console.log(`⏳ Baixando genesis: ${cfg.genesisUrl}`);
    await downloadFile(cfg.genesisUrl, cfg.genesisFilePath);
    console.log("✅ Genesis baixado.");
  } else {
    console.log("📂 Genesis já existe:", cfg.genesisFilePath);
  }
}

async function resetWalletFiles(cfg) {
  const sc = sidecarPathFor(cfg.walletPath);
  console.log("🧹 RESET_WALLET=1: removendo wallet + sidecar...");
  removeIfExists(cfg.walletPath);
  removeIfExists(sc);

  // também remove -wal / -shm se existirem
  removeIfExists(`${cfg.walletPath}-wal`);
  removeIfExists(`${cfg.walletPath}-shm`);
}

async function createAndOpenWallet(cfg) {
  const agent = new IndyAgent();

  console.log("1) Criando wallet...");
  await agent.walletCreate(cfg.walletPath, cfg.walletPass);
  console.log("✅ Wallet criada.");

  console.log("2) Abrindo wallet...");
  await agent.walletOpen(cfg.walletPath, cfg.walletPass);
  console.log("✅ Wallet aberta.");

  // fecha para evitar lock
  try { await agent.walletClose(); } catch {}
  return true;
}

async function runHappyPath(cfg) {
  const agent = new IndyAgent();

  await ensureGenesis(cfg);

  console.log("2) Abrindo wallet...");
  await agent.walletOpen(cfg.walletPath, cfg.walletPass);
  console.log("✅ Wallet aberta.");

  console.log("3) Conectando no ledger...");
  await agent.connectNetwork(cfg.genesisFilePath);
  console.log("✅ Pool conectado.");

  console.log("4) Healthcheck...");
  await agent.networkHealthcheck();
  console.log("✅ Healthcheck OK.");

  try { await agent.walletClose(); } catch {}
  return { ok: true, code: "OK", message: "Conexão OK (wallet + pool + healthcheck)." };
}

async function testWrongPassword(cfg) {
  const agent = new IndyAgent();
  console.log("🧪 TEST_WRONG_PASS=1: abrindo wallet com senha errada...");

  try {
    await agent.walletOpen(cfg.walletPath, cfg.walletPass + "_ERRADA");
    return { ok: false, code: "UnexpectedSuccess", message: "Era esperado falhar com senha errada, mas abriu." };
  } catch (e) {
    const pe = parseNapiError(e);
    return { ok: true, code: pe.code || "WalletOpenFailed", message: pe.message || String(e) };
  } finally {
    try { await agent.walletClose(); } catch {}
  }
}

async function testMissingSidecar(cfg) {
  const sc = sidecarPathFor(cfg.walletPath);
  const bak = `${sc}.bak`;

  console.log("🧪 TEST_MISSING_SIDECAR=1: removendo sidecar temporariamente...");

  if (!fs.existsSync(sc)) {
    return { ok: false, code: "SidecarNotFound", message: `Sidecar não existe: ${sc}` };
  }

  fs.renameSync(sc, bak);

  try {
    const agent = new IndyAgent();
    await agent.walletOpen(cfg.walletPath, cfg.walletPass);
    return { ok: false, code: "UnexpectedSuccess", message: "Era esperado falhar sem sidecar, mas abriu." };
  } catch (e) {
    const pe = parseNapiError(e);
    return { ok: true, code: pe.code || "KdfParamsMissing", message: pe.message || String(e) };
  } finally {
    // restaura
    fs.renameSync(bak, sc);
  }
}

async function testInvalidGenesis(cfg) {
  console.log("🧪 TEST_INVALID_GENESIS=1: conectando com genesis inválido...");
  const agent = new IndyAgent();

  try {
    await agent.walletOpen(cfg.walletPath, cfg.walletPass);
  } catch (e) {
    const pe = parseNapiError(e);
    return {
      ok: true,
      code: pe.code || "WalletOpenFailed",
      message: `Falhou antes do teste de genesis: ${pe.message || String(e)}`
    };
  }

  try {
    await agent.connectNetwork("./genesis_invalido.txn");
    return {
      ok: false,
      code: "UnexpectedSuccess",
      message: "Era esperado falhar com genesis inválido, mas conectou."
    };
  } catch (e) {
    const pe = parseNapiError(e);
    return {
      ok: true,
      code: pe.code || "InvalidGenesis",
      message: pe.message || String(e)
    };
  } finally {
    try { await agent.walletClose(); } catch {}
  }
}

async function main() {
  const cfg = {
    genesisUrl: process.env.GENESIS_URL || "",
    genesisFilePath: process.env.GENESIS_FILE || "./genesis.txn",

    walletPath: process.env.WALLET_PATH || "./wallets/test_wallet.db",
    walletPass: process.env.WALLET_PASS || "",
  };

  if (!cfg.walletPass) {
    console.log("❌ Defina WALLET_PASS para rodar os testes.");
    process.exit(1);
  }

  const flags = {
    suite: process.env.RUN_SUITE === "1",
    autoSetup: (process.env.AUTO_SETUP || "1") === "1",
    resetWallet: (process.env.RESET_WALLET || "1") === "1",

    wrongPass: process.env.TEST_WRONG_PASS === "1",
    missingSidecar: process.env.TEST_MISSING_SIDECAR === "1",
    invalidGenesis: process.env.TEST_INVALID_GENESIS === "1",
  };

  console.log("🚀 teste_test_connection");
  console.log("Config:", {
    genesisUrl: cfg.genesisUrl,
    genesisFilePath: cfg.genesisFilePath,
    walletPath: cfg.walletPath,
    flags,
  });

  const results = [];

  // AUTO SETUP: garante wallet “conhecida”
  if (flags.autoSetup) {
    if (flags.resetWallet) await resetWalletFiles(cfg);
    fs.mkdirSync(path.dirname(cfg.walletPath), { recursive: true });
    await createAndOpenWallet(cfg);
  }

  if (flags.suite) {
    // Suite completa (ordem importa)
    try {
      results.push({ test: "happy", ...(await runHappyPath(cfg)) });
    } catch (e) {
      const pe = parseNapiError(e);
      results.push({ test: "happy", ok: false, code: pe.code || "GenericFailure", message: pe.message || String(e) });
    }

    results.push({ test: "wrong_pass", ...(await testWrongPassword(cfg)) });
    results.push({ test: "missing_sidecar", ...(await testMissingSidecar(cfg)) });
    results.push({ test: "invalid_genesis", ...(await testInvalidGenesis(cfg)) });
  } else {
    // Comportamento anterior: roda conforme flags específicas; se nenhuma, roda happy.
    const anyNeg = flags.wrongPass || flags.missingSidecar || flags.invalidGenesis;

    if (!anyNeg) {
      try {
        results.push(await runHappyPath(cfg));
      } catch (e) {
        const pe = parseNapiError(e);
        results.push({ ok: false, code: pe.code || "GenericFailure", message: pe.message || String(e) });
      }
    } else {
      if (flags.wrongPass) results.push({ test: "wrong_pass", ...(await testWrongPassword(cfg)) });
      if (flags.missingSidecar) results.push({ test: "missing_sidecar", ...(await testMissingSidecar(cfg)) });
      if (flags.invalidGenesis) results.push({ test: "invalid_genesis", ...(await testInvalidGenesis(cfg)) });
    }
  }

  console.log("\nRESULTS:");
  console.log(JSON.stringify(results, null, 2));

  // Critério: suite => todos ok=true; single => ok do único
  const allOk = results.every(r => r.ok === true);
  process.exit(allOk ? 0 : 1);
}

main();
