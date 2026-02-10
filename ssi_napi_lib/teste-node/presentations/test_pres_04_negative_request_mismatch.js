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

function okNegativeVerify(resultOrErr) {
  // Se lançou erro: ok. Se retornou false: ok.
  if (resultOrErr instanceof Error) return true;
  return resultOrErr === false;
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

  console.log("🚀 TESTE PRES 04: negativo (verify com PresentationRequest diferente)");
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

    // Schema+CredDef
    const schemaId = await createAndRegisterSchema(
      genesisAbs,
      issuerDid,
      `SchemaReqMismatch_${Date.now()}`,
      `1.${nowSec()}`,
      ["nome", "cpf", "idade"]
    );
    const credDefId = await createAndRegisterCredDef(
      genesisAbs,
      issuerDid,
      schemaId,
      `TAG_REQMIS_${nowSec()}`
    );

    const schemaLedgerObj = parseJsonSafe(await fetchSchemaFromLedger(genesisAbs, schemaId));
    const credDefLedgerObj = parseJsonSafe(await fetchCredDefFromLedger(genesisAbs, credDefId));

    // Emitir + store credencial
    const createCredentialOffer = fn(issuer, "createCredentialOffer", "create_credential_offer");
    const createLinkSecret = fn(holder, "createLinkSecret", "create_link_secret");
    const createDidV2 = fn(holder, "createDidV2", "create_did_v2");
    const createCredentialRequest = fn(holder, "createCredentialRequest", "create_credential_request");
    const createCredential = fn(issuer, "createCredential", "create_credential");
    const storeCredential = fn(holder, "storeCredential", "store_credential");

    await createLinkSecret("default");

    const offerJson = await createCredentialOffer(credDefId, `offer-reqmis-${Date.now()}`);

    const didRaw = await createDidV2("{}");
    const didObj = typeof didRaw === "string" ? JSON.parse(didRaw) : didRaw;
    const holderDid = didObj.did || didObj.myDid || didObj.id;
    assert(typeof holderDid === "string" && holderDid.length > 10, "holderDid inválido");

    const requestJson = await createCredentialRequest(
      "default",
      holderDid,
      JSON.stringify(credDefLedgerObj),
      offerJson
    );

    const nonce = extractNonce(offerJson);

    const values = { nome: "Alice", cpf: "12345678900", idade: "29" };
    const credentialJson = await createCredential(
      credDefId,
      offerJson,
      requestJson,
      JSON.stringify(values)
    );

    const credentialId = `cred-reqmis-${Date.now()}`;
    await storeCredential(
      credentialId,
      credentialJson,
      nonce,
      JSON.stringify(credDefLedgerObj),
      null
    );

    // Create presentation com presReqA
    const createPresentation = fn(holder, "createPresentation", "create_presentation");
    const verifyPresentation = fn(issuer, "verifyPresentation", "verify_presentation");

    const presReqA = {
      nonce: String(Math.floor(Date.now() / 1000) * 1000000 + 111),
      name: "ProofReqA",
      version: "0.1",
      requested_attributes: {
        attr1_referent: { name: "nome" },
        attr2_referent: { name: "cpf" },
      },
      requested_predicates: {},
    };

    const reqCreds = {
      requested_attributes: {
        attr1_referent: { cred_id: credentialId, revealed: true },
        attr2_referent: { cred_id: credentialId, revealed: false },
      },
      requested_predicates: {},
    };

    const schemasMap = { [schemaId]: schemaLedgerObj };
    const credDefsMap = { [credDefId]: credDefLedgerObj };

    console.log("1) create_presentation com presReqA...");
    const presentationJson = await createPresentation(
      JSON.stringify(presReqA),
      JSON.stringify(reqCreds),
      JSON.stringify(schemasMap),
      JSON.stringify(credDefsMap)
    );

    // Verificar com presReqB (nonce diferente + muda requested_attributes)
    const presReqB = {
      nonce: String(Math.floor(Date.now() / 1000) * 1000000 + 222),
      name: "ProofReqB",
      version: "0.1",
      requested_attributes: {
        attr1_referent: { name: "nome" },
        // altera o segundo atributo para forçar mismatch do request
        attr2_referent: { name: "idade" },
      },
      requested_predicates: {},
    };

    let resOrErr;
    try {
      console.log("2) verify_presentation usando presReqB (mismatch)...");
      const ok = await verifyPresentation(
        JSON.stringify(presReqB),
        presentationJson,
        JSON.stringify(schemasMap),
        JSON.stringify(credDefsMap)
      );
      resOrErr = ok;
    } catch (e) {
      resOrErr = e;
    }

    assert(
      okNegativeVerify(resOrErr),
      "verify_presentation aceitou presentation com request diferente (deveria falhar)"
    );

    console.log("✅ OK: mismatch detectado (false ou erro).");
    console.log("✅ OK: TESTE PRES 04 passou.");
  } finally {
    try { await issuer.walletClose(); } catch {}
    try { await holder.walletClose(); } catch {}
  }
})().catch((e) => {
  console.error("❌ FALHA TESTE PRES 04:", e && e.stack ? e.stack : e);
  process.exit(1);
});
