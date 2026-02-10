const fs = require("fs");
const path = require("path");

// Mesma lógica do ssiService.js, mas sem Electron:
function loadIndyAgent() {
  const bindingsDir = path.join(__dirname, "..", "..", "bindings");
  const nodePath = path.join(bindingsDir, "index.node");
  const jsPath = path.join(bindingsDir, "index.js");

  let binding;
  try {
    if (fs.existsSync(nodePath)) binding = require(nodePath);
    else binding = require(jsPath);
  } catch (e) {
    // fallback inverso
    try { binding = require(jsPath); }
    catch { binding = require(nodePath); }
  }

  if (!binding || !binding.IndyAgent) {
    throw new Error("IndyAgent não encontrado no binding (bindings/index.node ou bindings/index.js).");
  }
  return binding.IndyAgent;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assertion failed");
}

function parseJsonSafe(s, label = "json") {
  try { return JSON.parse(s); }
  catch (e) { throw new Error(`Falha ao parsear ${label}: ${e.message}\nConteúdo: ${String(s).slice(0, 500)}`); }
}

function ensureFileExists(p, label = "arquivo") {
  if (!fs.existsSync(p)) throw new Error(`${label} não encontrado: ${p}`);
}

function rmIfExists(p) {
  try { fs.rmSync(p, { recursive: true, force: true }); } catch {}
}

module.exports = {
  loadIndyAgent,
  assert,
  parseJsonSafe,
  ensureFileExists,
  rmIfExists,
};
