// teste_test_connection.js
const { IndyAgent } = require("./index.node");
const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");

function parseNapiError(e) {
  const msg = (e && e.message) ? String(e.message) : String(e);
  try {
    const j = JSON.parse(msg);
    if (j && typeof j === "object") return j;
  } catch {}
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

async function testConnection(cfg) {
  const out = { ok: false, code: null, message: null };

  try {
    // 1) Garantir genesis no disco
    if (!fs.existsSync(cfg.genesisFilePath)) {
      if (!cfg.genesisUrl) {
        throw new Error("Genesis não existe no disco e GENESIS_URL não foi informado.");
      }
      console.log(`⏳ Baixando genesis de: ${cfg.genesisUrl}`);
      await downloadFile(cfg.genesisUrl, cfg.genesisFilePath);
      console.log("✅ Genesis baixado.");
    } else {
      console.log("📂 Genesis já existe:", cfg.genesisFilePath);
    }

    const agent = new IndyAgent();

    // 2) Wallet: create ou open
    if (cfg.createWallet) {
      console.log("1) Criando wallet...");
      await agent.walletCreate(cfg.walletPath, cfg.walletPass);
      console.log("✅ Wallet criada.");
    }

    console.log("2) Abrindo wallet...");
    await agent.walletOpen(cfg.walletPath, cfg.walletPass);
    console.log("✅ Wallet aberta.");

    // 3) Conectar pool
    console.log("3) Conectando no ledger...");
    await agent.connectNetwork(cfg.genesisFilePath);
    console.log("✅ Pool conectado.");

    // 4) Healthcheck
    console.log("4) Healthcheck...");
    await agent.networkHealthcheck();
    console.log("✅ Healthcheck OK.");

    out.ok = true;
    out.code = "OK";
    out.message = "Conexão OK (wallet + pool + healthcheck).";
    return out;
  } catch (e) {
    const pe = parseNapiError(e);
    out.ok = false;
    out.code = pe.code || "GenericFailure";
    out.message = pe.message || String(e);
    return out;
  }
}

async function main() {
  // Env/config
  const cfg = {
    genesisUrl: process.env.GENESIS_URL || "",

    // onde salvar no disco
    genesisFilePath: process.env.GENESIS_FILE || "./genesis.txn",

    // wallet
    walletPath: process.env.WALLET_PATH || "./wallets/test_wallet.db",
    walletPass: process.env.WALLET_PASS || "senha-teste-123",

    // se 1, chama walletCreate antes
    createWallet: process.env.CREATE_WALLET === "1",
  };

  console.log("🚀 teste_test_connection");
  console.log("Config:", {
    genesisUrl: cfg.genesisUrl,
    genesisFilePath: cfg.genesisFilePath,
    walletPath: cfg.walletPath,
    createWallet: cfg.createWallet,
  });

  const res = await testConnection(cfg);
  console.log("\nRESULT:", JSON.stringify(res, null, 2));

  process.exit(res.ok ? 0 : 1);
}

main();
