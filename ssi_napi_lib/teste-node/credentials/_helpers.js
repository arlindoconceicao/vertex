const fs = require("fs");
const path = require("path");
const http = require("http");

const NETWORK_CONFIG = {
  genesisUrl: "http://localhost:9000/genesis",
  genesisFile: "./von_genesis.txn",
  trusteeSeed: "000000000000000000000000Trustee1",
  trusteeDid: "V4SGRU86Z58d6TV7PBUe6f",
};

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assertion failed");
}

function rmIfExists(p) {
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch {}
}

function isWalletAlreadyExists(err) {
  const msg = String(err && err.message ? err.message : err);
  if (msg.includes("WalletAlreadyExists")) return true;
  if (msg.includes("wallet já existe")) return true;
  try {
    const obj = JSON.parse(msg);
    return obj && (obj.code === "WalletAlreadyExists" || String(obj.message || "").includes("wallet já existe"));
  } catch {
    return false;
  }
}

function isWalletAuthFailed(err) {
  const msg = String(err && err.message ? err.message : err);
  if (msg.includes("WalletAuthFailed")) return true;
  if (msg.includes("Senha incorreta")) return true;
  try {
    const obj = JSON.parse(msg);
    return obj && (obj.code === "WalletAuthFailed" || String(obj.message || "").includes("Senha incorreta"));
  } catch {
    return false;
  }
}

function downloadGenesisHttp(url, destAbs) {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(destAbs)) {
      console.log("📂 Genesis já existe, pulando download.");
      return resolve(true);
    }
    fs.mkdirSync(path.dirname(destAbs), { recursive: true });
    const file = fs.createWriteStream(destAbs);
    console.log(`⏳ Baixando Genesis de: ${url}...`);
    http
      .get(url, (res) => {
        if (res.statusCode !== 200) return reject(new Error(`Erro HTTP: ${res.statusCode}`));
        res.pipe(file);
        file.on("finish", () => file.close(() => { console.log("✅ Genesis baixado."); resolve(true); }));
      })
      .on("error", (err) => {
        try { fs.unlinkSync(destAbs); } catch {}
        reject(err);
      });
  });
}

function loadIndyAgent() {
  try {
    return require(path.join(process.cwd(), "index.js")).IndyAgent;
  } catch {
    return require(path.join(process.cwd(), "index.node")).IndyAgent;
  }
}

function fn(agent, camel, snake) {
  const f = agent[camel] || agent[snake];
  if (!f) throw new Error(`Método não encontrado no binding: ${camel} / ${snake}`);
  return f.bind(agent);
}

function parseJsonSafe(s, label = "json") {
  try {
    return JSON.parse(s);
  } catch (e) {
    throw new Error(`Falha parse ${label}: ${e.message}\nConteúdo: ${String(s).slice(0, 400)}`);
  }
}

async function walletCreateOpenIdempotent(agent, dbPath, pass, { resetOnAuthFail = true } = {}) {
  if (!fs.existsSync(dbPath)) {
    await agent.walletCreate(dbPath, pass);
    await agent.walletOpen(dbPath, pass);
    return;
  }

  try {
    await agent.walletOpen(dbPath, pass);
  } catch (e) {
    if (!resetOnAuthFail || !isWalletAuthFailed(e)) throw e;
    console.log("⚠️ Wallet com senha diferente. Resetando para padronizar...");
    rmIfExists(dbPath);
    rmIfExists(dbPath + ".sidecar");
    rmIfExists(dbPath + ".kdf.json");
    await agent.walletCreate(dbPath, pass);
    await agent.walletOpen(dbPath, pass);
  }
}

function extractNonce(offerJson) {
  const obj = parseJsonSafe(offerJson, "offer_json");
  const nonce = obj.nonce;
  assert(typeof nonce === "string" && nonce.length > 0, "offer_json sem nonce");
  return nonce;
}

module.exports = {
  NETWORK_CONFIG,
  assert,
  rmIfExists,
  isWalletAlreadyExists,
  isWalletAuthFailed,
  downloadGenesisHttp,
  loadIndyAgent,
  fn,
  parseJsonSafe,
  walletCreateOpenIdempotent,
  extractNonce,
};
