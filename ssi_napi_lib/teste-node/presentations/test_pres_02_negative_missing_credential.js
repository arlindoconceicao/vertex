const path = require("path");
const fs = require("fs");
const {
  NETWORK_CONFIG,
  assert,
  downloadGenesisHttp,
  loadIndyAgent,
  fn,
  walletCreateOpenIdempotent,
  parseJsonSafe,
} = require("./_helpers");

function isMissingCredErr(e) {
  const msg = String(e && e.message ? e.message : e);
  return msg.includes("nao achada") || msg.includes("não achada") || msg.includes("Cred ");
}

(async () => {
  const IndyAgent = loadIndyAgent();
  const pass = process.env.WALLET_PASS || "minha_senha_teste";

  const walletDir = path.join(__dirname, "..", "wallets");
  fs.mkdirSync(walletDir, { recursive: true });

  const issuerDb =
    process.env.WALLET_ISSUER || path.join(walletDir, "test_wallet_pres_issuer.db");
  const holderDb =
    process.env.WALLET_HOLDER || path.join(walletDir, "test_wallet_pres_holder.db");

  const genesisAbs = path.join(process.cwd(), NETWORK_CONFIG.genesisFile);

  console.log("🚀 TESTE PRES 02: negativo (cred_id inexistente no holder)");
  console.log("Config:", { issuerDb, holderDb, genesisAbs });

  await downloadGenesisHttp(NETWORK_CONFIG.genesisUrl, genesisAbs);

  const issuer = new IndyAgent();
  const holder = new IndyAgent();

  await walletCreateOpenIdempotent(issuer, issuerDb, pass);
  await walletCreateOpenIdempotent(holder, holderDb, pass);

  try {
    await issuer.connectNetwork(genesisAbs);
    await holder.connectNetwork(genesisAbs);

    const importDidFromSeed = fn(issuer, "importDidFromSeed", "import_did_from_seed");
    const [issuerDid] = await importDidFromSeed(NETWORK_CONFIG.trusteeSeed);
    assert(issuerDid === NETWORK_CONFIG.trusteeDid, "Trustee DID inesperado");

    const createAndRegisterSchema = fn(issuer, "createAndRegisterSchema", "create_and_register_schema");
    const createAndRegisterCredDef = fn(issuer, "createAndRegisterCredDef", "create_and_register_cred_def");
    const fetchSchemaFromLedger = fn(issuer, "fetchSchemaFromLedger", "fetch_schema_from_ledger");
    const fetchCredDefFromLedger = fn(issuer, "fetchCredDefFromLedger", "fetch_cred_def_from_ledger");

    const schemaId = await createAndRegisterSchema(
      genesisAbs,
      issuerDid,
      `SchemaNegMissingCred_${Date.now()}`,
      `1.${Math.floor(Date.now() / 1000)}`,
      ["nome", "cpf", "idade"]
    );
    const credDefId = await createAndRegisterCredDef(
      genesisAbs,
      issuerDid,
      schemaId,
      `TAG_NEG_${Math.floor(Date.now() / 1000)}`
    );

    const schemaLedgerObj = parseJsonSafe(await fetchSchemaFromLedger(genesisAbs, schemaId));
    const credDefLedgerObj = parseJsonSafe(await fetchCredDefFromLedger(genesisAbs, credDefId));

    const createPresentation = fn(holder, "createPresentation", "create_presentation");

    const presReq = {
      nonce: String(Math.floor(Date.now() / 1000) * 1000000 + 999),
      name: "ProofReqNegMissingCred",
      version: "0.1",
      requested_attributes: { attr1_referent: { name: "nome" } },
      requested_predicates: {},
    };

    const reqCreds = {
      requested_attributes: {
        attr1_referent: { cred_id: "cred-inexistente-XYZ", revealed: true },
      },
      requested_predicates: {},
    };

    const schemasMap = { [schemaId]: schemaLedgerObj };
    const credDefsMap = { [credDefId]: credDefLedgerObj };

    try {
      await createPresentation(
        JSON.stringify(presReq),
        JSON.stringify(reqCreds),
        JSON.stringify(schemasMap),
        JSON.stringify(credDefsMap)
      );
      throw new Error("Esperava falha, mas create_presentation retornou sucesso.");
    } catch (e) {
      if (!isMissingCredErr(e)) throw e;
      console.log("✅ OK: erro esperado capturado:", String(e.message || e));
    }

    console.log("✅ OK: TESTE PRES 02 passou.");
  } finally {
    try { await issuer.walletClose(); } catch {}
    try { await holder.walletClose(); } catch {}
  }
})().catch((e) => {
  console.error("❌ FALHA TESTE PRES 02:", e && e.stack ? e.stack : e);
  process.exit(1);
});
