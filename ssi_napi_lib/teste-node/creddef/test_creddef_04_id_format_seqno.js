// teste-node/creddef/test_creddef_04_id_format_seqno.js

const fs = require("fs");
const path = require("path");

let IndyAgent;
try { IndyAgent = require(path.join(process.cwd(), "index.js")).IndyAgent; }
catch { IndyAgent = require(path.join(process.cwd(), "index.node")).IndyAgent; }

const NETWORK_CONFIG = {
  genesisFile: "./von_genesis.txn",
  trusteeSeed: "000000000000000000000000Trustee1",
  trusteeDid: "V4SGRU86Z58d6TV7PBUe6f",
};

function assert(c, m) { if (!c) throw new Error(m); }

function fn(agent, camel, snake) {
  const f = agent[camel] || agent[snake];
  if (!f) throw new Error(`Método não encontrado: ${camel}/${snake}`);
  return f.bind(agent);
}

(async () => {
  const agent = new IndyAgent();
  const pass = process.env.WALLET_PASS || "minha_senha_teste";
  const dbPath = process.env.WALLET_PATH || path.join(__dirname, "..", "wallets", "test_wallet_creddef_01.db");
  const genesisAbs = path.join(process.cwd(), NETWORK_CONFIG.genesisFile);

  console.log("🚀 TESTE CREDDEF 04: formato do credDefId (seqNo + tag)");
  console.log("Config:", { dbPath, genesisAbs });

  assert(fs.existsSync(genesisAbs), "Genesis ausente.");
  assert(fs.existsSync(dbPath), "Wallet ausente.");

  await agent.walletOpen(dbPath, pass);
  await agent.connectNetwork(genesisAbs);

  try {
    const importDidFromSeed = fn(agent, "importDidFromSeed", "import_did_from_seed");
    const [issuerDid] = await importDidFromSeed(NETWORK_CONFIG.trusteeSeed);
    assert(issuerDid === NETWORK_CONFIG.trusteeDid, `Trustee DID inesperado: ${issuerDid}`);

    const createAndRegisterSchema = fn(agent, "createAndRegisterSchema", "create_and_register_schema");
    const schemaName = `SchemaForCredDefFmt_${Date.now()}`;
    const schemaVersion = `1.${Math.floor(Date.now() / 1000)}`;
    const schemaAttrs = ["nome", "cpf", "idade"];
    const schemaId = await createAndRegisterSchema(genesisAbs, issuerDid, schemaName, schemaVersion, schemaAttrs);

    const createAndRegisterCredDef = fn(agent, "createAndRegisterCredDef", "create_and_register_cred_def");
    const tag = `TAG_FMT_${Math.floor(Date.now() / 1000)}`;

    const credDefId = await createAndRegisterCredDef(genesisAbs, issuerDid, schemaId, tag);
    console.log("credDefId:", credDefId);

    // Esperado: issuer:3:CL:seqNo:tag
    const parts = String(credDefId).split(":");
    assert(parts.length >= 5, "credDefId não tem partes suficientes");

    const issuer = parts[0];
    const marker3 = parts[1];
    const cl = parts[2];
    const seqNoStr = parts[3];
    const tagGot = parts.slice(4).join(":"); // por segurança

    assert(issuer === issuerDid, `issuer no credDefId diferente: ${issuer} vs ${issuerDid}`);
    assert(marker3 === "3", "credDefId não contém ':3:'");
    assert(cl === "CL", "credDefId não contém ':CL:'");
    assert(tagGot === tag, `tag no credDefId diferente: ${tagGot} vs ${tag}`);

    const seqNo = Number(seqNoStr);
    assert(Number.isFinite(seqNo) && seqNo > 0, `seqNo inválido no credDefId: ${seqNoStr}`);

    console.log("✅ OK: formato do credDefId e seqNo validados.");
  } finally {
    await agent.walletClose();
  }
})().catch((e) => {
  console.error("❌ FALHA TESTE CREDDEF 04:", e && e.stack ? e.stack : e);
  process.exit(1);
});
