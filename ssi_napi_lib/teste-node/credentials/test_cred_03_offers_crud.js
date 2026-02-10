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

(async () => {
  const IndyAgent = loadIndyAgent();

  const pass = process.env.WALLET_PASS || "minha_senha_teste";
  const walletDir = path.join(__dirname, "..", "wallets");
  fs.mkdirSync(walletDir, { recursive: true });

  const issuerDb = process.env.WALLET_ISSUER || path.join(walletDir, "test_wallet_cred_issuer.db");
  const genesisAbs = path.join(process.cwd(), NETWORK_CONFIG.genesisFile);

  console.log("🚀 TESTE CRED 03: CRUD offers (create/list/delete)");
  console.log("Config:", { issuerDb, genesisAbs });

  await downloadGenesisHttp(NETWORK_CONFIG.genesisUrl, genesisAbs);

  const issuer = new IndyAgent();
  await walletCreateOpenIdempotent(issuer, issuerDb, pass);

  try {
    await issuer.connectNetwork(genesisAbs);

    const importDidFromSeed = fn(issuer, "importDidFromSeed", "import_did_from_seed");
    const [issuerDid] = await importDidFromSeed(NETWORK_CONFIG.trusteeSeed);
    assert(issuerDid === NETWORK_CONFIG.trusteeDid, "Trustee DID inesperado");

    const createAndRegisterSchema = fn(issuer, "createAndRegisterSchema", "create_and_register_schema");
    const createAndRegisterCredDef = fn(issuer, "createAndRegisterCredDef", "create_and_register_cred_def");

    const schemaId = await createAndRegisterSchema(
      genesisAbs,
      issuerDid,
      `SchemaOfferCrud_${Date.now()}`,
      `1.${Math.floor(Date.now() / 1000)}`,
      ["nome", "cpf", "idade"]
    );

    const credDefId = await createAndRegisterCredDef(
      genesisAbs,
      issuerDid,
      schemaId,
      `TAG_OFFER_${Math.floor(Date.now() / 1000)}`
    );

    const createCredentialOffer = fn(issuer, "createCredentialOffer", "create_credential_offer");
    const listCredentialOffers = fn(issuer, "listCredentialOffers", "list_credential_offers");
    const deleteCredentialOffer = fn(issuer, "deleteCredentialOffer", "delete_credential_offer");

    const offerLocalId = `offer-crud-${Date.now()}`;

    console.log("1) create_credential_offer...");
    const offerJson = await createCredentialOffer(credDefId, offerLocalId);
    assert(typeof offerJson === "string" && offerJson.length > 20, "offerJson inválido");

    console.log("2) list_credential_offers...");
    const listJson = await listCredentialOffers();
    const arr = parseJsonSafe(listJson, "list_credential_offers");
    assert(Array.isArray(arr), "list não retornou array");
    assert(arr.some((x) => x && x.id_local === offerLocalId), "offer criada não apareceu no list");

    console.log("3) delete_credential_offer...");
    const ok = await deleteCredentialOffer(offerLocalId);
    assert(ok === true, "delete_credential_offer retornou false");

    console.log("4) list_credential_offers (pós-delete)...");
    const listJson2 = await listCredentialOffers();
    const arr2 = parseJsonSafe(listJson2, "list_credential_offers pós-delete");
    assert(!arr2.some((x) => x && x.id_local === offerLocalId), "offer ainda aparece após delete");

    console.log("✅ OK: TESTE CRED 03 passou.");
  } finally {
    try { await issuer.walletClose(); } catch {}
  }
})().catch((e) => {
  console.error("❌ FALHA TESTE CRED 03:", e && e.stack ? e.stack : e);
  process.exit(1);
});
