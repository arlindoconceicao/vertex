// teste-node/creddef/test_creddef_01_ledger_smoke.js

const fs = require("fs");
const path = require("path");
const http = require("http");

const NETWORK_CONFIG = {
  genesisUrl: "http://localhost:9000/genesis",
  genesisFile: "./von_genesis.txn",
  trusteeSeed: "000000000000000000000000Trustee1",
  trusteeDid: "V4SGRU86Z58d6TV7PBUe6f",
};

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
  try { fs.rmSync(p, { recursive: true, force: true }); } catch {}
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
    http.get(url, (res) => {
      if (res.statusCode !== 200) return reject(new Error(`Erro HTTP: ${res.statusCode}`));
      res.pipe(file);
      file.on("finish", () => file.close(() => { console.log("✅ Genesis baixado."); resolve(true); }));
    }).on("error", (err) => { try { fs.unlinkSync(destAbs); } catch {} reject(err); });
  });
}

function normalizeJsonStringOrObject(x, label) {
  if (typeof x === "string") return JSON.parse(x);
  if (x && typeof x === "object" && typeof x.json === "string") return JSON.parse(x.json);
  if (x && typeof x === "object") return x;
  throw new Error(`${label}: retorno inesperado (${typeof x})`);
}

// Compat: alguns bindings expõem snake_case, outros camelCase
function fn(agent, camel, snake) {
  const f = agent[camel] || agent[snake];
  if (!f) throw new Error(`Método não encontrado no binding: ${camel} / ${snake}`);
  return f.bind(agent);
}

(async () => {
  const agent = new IndyAgent();

  const pass = process.env.WALLET_PASS || "minha_senha_teste";
  const RESET_WALLET = process.env.RESET_WALLET === "1";

  const walletDir = path.join(__dirname, "..", "wallets");
  fs.mkdirSync(walletDir, { recursive: true });
  const dbPath = process.env.WALLET_PATH || path.join(walletDir, "test_wallet_creddef_01.db");

  const genesisAbs = path.join(process.cwd(), NETWORK_CONFIG.genesisFile);

  console.log("🚀 TESTE CREDDEF 01: ledger smoke (schema + creddef + fetch)");
  console.log("Config:", { dbPath, WALLET_PASS: "***", RESET_WALLET, genesisAbs });

  await downloadGenesisHttp(NETWORK_CONFIG.genesisUrl, genesisAbs);

  if (RESET_WALLET) {
    console.log("🧹 RESET_WALLET=1: removendo wallet artifacts...");
    rmIfExists(dbPath);
    rmIfExists(dbPath + ".sidecar");
    rmIfExists(dbPath + ".kdf.json");
  }

  // wallet (idempotente)
  if (!fs.existsSync(dbPath)) {
    console.log("1️⃣  Wallet não existe. Criando...");
    await agent.walletCreate(dbPath, pass);
  } else {
    console.log("1️⃣  Wallet existe. Abrindo...");
  }
  await agent.walletOpen(dbPath, pass);
  console.log("✅ Wallet aberta.");

  try {
    // pool
    console.log("2️⃣  Conectando ao Pool...");
    await agent.connectNetwork(genesisAbs);
    console.log("✅ Pool conectado.");

    // trustee
    console.log("3️⃣  Importando DID Trustee via seed...");
    const importDidFromSeed = fn(agent, "importDidFromSeed", "import_did_from_seed");
    const [issuerDid] = await importDidFromSeed(NETWORK_CONFIG.trusteeSeed);
    assert(issuerDid === NETWORK_CONFIG.trusteeDid, `Trustee DID inesperado: ${issuerDid}`);
    console.log("✅ Issuer DID:", issuerDid);

    // 4) criar schema (para obter schemaId)
    console.log("4️⃣  Registrando Schema (pré-requisito CredDef)...");
    const createAndRegisterSchema = fn(agent, "createAndRegisterSchema", "create_and_register_schema");

    const schemaName = `SchemaForCredDef_${Date.now()}`;
    const schemaVersion = `1.${Math.floor(Date.now() / 1000)}`;
    const schemaAttrs = ["nome", "cpf", "idade"];

    const schemaRet = await createAndRegisterSchema(genesisAbs, issuerDid, schemaName, schemaVersion, schemaAttrs);
    const schemaId = (typeof schemaRet === "string") ? schemaRet : schemaRet.schemaId;
    assert(typeof schemaId === "string" && schemaId.includes(":2:"), "schemaId inválido");
    console.log("✅ schemaId:", schemaId);

    // 5) criar creddef
    console.log("5️⃣  Registrando CredDef...");
    const createAndRegisterCredDef = fn(agent, "createAndRegisterCredDef", "create_and_register_cred_def");

    const tag = `TAG_${Math.floor(Date.now() / 1000)}`;
    const credDefId = await createAndRegisterCredDef(genesisAbs, issuerDid, schemaId, tag);
    assert(typeof credDefId === "string" && credDefId.includes(":3:CL:"), "credDefId inválido");
    console.log("✅ credDefId:", credDefId);

    // 6) fetch creddef
    console.log("6️⃣  Fetch CredDef do ledger (validação)...");
    const fetchCredDefFromLedger = fn(agent, "fetchCredDefFromLedger", "fetch_cred_def_from_ledger");
    const fetchedRaw = await fetchCredDefFromLedger(genesisAbs, credDefId);

    const payload = normalizeJsonStringOrObject(fetchedRaw, "fetchCredDefFromLedger");
    assert(payload && payload.result, "payload sem result");
    assert(payload.result.data && !payload.result.data.is_null, "result.data nulo (creddef não encontrada?)");

    // validação leve/útil: algum id/identificador deve aparecer
    const asStr = typeof fetchedRaw === "string" ? fetchedRaw : JSON.stringify(payload);
    assert(asStr.includes(credDefId) || asStr.includes(issuerDid) || asStr.includes(tag),
      "Resposta do ledger não parece conter identificadores da creddef");

    console.log("✅ Fetch OK: CredDef existe no ledger.");
  } finally {
    console.log("🔒 Fechando Wallet...");
    await agent.walletClose();
  }
})().catch((e) => {
  console.error("❌ FALHA TESTE CREDDEF 01:", e && e.stack ? e.stack : e);
  process.exit(1);
});
