/*
PARA RODAR ESTE TESTE:
TRUSTEE_SEED="000000000000000000000000Trustee1" \
TRUSTEE_DID="V4SGRU86Z58d6TV7PBUe6f" \
WALLET_PASS="minha_senha_teste" GENESIS_FILE=./genesis.txn \
node teste-node/credentials/test_import_export_stored_credential.js

O QUE ESTE TESTE FAZ:
- Emite 2 credenciais e faz store no Holder
- Exporta 1 credencial armazenada (package JSON)
- Deleta a credencial
- Importa o package de volta
- Lista e abre para confirmar
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

(async () => {
  const GENESIS_FILE = mustEnv("GENESIS_FILE");
  const WALLET_PASS = process.env.WALLET_PASS || "minha_senha_teste";
  const TRUSTEE_SEED = mustEnv("TRUSTEE_SEED");
  const TRUSTEE_DID = mustEnv("TRUSTEE_DID");

  const walletsDir = path.join(__dirname, "..", "wallets");
  fs.mkdirSync(walletsDir, { recursive: true });

  const issuerWalletPath = path.join(walletsDir, "issuer_import_export.db");
  const holderWalletPath = path.join(walletsDir, "holder_import_export.db");
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

    // -------------------------
    // Store CPF
    // -------------------------
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

    const cpfIdLocal = "cred-cpf-import-export";
    await holder.storeCredential(cpfIdLocal, credCpfJson, reqMetaCpfId, credDefCpfJsonLedger, null);
    console.log("✅ Store OK (CPF).");

    // -------------------------
    // Store END
    // -------------------------
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

    const endIdLocal = "cred-end-import-export";
    await holder.storeCredential(endIdLocal, credEndJson, reqMetaEndId, credDefEndJsonLedger, null);
    console.log("✅ Store OK (ENDERECO).");

    // ============================================================
    // EXPORT / DELETE / IMPORT
    // ============================================================
    console.log("\n11) holder.exportStoredCredential(endIdLocal) ...");
    const pkgJson = await holder.exportStoredCredential(endIdLocal);
    const pkg = JSON.parse(pkgJson);

    console.log("📦 Package exportado:");
    console.log(JSON.stringify({
      type: pkg.type,
      version: pkg.version,
      id_local: pkg.id_local,
      schema_id: pkg.schema_id,
      cred_def_id: pkg.cred_def_id,
      stored_at: pkg.stored_at,
      credential_schema_id: pkg.credential?.schema_id,
      credential_cred_def_id: pkg.credential?.cred_def_id,
    }, null, 2));

    if (pkg.id_local !== endIdLocal) throw new Error("Package id_local não bate.");
    if (!pkg.credential) throw new Error("Package sem credential.");

    console.log("\n12) holder.deleteStoredCredential(endIdLocal) ...");
    const delOk = await holder.deleteStoredCredential(endIdLocal);
    if (delOk !== true) throw new Error("deleteStoredCredential não retornou true.");
    console.log("🗑️ OK deletou.");

    console.log("\n13) holder.listCredentials() (espera 1) ...");
    const list1 = JSON.parse(await holder.listCredentials());
    console.log(`📦 total agora=${list1.length}`);
    if (list1.length !== 1) throw new Error("Esperado 1 credencial após deletar.");

    console.log("\n14) holder.importStoredCredential(pkgJson, overwrite=false) ...");
    const importedId = await holder.importStoredCredential(pkgJson, false, null);
    console.log("📥 OK importou. id_local:", importedId);

    if (importedId !== endIdLocal) {
      throw new Error(`Esperado importar com mesmo id_local (${endIdLocal}), obtido=${importedId}`);
    }

    console.log("\n15) holder.listCredentials() (espera 2) ...");
    const list2 = JSON.parse(await holder.listCredentials());
    console.log(`📦 total agora=${list2.length}`);
    if (list2.length !== 2) throw new Error("Esperado 2 credenciais após importar.");

    console.log("\n16) holder.getStoredCredential(endIdLocal) ...");
    const endJson2 = await holder.getStoredCredential(endIdLocal);
    const end2 = JSON.parse(endJson2);

    console.log("🔎 OK abriu após importar. values_raw esperado:");
    console.log({
      nome: end2.values?.nome?.raw,
      endereco: end2.values?.endereco?.raw,
      cidade: end2.values?.cidade?.raw,
      estado: end2.values?.estado?.raw,
    });

    if (end2.values?.cidade?.raw !== "São Paulo") {
      throw new Error("Import trouxe credencial inconsistente (cidade != São Paulo).");
    }

    console.log("\n✅ OK: export/import de credencial armazenada funcionando.");
  } finally {
    try { await issuer.walletClose(); } catch (_) {}
    try { await holder.walletClose(); } catch (_) {}
  }
})().catch((e) => {
  console.error("❌ FALHA NO TESTE:", e?.message || e);
  console.error(e?.stack || "");
  process.exit(1);
});
