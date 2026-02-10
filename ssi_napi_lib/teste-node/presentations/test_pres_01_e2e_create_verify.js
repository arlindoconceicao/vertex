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
  extractNonce,
} = require("./_helpers");

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

(async () => {
  const IndyAgent = loadIndyAgent();

  const pass = process.env.WALLET_PASS || "minha_senha_teste";
  const RESET = process.env.RESET_WALLET === "1";

  const walletDir = path.join(__dirname, "..", "wallets");
  fs.mkdirSync(walletDir, { recursive: true });

  const issuerDb =
    process.env.WALLET_ISSUER || path.join(walletDir, "test_wallet_pres_issuer.db");
  const holderDb =
    process.env.WALLET_HOLDER || path.join(walletDir, "test_wallet_pres_holder.db");

  const genesisAbs = path.join(process.cwd(), NETWORK_CONFIG.genesisFile);

  console.log("🚀 TESTE PRES 01: E2E create + verify presentation");
  console.log("Config:", {
    issuerDb,
    holderDb,
    WALLET_PASS: "***",
    RESET_WALLET: RESET,
    genesisAbs,
  });

  await downloadGenesisHttp(NETWORK_CONFIG.genesisUrl, genesisAbs);

  if (RESET) {
    for (const p of [issuerDb, holderDb, issuerDb + ".sidecar", holderDb + ".sidecar", issuerDb + ".kdf.json", holderDb + ".kdf.json"]) {
      try { fs.rmSync(p, { force: true }); } catch {}
    }
  }

  const issuer = new IndyAgent();
  const holder = new IndyAgent();

  await walletCreateOpenIdempotent(issuer, issuerDb, pass);
  await walletCreateOpenIdempotent(holder, holderDb, pass);

  try {
    // Conecta no ledger
    await issuer.connectNetwork(genesisAbs);
    await holder.connectNetwork(genesisAbs);

    // Trustee DID (issuer)
    const importDidFromSeed = fn(issuer, "importDidFromSeed", "import_did_from_seed");
    const [issuerDid] = await importDidFromSeed(NETWORK_CONFIG.trusteeSeed);
    assert(issuerDid === NETWORK_CONFIG.trusteeDid, `Trustee DID inesperado: ${issuerDid}`);
    console.log("✅ Issuer DID:", issuerDid);

    // Registrar schema + creddef
    const createAndRegisterSchema = fn(issuer, "createAndRegisterSchema", "create_and_register_schema");
    const createAndRegisterCredDef = fn(issuer, "createAndRegisterCredDef", "create_and_register_cred_def");

    const schemaName = `SchemaForPresentation_${Date.now()}`;
    const schemaVersion = `1.${nowSec()}`;
    const attrs = ["nome", "cpf", "idade"];

    console.log("1) Registrando Schema...");
    const schemaId = await createAndRegisterSchema(genesisAbs, issuerDid, schemaName, schemaVersion, attrs);
    console.log("✅ schemaId:", schemaId);

    console.log("2) Registrando CredDef...");
    const tag = `TAG_PRES_${nowSec()}`;
    const credDefId = await createAndRegisterCredDef(genesisAbs, issuerDid, schemaId, tag);
    console.log("✅ credDefId:", credDefId);

    // Fetch schema + creddef do ledger (para alimentar create/verify)
    const fetchSchemaFromLedger = fn(issuer, "fetchSchemaFromLedger", "fetch_schema_from_ledger");
    const fetchCredDefFromLedger = fn(issuer, "fetchCredDefFromLedger", "fetch_cred_def_from_ledger");

    console.log("3) Fetch Schema do ledger...");
    const schemaLedgerJson = await fetchSchemaFromLedger(genesisAbs, schemaId);
    const schemaLedgerObj = parseJsonSafe(schemaLedgerJson, "schemaLedgerJson");

    console.log("4) Fetch CredDef do ledger...");
    const credDefLedgerJson = await fetchCredDefFromLedger(genesisAbs, credDefId);
    const credDefLedgerObj = parseJsonSafe(credDefLedgerJson, "credDefLedgerJson");

    // Issuer: offer
    const createCredentialOffer = fn(issuer, "createCredentialOffer", "create_credential_offer");
    const offerLocalId = `offer-pres-${Date.now()}`;

    console.log("5) Issuer criando Offer...");
    const offerJson = await createCredentialOffer(credDefId, offerLocalId);

    // Holder: link secret default
    const createLinkSecret = fn(holder, "createLinkSecret", "create_link_secret");
    console.log('6) Holder createLinkSecret("default")...');
    await createLinkSecret("default");

    // Holder: DID válido para prover_did (obrigatório JSON string)
    const createDidV2 = fn(holder, "createDidV2", "create_did_v2");
    console.log('7) Holder criando DID v2 via createDidV2("{}")...');
    const didRaw = await createDidV2("{}");
    const didObj = typeof didRaw === "string" ? JSON.parse(didRaw) : didRaw;
    const holderDid = didObj.did || didObj.myDid || didObj.id;
    assert(typeof holderDid === "string" && holderDid.length > 10, "holderDid inválido");
    console.log("✅ Holder DID:", holderDid);

    // Holder: request (persiste metadata com ID=nonce)
    const createCredentialRequest = fn(holder, "createCredentialRequest", "create_credential_request");

    console.log("8) Holder criando Credential Request...");
    const requestJson = await createCredentialRequest("default", holderDid, JSON.stringify(credDefLedgerObj), offerJson);

    const nonce = extractNonce(offerJson);
    const requestMetadataId = nonce;

    // Issuer: create credential
    const createCredential = fn(issuer, "createCredential", "create_credential");
    const values = { nome: "Alice", cpf: "12345678900", idade: "29" };

    console.log("9) Issuer emitindo credential...");
    const credentialJson = await createCredential(credDefId, offerJson, requestJson, JSON.stringify(values));

    // Holder: store credential
    const storeCredential = fn(holder, "storeCredential", "store_credential");
    const credentialId = `cred-pres-${Date.now()}`;

    console.log("10) Holder store_credential...");
    const storedId = await storeCredential(
      credentialId,
      credentialJson,
      requestMetadataId,
      JSON.stringify(credDefLedgerObj),
      null
    );
    assert(storedId === credentialId, "store_credential não retornou o id esperado");
    console.log("✅ Credential armazenada:", storedId);

    // ---------------- PRESENTATION ----------------
    const createPresentation = fn(holder, "createPresentation", "create_presentation");
    const verifyPresentation = fn(issuer, "verifyPresentation", "verify_presentation");

    // PresentationRequest simples (requested_attributes com 2 atributos)
    const presReq = {
      nonce: String(Math.floor(Date.now() / 1000) * 1000000 + 12345),
      name: "ProofReqSmoke",
      version: "0.1",
      requested_attributes: {
        attr1_referent: { name: "nome" },
        attr2_referent: { name: "cpf" },
      },
      requested_predicates: {},
    };

    // requested_credentials_json no formato que seu Rust espera
    const reqCreds = {
      requested_attributes: {
        attr1_referent: { cred_id: credentialId, revealed: true },
        attr2_referent: { cred_id: credentialId, revealed: false },
      },
      requested_predicates: {},
    };

    const schemasMap = { [schemaId]: schemaLedgerObj };
    const credDefsMap = { [credDefId]: credDefLedgerObj };

    console.log("11) create_presentation...");
    const presentationJson = await createPresentation(
      JSON.stringify(presReq),
      JSON.stringify(reqCreds),
      JSON.stringify(schemasMap),
      JSON.stringify(credDefsMap)
    );
    assert(typeof presentationJson === "string" && presentationJson.length > 50, "presentation_json inválido");

    console.log("12) verify_presentation...");
    const ok = await verifyPresentation(
      JSON.stringify(presReq),
      presentationJson,
      JSON.stringify(schemasMap),
      JSON.stringify(credDefsMap)
    );
    assert(ok === true, "verify_presentation retornou false");
    console.log("✅ OK: presentation verificada com sucesso.");

    console.log("✅ OK: TESTE PRES 01 passou.");
  } finally {
    try { await issuer.walletClose(); } catch {}
    try { await holder.walletClose(); } catch {}
  }
})().catch((e) => {
  console.error("❌ FALHA TESTE PRES 01:", e && e.stack ? e.stack : e);
  process.exit(1);
});
