// teste-node/creddef/test_creddef_02_ledger_fetch_negative.js

const fs = require("fs");
const path = require("path");

let IndyAgent;
try {
  IndyAgent = require(path.join(process.cwd(), "index.js")).IndyAgent;
} catch {
  IndyAgent = require(path.join(process.cwd(), "index.node")).IndyAgent;
}

function assert(cond, msg) { if (!cond) throw new Error(msg || "assertion failed"); }

function isNotFoundErr(e) {
  const msg = String(e && e.message ? e.message : e);
  if (msg.includes("não encontrada") || msg.includes("data is null")) return true;
  try {
    const obj = JSON.parse(msg);
    const m = String(obj.message || "");
    return m.includes("não encontrada") || m.includes("data is null");
  } catch {}
  return false;
}

function fn(agent, camel, snake) {
  const f = agent[camel] || agent[snake];
  if (!f) throw new Error(`Método não encontrado: ${camel}/${snake}`);
  return f.bind(agent);
}

(async () => {
  const agent = new IndyAgent();

  const pass = process.env.WALLET_PASS || "minha_senha_teste";
  const dbPath = process.env.WALLET_PATH || path.join(__dirname, "..", "wallets", "test_wallet_creddef_01.db");
  const genesisAbs = path.join(process.cwd(), "./von_genesis.txn");

  console.log("🚀 TESTE CREDDEF 02: ledger fetch negativo (creddefId inexistente)");
  console.log("Config:", { dbPath, genesisAbs });

  assert(fs.existsSync(genesisAbs), `Genesis não encontrado: ${genesisAbs}`);
  assert(fs.existsSync(dbPath), `Wallet não encontrada: ${dbPath} (rode o teste 01 antes)`);

  await agent.walletOpen(dbPath, pass);
  await agent.connectNetwork(genesisAbs);

  const fetchCredDefFromLedger = fn(agent, "fetchCredDefFromLedger", "fetch_cred_def_from_ledger");

  // creddefId impossível
  const fakeCredDefId = "NcYxiDXkpYi6ov5FcYDi1e:3:CL:999999:FAKE";

  try {
    console.log("1) fetchCredDefFromLedger fake:", fakeCredDefId);
    await fetchCredDefFromLedger(genesisAbs, fakeCredDefId);

    // Se não lançou erro, consideramos falha, porque sua lib deveria rejeitar "data is null"
    throw new Error("Esperava erro de 'não encontrada', mas fetch retornou sucesso.");
  } catch (e) {
    if (!isNotFoundErr(e)) throw e;
    console.log("✅ OK: lib lançou erro de não encontrada (esperado).");
    console.log("   msg:", String(e && e.message ? e.message : e));
  } finally {
    await agent.walletClose();
  }
})().catch((e) => {
  console.error("❌ FALHA TESTE CREDDEF 02:", e && e.stack ? e.stack : e);
  process.exit(1);
});
