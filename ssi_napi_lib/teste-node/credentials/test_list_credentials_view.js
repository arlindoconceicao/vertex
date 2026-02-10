/*
PARA RODAR ESTE TESTE:
TRUSTEE_SEED="000000000000000000000000Trustee1" \
TRUSTEE_DID="V4SGRU86Z58d6TV7PBUe6f" \
WALLET_PASS="minha_senha_teste" GENESIS_FILE=./genesis.txn \
node teste-node/credentials/test_list_credentials_view.js

O QUE ESTE TESTE FAZ:
- Emite 2 credenciais e faz store no Holder (CPF e ENDERECO)
- Seta alias na END
- listCredentialsView("compact"):
   - retorna 2
   - contém campos id_local/schema_id/cred_def_id/stored_at
   - END contém alias
   - NÃO deve trazer values_raw
- listCredentialsView("full"):
   - retorna 2
   - traz values_raw
   - END contém alias
- mode inválido deve falhar
*/

/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const { IndyAgent } = require(path.join(__dirname, "..", "..", "index.node"));

function rmIfExists(walletDbPath) {
  const sidecar = `${walletDbPath}.kdf.json`;
  try { fs.unlinkSync(walletDbPath); } catch (_) {}
  try { fs.unlinkSync(sidecar); } catch (_) {}
  try { fs.unlinkSync(`${sidecar}.tmp`); } catch (_) {}
  try { fs.unlinkSync(`${walletDbPath}-shm`); } catch (_) {}
  try { fs.unlinkSync(`${walletDbPath}-wal`); } catch (_) {}
}

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Env ${name} não definida.`);
  return v;
}

async function tryRegisterDid(agent, GENESIS_FILE, submitterDid, did, verkey, role) {
  try {
    await agent.registerDidOnLedger(GENESIS_FILE, submitterDid, did, verkey, role);
  } catch (e) {
    const msg = e?.message || String(e);
    if (/already exists|exists|DID.*exist|NYM.*exist|Ledger/i.test(msg)) {
      console.log(`ℹ️ DID já estava no ledger, seguindo: ${did}`);
      return;
    }
    throw e;
  }
}

function mustHaveCompactShape(item, label) {
  if (!item || typeof item !== "object") throw new Error(`${label}: item inválido`);
  for (const k of ["id_local", "schema_id", "cred_def_id", "stored_at"]) {
    if (!item[k]) throw new Error(`${label}: faltando ${k}`);
  }
  if (Object.prototype.hasOwnProperty.call(item, "values_raw")) {
    throw new Error(`${label}: NÃO deveria conter values_raw em compact`);
  }
}

(async () => {
  const GENESIS_FILE = mustEnv("GENESIS_FILE");
  const WALLET_PASS = process.env.WALLET_PASS || "minha_senha_teste";
  const TRUSTEE_SEED = mustEnv("TRUSTEE_SEED");
  const TRUSTEE_DID = mustEnv("TRUSTEE_DID");

  const walletsDir = path.join(__dirname, "..", "wallets");
  fs.mkdirSync(walletsDir, { recursive: true });

  const issuerWalletPath = path.join(walletsDir, "issuer_list_view.db");
  const holderWalletPath = path.join(walletsDir, "holder_list_view.db");
  rmIfExists(issuerWalletPath);
  rmIfExists(holderWalletPath);

  const issuer = new IndyAgent();
  const holder = new IndyAgent();

  try {
    console.log("1) Criando wallets...");
    await issuer.walletCreate(issuerWalletPath, WALLET_PASS);
    await holder.walletCreate(holderWalletPath, WALLET_PASS);

    console.log("2) Abrindo wallets...");
    await issuer.walletOpen(issuerWalletPath, WALLET_PASS);
    await holder.walletOpen(holderWalletPath, WALLET_PASS);

    console.log("3) Conectando na rede...");
    await issuer.connectNetwork(GENESIS_FILE);
    await holder.connectNetwork(GENESIS_FILE);

    console.log("4) Importando Trustee DID no issuer...");
    await issuer.importDidFromSeed(TRUSTEE_SEED);

    console.log("5) Criando DIDs...");
    const [issuerDid, issuerVerkey] = await issuer.createOwnDid();
    const [holderDid, holderVerkey] = await holder.createOwnDid();

    console.log("6) Registrando DIDs no ledger...");
    await tryRegisterDid(issuer, GENESIS_FILE, TRUSTEE_DID, issuerDid, issuerVerkey, "ENDORSER");
    await tryRegisterDid(issuer, GENESIS_FILE, TRUSTEE_DID, holderDid, holderVerkey, null);

    console.log("7) Criando Schemas + CredDefs...");
    const schemaCpfId = await issuer.createAndRegisterSchema(
      GENESIS_FILE, issuerDid, "cpf", `1.0.${Date.now()}`, ["nome", "cpf", "idade"]
    );
    const schemaEndId = await issuer.createAndRegisterSchema(
      GENESIS_FILE, issuerDid, "endereco", `1.0.${Date.now()}`, ["nome", "endereco", "cidade", "estado"]
    );

    const credDefCpfId = await issuer.createAndRegisterCredDef(
      GENESIS_FILE, issuerDid, schemaCpfId, `TAG_CPF_${Date.now()}`
    );
    const credDefEndId = await issuer.createAndRegisterCredDef(
      GENESIS_FILE, issuerDid, schemaEndId, `TAG_END_${Date.now()}`
    );

    console.log("8) Garantindo Link Secret no holder...");
    try { await holder.createLinkSecret("default"); } catch (_) {}

    // CPF
    console.log("9) Emissão CPF...");
    const offerCpfJson = await issuer.createCredentialOffer(credDefCpfId, `offer-cpf-${Date.now()}`);
    const reqMetaCpfId = JSON.parse(offerCpfJson)?.nonce;
    if (!reqMetaCpfId) throw new Error("CPF: Offer sem nonce (reqMetaId).");
    const credDefCpfJsonLedger = await holder.fetchCredDefFromLedger(GENESIS_FILE, credDefCpfId);

    const reqCpfJson = await holder.createCredentialRequest(
      "default", holderDid, credDefCpfJsonLedger, offerCpfJson
    );

    const credCpfJson = await issuer.createCredential(
      credDefCpfId,
      offerCpfJson,
      reqCpfJson,
      JSON.stringify({ nome: "Edimar Veríssimo", cpf: "123.456.789-09", idade: "35" })
    );

    const cpfIdLocal = "cred-cpf-view";
    await holder.storeCredential(cpfIdLocal, credCpfJson, reqMetaCpfId, credDefCpfJsonLedger, null);
    console.log("✅ Store OK (CPF).");

    // END
    console.log("10) Emissão ENDERECO...");
    const offerEndJson = await issuer.createCredentialOffer(credDefEndId, `offer-end-${Date.now()}`);
    const reqMetaEndId = JSON.parse(offerEndJson)?.nonce;
    if (!reqMetaEndId) throw new Error("END: Offer sem nonce (reqMetaId).");
    const credDefEndJsonLedger = await holder.fetchCredDefFromLedger(GENESIS_FILE, credDefEndId);

    const reqEndJson = await holder.createCredentialRequest(
      "default", holderDid, credDefEndJsonLedger, offerEndJson
    );

    const credEndJson = await issuer.createCredential(
      credDefEndId,
      offerEndJson,
      reqEndJson,
      JSON.stringify({
        nome: "Edimar Veríssimo",
        endereco: "Rua Exemplo, 123",
        cidade: "São Paulo",
        estado: "SP",
      })
    );

    const endIdLocal = "cred-end-view";
    await holder.storeCredential(endIdLocal, credEndJson, reqMetaEndId, credDefEndJsonLedger, null);
    console.log("✅ Store OK (ENDERECO).");

    console.log("\n11) Setando alias na END...");
    await holder.setStoredCredentialAlias(endIdLocal, "Endereço - Casa");

    // ============================================================
    // COMPACT
    // ============================================================
    console.log('\n12) listCredentialsView("compact") ...');
    const compact = JSON.parse(await holder.listCredentialsView("compact"));
    if (!Array.isArray(compact) || compact.length !== 2) {
      throw new Error(`compact: esperado 2, obtido ${Array.isArray(compact) ? compact.length : "N/A"}`);
    }

    const cCpf = compact.find((c) => c.id_local === cpfIdLocal);
    const cEnd = compact.find((c) => c.id_local === endIdLocal);
    if (!cCpf || !cEnd) throw new Error("compact: não encontrou CPF e END por id_local.");

    mustHaveCompactShape(cCpf, "compact CPF");
    mustHaveCompactShape(cEnd, "compact END");

    if (cEnd.alias !== "Endereço - Casa") throw new Error("compact: alias da END não bate.");
    console.log("✅ OK: compact contém metadados e alias, sem values_raw.");

    // ============================================================
    // FULL
    // ============================================================
    console.log('\n13) listCredentialsView("full") ...');
    const full = JSON.parse(await holder.listCredentialsView("full"));
    if (!Array.isArray(full) || full.length !== 2) {
      throw new Error(`full: esperado 2, obtido ${Array.isArray(full) ? full.length : "N/A"}`);
    }

    const fEnd = full.find((c) => c.id_local === endIdLocal);
    if (!fEnd) throw new Error("full: não encontrou END por id_local.");

    if (!fEnd.values_raw || typeof fEnd.values_raw !== "object") {
      throw new Error("full: esperado values_raw.");
    }
    if (fEnd.alias !== "Endereço - Casa") throw new Error("full: alias da END não bate.");
    if (fEnd.values_raw.cidade !== "São Paulo") throw new Error("full: values_raw.cidade inconsistente.");
    console.log("✅ OK: full contém values_raw e alias.");

    // ============================================================
    // MODE INVÁLIDO
    // ============================================================
    console.log('\n14) listCredentialsView("invalid") (deve falhar) ...');
    let failed = false;
    try {
      await holder.listCredentialsView("invalid");
    } catch (e) {
      failed = true;
      console.log("✅ Falhou como esperado:", e?.message || String(e));
    }
    if (!failed) throw new Error("Era esperado falhar com mode inválido.");

    console.log("\n✅ OK: listCredentialsView(mode) funcionando.");
  } finally {
    try { await issuer.walletClose(); } catch (_) {}
    try { await holder.walletClose(); } catch (_) {}
  }
})().catch((e) => {
  console.error("❌ FALHA NO TESTE:", e?.message || e);
  console.error(e?.stack || "");
  process.exit(1);
});
