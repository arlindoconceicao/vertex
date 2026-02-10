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

function isExpectedAttrErr(e) {
  const msg = String(e && e.message ? e.message : e);
  // mensagens variam entre versões; capturamos padrões comuns
  return (
    msg.toLowerCase().includes("attribute") ||
    msg.toLowerCase().includes("attr") ||
    msg.toLowerCase().includes("requested") ||
    msg.toLowerCase().includes("matem") || // "Erro MATEMÁTICO create_presentation"
    msg.toLowerCase().includes("schema") ||
    msg.toLowerCase().includes("invalid")
  );
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

  console.log("🚀 TESTE PRES 05: negativo (atributo solicitado não existe na credencial)");
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

    // Schema que NÃO tem "telefone"
    const schemaId = await createAndRegisterSchema(
      genesisAbs,
      issuerDid,
      `SchemaNoTelefone_${Date.now()}`,
      `1.${nowSec()}`,
      ["nome", "cpf", "idade"]
    );
    const credDefId = await createAndRegisterCredDef(
      genesisAbs,
      issuerDid,
      schemaId,
      `TAG_NOTEL_${nowSec()}`
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

    const offerJson = await createCredentialOffer(credDefId, `offer-notel-${Date.now()}`);

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

    const credentialId = `cred-notel-${Date.now()}`;
    await storeCredential(
      credentialId,
      credentialJson,
      nonce,
      JSON.stringify(credDefLedgerObj),
      null
    );

    // Create presentation pedindo atributo que NÃO existe ("telefone")
    const createPresentation = fn(holder, "createPresentation", "create_presentation");

    const presReq = {
      nonce: String(Math.floor(Date.now() / 1000) * 1000000 + 555),
      name: "ProofReqAttrNotInCred",
      version: "0.1",
      requested_attributes: {
        attr1_referent: { name: "telefone" }, // NÃO existe
      },
      requested_predicates: {},
    };

    const reqCreds = {
      requested_attributes: {
        attr1_referent: { cred_id: credentialId, revealed: true },
      },
      requested_predicates: {},
    };

    const schemasMap = { [schemaId]: schemaLedgerObj };
    const credDefsMap = { [credDefId]: credDefLedgerObj };

    try {
      console.log('1) create_presentation pedindo "telefone" (inexistente)...');
      await createPresentation(
        JSON.stringify(presReq),
        JSON.stringify(reqCreds),
        JSON.stringify(schemasMap),
        JSON.stringify(credDefsMap)
      );
      throw new Error("Esperava falha, mas create_presentation retornou sucesso.");
    } catch (e) {
      if (!isExpectedAttrErr(e)) throw e;
      console.log("✅ OK: erro esperado capturado:", String(e.message || e));
    }

    console.log("✅ OK: TESTE PRES 05 passou.");
  } finally {
    try { await issuer.walletClose(); } catch {}
    try { await holder.walletClose(); } catch {}
  }
})().catch((e) => {
  console.error("❌ FALHA TESTE PRES 05:", e && e.stack ? e.stack : e);
  process.exit(1);
});
