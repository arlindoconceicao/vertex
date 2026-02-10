const fs = require("fs");
const path = require("path");

let IndyAgent;
try {
  IndyAgent = require(path.join(process.cwd(), "index.js")).IndyAgent;
} catch {
  IndyAgent = require(path.join(process.cwd(), "index.node")).IndyAgent;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assertion failed");
}

function rmIfExists(p) {
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch {}
}

function normalizeFetchPayload(fetched) {
  if (typeof fetched === "string") return JSON.parse(fetched);
  if (fetched && typeof fetched === "object") {
    if (fetched.ok === true && typeof fetched.json === "string") return JSON.parse(fetched.json);
    return fetched;
  }
  throw new Error("fetchSchemaFromLedger retorno inesperado");
}

function isNotFoundError(err) {
  const msg = String(err && err.message ? err.message : err);
  if (msg.includes("não encontrado") || msg.includes("seqNo ausente")) return true;
  try {
    const obj = JSON.parse(msg);
    const m = String(obj.message || "");
    const c = String(obj.code || "");
    if (m.includes("não encontrado") || m.includes("seqNo ausente")) return true;
    if (c.toLowerCase().includes("notfound")) return true;
  } catch {}
  return false;
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

(async () => {
  const agent = new IndyAgent();

  // ✅ Senha padronizada
  const pass = process.env.WALLET_PASS || "minha_senha_teste";

  const dbPath =
    process.env.WALLET_PATH || path.join(__dirname, "..", "wallets", "test_wallet_schema_02.db");

  const genesisAbs = path.join(process.cwd(), "./von_genesis.txn");

  console.log("🚀 TESTE SCHEMA 03: ledger fetch negativo (schemaId inexistente)");
  console.log("Config:", { dbPath, genesisAbs });

  assert(fs.existsSync(genesisAbs), `Genesis não encontrado: ${genesisAbs}`);

  // 1) Garantir wallet abrível com senha padronizada
  // Se foi criada no passado com outra senha, resetamos.
  let opened = false;
  try {
    if (!fs.existsSync(dbPath)) {
      console.log("1️⃣  Wallet não existe. Criando...");
      await agent.walletCreate(dbPath, pass);
    }
    console.log("2️⃣  Abrindo wallet...");
    await agent.walletOpen(dbPath, pass);
    opened = true;
    console.log("✅ Wallet aberta.");
  } catch (e) {
    if (!isWalletAuthFailed(e)) throw e;

    console.log("⚠️ Wallet existe mas senha não bate (WalletAuthFailed). Resetando para padronizar...");
    rmIfExists(dbPath);
    rmIfExists(dbPath + ".sidecar");
    rmIfExists(dbPath + ".kdf.json");

    console.log("3️⃣  Recriando wallet com senha padronizada...");
    await agent.walletCreate(dbPath, pass);
    await agent.walletOpen(dbPath, pass);
    opened = true;
    console.log("✅ Wallet recriada e aberta.");
  }

  try {
    // 2) Conectar no ledger (necessário para o fetch)
    console.log("4️⃣  Conectando ao Pool...");
    await agent.connectNetwork(genesisAbs);
    console.log("✅ Pool conectado.");

    // 3) Fetch negativo
    const fakeSchemaId = "NcYxiDXkpYi6ov5FcYDi1e:2:DOES_NOT_EXIST:9.9.9";
    console.log("5️⃣  fetchSchemaFromLedger com schemaId inexistente:", fakeSchemaId);

    try {
      const fetchedRaw = await agent.fetchSchemaFromLedger(genesisAbs, fakeSchemaId);
      const payload = normalizeFetchPayload(fetchedRaw);

      assert(payload && payload.op, "payload sem 'op'");
      assert(payload.result, "payload sem 'result'");
      const data = payload.result.data;

      assert(!data, "Esperado schema inexistente (result.data null/undefined), mas veio data preenchido!");
      console.log("✅ OK: schema inexistente retornou sem data (result.data vazio).");
    } catch (e) {
      if (!isNotFoundError(e)) throw e;
      console.log("✅ OK: lib lançou erro de 'não encontrado' (comportamento esperado).");
      console.log("   mensagem:", String(e && e.message ? e.message : e));
    }
  } finally {
    if (opened) {
      console.log("🔒 Fechando Wallet...");
      await agent.walletClose();
    }
  }
})().catch((e) => {
  console.error("❌ FALHA TESTE SCHEMA 03:", e && e.stack ? e.stack : e);
  process.exit(1);
});
