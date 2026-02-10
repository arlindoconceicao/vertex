const fs = require("fs");
const path = require("path");
const cfg = require("./config");

function logStep(msg) {
  console.log(msg);
}

function exists(p) {
  try { fs.accessSync(p); return true; } catch { return false; }
}

function rmFile(p) {
  try { fs.unlinkSync(p); } catch {}
}

function cleanupWalletFiles(walletPath) {
  rmFile(walletPath);
  rmFile(walletPath + "-wal");
  rmFile(walletPath + "-shm");

  const sidecar = walletPath + ".sidecar.json";
  rmFile(sidecar);
  rmFile(sidecar + ".tmp");
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function ensureGenesis() {
  if (!exists(cfg.GENESIS_FILE)) {
    throw new Error(`Genesis não encontrado: ${cfg.GENESIS_FILE}`);
  }
}

function loadBinding() {
  if (!exists(cfg.BINDING_PATH)) {
    throw new Error(`Binding não encontrado: ${cfg.BINDING_PATH}`);
  }
  return require(cfg.BINDING_PATH);
}

async function openOrCreateWallet(agent, walletPath, walletPass) {
  // tenta abrir; se falhar, cria e abre
  try {
    await agent.wallet_open(walletPath, walletPass);
    return { created: false, opened: true };
  } catch (e) {
    await agent.wallet_create(walletPath, walletPass);
    await agent.wallet_open(walletPath, walletPass);
    return { created: true, opened: true };
  }
}

async function withAgent(fn, options = {}) {
  const binding = loadBinding();
  const agent = new binding.IndyAgent();

  const walletPath = options.walletPath || cfg.WALLET_PATH;
  const walletPass = options.walletPass || cfg.WALLET_PASS;

  ensureDir(path.dirname(walletPath));

  // abre ou cria
  await openOrCreateWallet(agent, walletPath, walletPass);

  try {
    return await fn({ agent, binding, walletPath, walletPass });
  } finally {
    // sempre fecha wallet
    try { await agent.wallet_close(); } catch {}
  }
}

function randSeed32Hex() {
  const buf = Buffer.alloc(32);
  for (let i = 0; i < 32; i++) buf[i] = Math.floor(Math.random() * 256);
  return buf.toString("hex");
}

module.exports = {
  cfg,
  logStep,
  ensureGenesis,
  ensureDir,
  cleanupWalletFiles,
  withAgent,
  randSeed32Hex,
};
