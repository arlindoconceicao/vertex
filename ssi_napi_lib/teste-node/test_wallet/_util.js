// teste-node/test_wallet/_util.js
"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");

function loadNative() {
  const path = require("path");
  const mod = require(path.join(__dirname, "..", "..", "index.node"));
  return mod;
}

function cfgFromEnv() {
  const WALLET_PASS = process.env.WALLET_PASS || "minha_senha_teste";
  const RESET_WALLET = process.env.RESET_WALLET === "1";

  const baseDir = __dirname;
  const walletsDir = path.join(baseDir, "wallets");
  const outDir = path.join(baseDir, "out");

  return { WALLET_PASS, RESET_WALLET, baseDir, walletsDir, outDir };
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function rmrf(target) {
  if (!fs.existsSync(target)) return;
  fs.rmSync(target, { recursive: true, force: true });
}

function resetTestDirs(cfg) {
  ensureDir(cfg.walletsDir);
  ensureDir(cfg.outDir);
  if (cfg.RESET_WALLET) {
    rmrf(cfg.walletsDir);
    rmrf(cfg.outDir);
    ensureDir(cfg.walletsDir);
    ensureDir(cfg.outDir);
  }
}

function walletDbPath(cfg, name) {
  return path.join(cfg.walletsDir, `${name}.db`);
}

// Se o seu sidecar tiver um nome diferente internamente, este helper serve só
// para testes que verificam "sidecar ausente" removendo qualquer arquivo
// parecido com sidecar na pasta.
function removePossibleSidecars(cfg, walletName) {
  const prefix = `${walletName}.db`;
  const files = fs.readdirSync(cfg.walletsDir);
  for (const f of files) {
    // Remove qualquer arquivo "relacionado" ao db que não seja o próprio db
    // (cobre padrões comuns: .sidecar, .json, .kdf, etc.)
    if (f.startsWith(prefix) && f !== `${walletName}.db`) {
      rmrf(path.join(cfg.walletsDir, f));
    }
  }
}

async function assertRejectsCode(promiseFactory, expectedCode) {
  let err = null;
  try {
    await promiseFactory();
  } catch (e) {
    err = e;
  }
  assert(err, "Esperava falha, mas não falhou.");

  // 1) tenta ler code real do JSON dentro de err.message
  let inner = null;
  if (typeof err.message === "string") {
    const m = err.message.trim();
    if (m.startsWith("{") && m.endsWith("}")) {
      try {
        inner = JSON.parse(m);
      } catch (_) {
        inner = null;
      }
    }
  }

  const got =
    (inner && typeof inner.code === "string" && inner.code) ||
    (typeof err.code === "string" && err.code) ||
    "Unknown";

  assert.strictEqual(
    got,
    expectedCode,
    `Código esperado=${expectedCode}, recebido=${got}. ` +
      `err.code=${err.code} err.message=${err.message}`
  );
}

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(raw);
}

function writeJson(filePath, obj) {
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), "utf-8");
}

module.exports = {
  loadNative,
  cfgFromEnv,
  ensureDir,
  rmrf,
  resetTestDirs,
  walletDbPath,
  removePossibleSidecars,
  assertRejectsCode,
  readJson,
  writeJson,
};
