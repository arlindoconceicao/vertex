// teste-node/creddef/test_creddef_03_idempotent_same_tag.js

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

  console.log("🚀 TESTE CREDDEF 03: idempotência (mesmo schemaId + tag)");
  console.log("Config:", { dbPath, genesisAbs });

  assert(fs.existsSync(genesisAbs), "Genesis ausente (rode schema/creddef smoke antes).");
  assert(fs.existsSync(dbPath), "Wallet ausente (rode o teste 01 antes).");

  await agent.walletOpen(dbPath, pass);
  await agent.connectNetwork(genesisAbs);

  try {
    // Garantir trustee na wallet
    const importDidFromSeed = fn(agent, "importDidFromSeed", "import_did_from_seed");
    const [issuerDid] = await importDidFromSeed(NETWORK_CONFIG.trusteeSeed);
    assert(issuerDid === NETWORK_CONFIG.trusteeDid, `Trustee DID inesperado: ${issuerDid}`);

    // Criar um schema dedicado para o teste
    const createAndRegisterSchema = fn(agent, "createAndRegisterSchema", "create_and_register_schema");
    const schemaName = `SchemaForCredDefIdem_${Date.now()}`;
    const schemaVersion = `1.${Math.floor(Date.now() / 1000)}`;
    const schemaAttrs = ["nome", "cpf", "idade"];
    const schemaId = await createAndRegisterSchema(genesisAbs, issuerDid, schemaName, schemaVersion, schemaAttrs);

    const createAndRegisterCredDef = fn(agent, "createAndRegisterCredDef", "create_and_register_cred_def");

    // Tag FIXA para forçar idempotência
    const tag = "TAG_IDEMPOTENTE_FIXA";

    console.log("1) createAndRegisterCredDef #1 ...");
    const id1 = await createAndRegisterCredDef(genesisAbs, issuerDid, schemaId, tag);
    console.log("   credDefId1:", id1);

    console.log("2) createAndRegisterCredDef #2 (mesmo schemaId+tag) ...");
    const id2 = await createAndRegisterCredDef(genesisAbs, issuerDid, schemaId, tag);
    console.log("   credDefId2:", id2);

    assert(id1 === id2, `Idempotência falhou: id1!=id2 (${id1} vs ${id2})`);

    console.log("✅ OK: idempotência confirmada (mesmo credDefId).");
  } finally {
    await agent.walletClose();
  }
})().catch((e) => {
  console.error("❌ FALHA TESTE CREDDEF 03:", e && e.stack ? e.stack : e);
  process.exit(1);
});
