const path = require("path");
const fs = require("fs");
const {
  NETWORK_CONFIG,
  assert,
  downloadGenesisHttp,
  loadIndyAgent,
  fn,
  walletCreateOpenIdempotent,
  extractNonce,
} = require("./_helpers");

(async () => {
  const IndyAgent = loadIndyAgent();

  const pass = process.env.WALLET_PASS || "minha_senha_teste";
  const RESET = process.env.RESET_WALLET === "1";

  const walletDir = path.join(__dirname, "..", "wallets");
  fs.mkdirSync(walletDir, { recursive: true });

  const issuerDb = process.env.WALLET_ISSUER || path.join(walletDir, "test_wallet_cred_issuer.db");
  const holderDb = process.env.WALLET_HOLDER || path.join(walletDir, "test_wallet_cred_holder.db");

  const genesisAbs = path.join(process.cwd(), NETWORK_CONFIG.genesisFile);

  console.log("🚀 TESTE CRED 01: E2E issue/store (Issuer ↔ Holder)");
  console.log("Config:", {
    issuerDb,
    holderDb,
    WALLET_PASS: "***",
    RESET_WALLET: RESET,
    genesisAbs,
  });

  await downloadGenesisHttp(NETWORK_CONFIG.genesisUrl, genesisAbs);

  const issuer = new IndyAgent();
  const holder = new IndyAgent();

  // --- Wallets idempotentes (reset automático se senha divergir) ---
  if (RESET) {
    // reset manual simples: basta remover arquivos (helpers expõem rmIfExists, mas aqui mantemos simples)
    try { fs.rmSync(issuerDb, { force: true }); } catch { }
    try { fs.rmSync(holderDb, { force: true }); } catch { }
    try { fs.rmSync(issuerDb + ".sidecar", { force: true }); } catch { }
    try { fs.rmSync(holderDb + ".sidecar", { force: true }); } catch { }
  }

  await walletCreateOpenIdempotent(issuer, issuerDb, pass);
  await walletCreateOpenIdempotent(holder, holderDb, pass);

  try {
    // --- Conectar no ledger (issuer e holder, porque holder vai fazer request + store com creddef do ledger) ---
    await issuer.connectNetwork(genesisAbs);
    await holder.connectNetwork(genesisAbs);

    // --- Trustee DID ---
    const importDidFromSeed_issuer = fn(issuer, "importDidFromSeed", "import_did_from_seed");
    const [issuerDid] = await importDidFromSeed_issuer(NETWORK_CONFIG.trusteeSeed);
    assert(issuerDid === NETWORK_CONFIG.trusteeDid, `Trustee DID inesperado: ${issuerDid}`);
    console.log("✅ Issuer DID:", issuerDid);

    // --- Schema + CredDef (pré-req) ---
    const createAndRegisterSchema = fn(issuer, "createAndRegisterSchema", "create_and_register_schema");
    const createAndRegisterCredDef = fn(issuer, "createAndRegisterCredDef", "create_and_register_cred_def");
    const fetchCredDefFromLedger = fn(issuer, "fetchCredDefFromLedger", "fetch_cred_def_from_ledger");

    const schemaName = `SchemaForCredential_${Date.now()}`;
    const schemaVersion = `1.${Math.floor(Date.now() / 1000)}`;
    const schemaAttrs = ["nome", "cpf", "idade"];

    console.log("1) Registrando Schema...");
    const schemaId = await createAndRegisterSchema(genesisAbs, issuerDid, schemaName, schemaVersion, schemaAttrs);
    assert(typeof schemaId === "string" && schemaId.includes(":2:"), "schemaId inválido");
    console.log("✅ schemaId:", schemaId);

    console.log("2) Registrando CredDef...");
    const tag = `TAG_CRED_${Math.floor(Date.now() / 1000)}`;
    const credDefId = await createAndRegisterCredDef(genesisAbs, issuerDid, schemaId, tag);
    assert(typeof credDefId === "string" && credDefId.includes(":3:CL:"), "credDefId inválido");
    console.log("✅ credDefId:", credDefId);

    console.log("3) Fetch credDef_json do ledger...");
    const credDefJson = await fetchCredDefFromLedger(genesisAbs, credDefId);
    assert(typeof credDefJson === "string" && credDefJson.length > 20, "credDefJson inválido");

    // --- Issuer: create offer (persistida) ---
    const createCredentialOffer = fn(issuer, "createCredentialOffer", "create_credential_offer");
    const offerLocalId = `offer-local-${Date.now()}`;
    console.log("4) Issuer criando Credential Offer...");
    const offerJson = await createCredentialOffer(credDefId, offerLocalId);
    assert(typeof offerJson === "string" && offerJson.length > 20, "offerJson inválido");
    console.log("✅ Offer criada e persistida:", offerLocalId);

    // --- Holder: link secret + store received offer ---
    const createLinkSecret = fn(holder, "createLinkSecret", "create_link_secret");
    const storeReceivedOffer = fn(holder, "storeReceivedOffer", "store_received_offer");

    console.log('5) Holder criando Link Secret "default"...');
    await createLinkSecret("default");

    console.log("6) Holder armazenando offer recebida...");
    const receivedOfferId = await storeReceivedOffer(offerJson);
    assert(typeof receivedOfferId === "string" && receivedOfferId.startsWith("received-offer-"), "receivedOfferId inválido");
    console.log("✅ receivedOfferId:", receivedOfferId);

    // --- Holder: create request (persiste request_metadata com ID = nonce) ---
    const createCredentialRequest = fn(holder, "createCredentialRequest", "create_credential_request");

    // 7) Holder DID válido (Indy DID) para prover_did
    const createDidV2 = fn(holder, "createDidV2", "create_did_v2");

    console.log('7) Holder criando DID v2 (local) via createDidV2("{}")...');
    const didObjRaw = await createDidV2("{}"); // <-- OBRIGATÓRIO: String JSON

    let holderDid;
    if (typeof didObjRaw === "string") {
      const didObj = JSON.parse(didObjRaw);
      holderDid = didObj.did || didObj.myDid || didObj.id;
    } else if (didObjRaw && typeof didObjRaw === "object") {
      holderDid = didObjRaw.did || didObjRaw.myDid || didObjRaw.id;
    }

    assert(typeof holderDid === "string" && holderDid.length > 10, "Falha ao obter holderDid do createDidV2");
    console.log("✅ Holder DID:", holderDid);

    console.log("8) Holder criando Credential Request...");
    const requestJson = await createCredentialRequest("default", holderDid, credDefJson, offerJson);
    assert(typeof requestJson === "string" && requestJson.length > 20, "requestJson inválido");


    const nonce = extractNonce(offerJson);
    const requestMetadataId = nonce; // exatamente como no Rust: metadata_id = offer.nonce
    console.log("✅ Request criada. request_metadata_id:", requestMetadataId);

    // --- Issuer: create credential ---
    const createCredential = fn(issuer, "createCredential", "create_credential");

    const values = {
      nome: "Alice",
      cpf: "12345678900",
      idade: "29",
    };

    console.log("8) Issuer emitindo credential...");
    const credentialJson = await createCredential(credDefId, offerJson, requestJson, JSON.stringify(values));
    assert(typeof credentialJson === "string" && credentialJson.length > 50, "credentialJson inválido");

    // --- Holder: store credential (process_credential + salvar na wallet) ---
    const storeCredential = fn(holder, "storeCredential", "store_credential");
    const credentialId = `cred-${Date.now()}`;

    console.log("9) Holder processando e salvando credential...");
    const storedId = await storeCredential(credentialId, credentialJson, requestMetadataId, credDefJson, null);
    assert(storedId === credentialId, "store_credential não retornou o credential_id esperado");
    console.log("✅ Credential armazenada:", storedId);

    console.log("✅ OK: TESTE CRED 01 passou.");
  } finally {
    try { await issuer.walletClose(); } catch { }
    try { await holder.walletClose(); } catch { }
  }
})().catch((e) => {
  console.error("❌ FALHA TESTE CRED 01:", e && e.stack ? e.stack : e);
  process.exit(1);
});
