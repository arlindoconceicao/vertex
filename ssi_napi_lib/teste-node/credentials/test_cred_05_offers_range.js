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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

(async () => {
  const IndyAgent = loadIndyAgent();

  const pass = process.env.WALLET_PASS || "minha_senha_teste";
  const walletDir = path.join(__dirname, "..", "wallets");
  fs.mkdirSync(walletDir, { recursive: true });

  const issuerDb =
    process.env.WALLET_ISSUER ||
    path.join(walletDir, "test_wallet_cred_issuer.db");

  const genesisAbs = path.join(process.cwd(), NETWORK_CONFIG.genesisFile);

  console.log("🚀 TESTE CRED 05: offers range (list/delete por timestamp)");
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

    const createCredentialOffer = fn(issuer, "createCredentialOffer", "create_credential_offer");
    const listCredentialOffers = fn(issuer, "listCredentialOffers", "list_credential_offers");
    const listCredentialOffersRange = fn(issuer, "listCredentialOffersRange", "list_credential_offers_range");
    const deleteCredentialOffersRange = fn(issuer, "deleteCredentialOffersRange", "delete_credential_offers_range");
    const deleteCredentialOffer = fn(issuer, "deleteCredentialOffer", "delete_credential_offer");

    // Prep: schema+creddef
    const schemaId = await createAndRegisterSchema(
      genesisAbs,
      issuerDid,
      `SchemaOfferRange_${Date.now()}`,
      `1.${nowSec()}`,
      ["nome", "cpf", "idade"]
    );

    const credDefId = await createAndRegisterCredDef(
      genesisAbs,
      issuerDid,
      schemaId,
      `TAG_RANGE_${nowSec()}`
    );

    // Marca t0
    const t0 = nowSec();
    console.log("t0:", t0);

    // Offer A (fora do range alvo)
    const offerA = `offer-range-A-${Date.now()}`;
    console.log("1) criando Offer A (fora do range alvo)...", offerA);
    await createCredentialOffer(credDefId, offerA);

    // Espera para garantir timestamps diferentes
    await sleep(1500);

    // Marca início do range
    const from = nowSec();
    console.log("from:", from);

    // Offer B (dentro do range)
    const offerB = `offer-range-B-${Date.now()}`;
    console.log("2) criando Offer B (dentro do range)...", offerB);
    await createCredentialOffer(credDefId, offerB);

    await sleep(1500);

    // Offer C (dentro do range)
    const offerC = `offer-range-C-${Date.now()}`;
    console.log("3) criando Offer C (dentro do range)...", offerC);
    await createCredentialOffer(credDefId, offerC);

    // Final do range
    const to = nowSec() + 1; // +1s para garantir que offerC fique dentro do range
    console.log("to:", to);

    // --- list range ---
    console.log("4) listCredentialOffersRange(from,to)...");
    const rangedJson = await listCredentialOffersRange(from, to);
    const ranged = parseJsonSafe(rangedJson, "listCredentialOffersRange");

    const idsInRange = new Set(ranged.map((x) => x.id_local));
    assert(idsInRange.has(offerB), "Offer B não apareceu no range");
    assert(idsInRange.has(offerC), "Offer C não apareceu no range");
    assert(!idsInRange.has(offerA), "Offer A apareceu no range (não deveria)");

    console.log("✅ OK: list range filtrou corretamente.");

    // --- delete range ---
    console.log("5) deleteCredentialOffersRange(from,to)...");
    const deletedCount = await deleteCredentialOffersRange(from, to);
    assert(typeof deletedCount === "number", "deletedCount não é number");
    assert(deletedCount >= 2, `deletedCount inesperado: ${deletedCount}`);

    // --- list all para confirmar ---
    console.log("6) listCredentialOffers() pós-delete...");
    const allJson = await listCredentialOffers();
    const all = parseJsonSafe(allJson, "listCredentialOffers pós-delete");
    const allIds = new Set(all.map((x) => x.id_local));

    assert(!allIds.has(offerB), "Offer B ainda existe após delete range");
    assert(!allIds.has(offerC), "Offer C ainda existe após delete range");
    assert(allIds.has(offerA), "Offer A foi deletada mas deveria permanecer");

    console.log("✅ OK: delete range deletou somente as do intervalo.");

    // Cleanup: remover offerA para não poluir execuções futuras
    console.log("7) cleanup: deleteCredentialOffer(offerA) ...");
    const ok = await deleteCredentialOffer(offerA);
    assert(ok === true, "cleanup deleteCredentialOffer falhou");

    console.log("✅ OK: TESTE CRED 05 passou.");
  } finally {
    try { await issuer.walletClose(); } catch {}
  }
})().catch((e) => {
  console.error("❌ FALHA TESTE CRED 05:", e && e.stack ? e.stack : e);
  process.exit(1);
});
