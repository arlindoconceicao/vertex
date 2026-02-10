/*
PARA RODAR ESTE TESTE:
TRUSTEE_SEED="000000000000000000000000Trustee1" \
TRUSTEE_DID="V4SGRU86Z58d6TV7PBUe6f" \
WALLET_PASS="minha_senha_teste" GENESIS_FILE=./genesis.txn \
node teste-node/credentials/test_rename_stored_credential_id.js

O QUE ESTE TESTE FAZ:
- Emite 2 credenciais e faz store no Holder (CPF e ENDERECO)
- Seta alias na END
- Renomeia id_local da END (old -> new, overwrite=false)
- Verifica:
  - old não existe mais
  - new existe e mantém tags (alias) e conteúdo
- Testa colisão:
  - tenta renomear CPF para o mesmo id_local do END (overwrite=false) => deve falhar
  - renomeia CPF para o id_local do END (overwrite=true) => deve substituir
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

  const issuerWalletPath = path.join(walletsDir, "issuer_rename_id.db");
  const holderWalletPath = path.join(walletsDir, "holder_rename_id.db");
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

    const cpfOldId = "cred-cpf-rename";
    await holder.storeCredential(cpfOldId, credCpfJson, reqMetaCpfId, credDefCpfJsonLedger, null);
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

    const endOldId = "cred-end-rename";
    await holder.storeCredential(endOldId, credEndJson, reqMetaEndId, credDefEndJsonLedger, null);
    console.log("✅ Store OK (ENDERECO).");

    console.log("\n11) setStoredCredentialAlias(endOldId, 'Endereço - Casa') ...");
    await holder.setStoredCredentialAlias(endOldId, "Endereço - Casa");

    // ============================================================
    // Rename END: old -> new (overwrite=false)
    // ============================================================
    const endNewId = `cred-end-renamed-${Date.now()}`;
    console.log(`\n12) renameStoredCredentialId("${endOldId}" -> "${endNewId}", overwrite=false) ...`);
    const renamedTo = await holder.renameStoredCredentialId(endOldId, endNewId, false);
    if (renamedTo !== endNewId) throw new Error("rename não retornou o new_id_local.");

    console.log("\n13) Validando que old não abre e new abre...");
    let failedOld = false;
    try {
      await holder.getStoredCredential(endOldId);
    } catch (e) {
      failedOld = true;
      console.log("✅ old_id não encontrado como esperado.");
    }
    if (!failedOld) throw new Error("old_id ainda abriu (não deveria).");

    const endNew = JSON.parse(await holder.getStoredCredential(endNewId));
    if (endNew.values?.cidade?.raw !== "São Paulo") throw new Error("Conteúdo da END pós-rename inconsistente.");

    // Alias precisa estar na listagem
    const listAfterRename = JSON.parse(await holder.listCredentials());
    const endInList = listAfterRename.find((c) => c.id_local === endNewId);
    if (!endInList) throw new Error("Novo id_local não apareceu no listCredentials.");
    if (endInList.alias !== "Endereço - Casa") throw new Error("Alias não foi preservado no rename.");
    console.log("✅ OK: rename preservou tags (alias) e conteúdo.");

    // ============================================================
    // Colisão: tentar renomear CPF -> endNewId (overwrite=false) deve falhar
    // ============================================================
    console.log(`\n14) Tentando renomear CPF -> "${endNewId}" overwrite=false (deve falhar)...`);
    let collisionFailed = false;
    try {
      await holder.renameStoredCredentialId(cpfOldId, endNewId, false);
    } catch (e) {
      collisionFailed = true;
      console.log("✅ Falhou como esperado:", e?.message || String(e));
    }
    if (!collisionFailed) throw new Error("Era esperado falhar colisão overwrite=false.");

    // ============================================================
    // Overwrite: renomear CPF -> endNewId (overwrite=true) deve substituir
    // (END some, CPF assume o id)
    // ============================================================
    console.log(`\n15) Renomeando CPF -> "${endNewId}" overwrite=true (deve substituir)...`);
    const overwroteId = await holder.renameStoredCredentialId(cpfOldId, endNewId, true);
    if (overwroteId !== endNewId) throw new Error("overwrite rename não retornou o new_id_local.");

    const now = JSON.parse(await holder.getStoredCredential(endNewId));
    // Agora deve ser CPF (tem cpf/raw)
    const cpfRaw = now.values?.cpf?.raw;
    if (cpfRaw !== "123.456.789-09") {
      throw new Error(`overwrite não substituiu corretamente. cpf.raw=${cpfRaw}`);
    }
    console.log("✅ OK: overwrite substituiu (id agora aponta para CPF).");

    console.log("\n✅ OK: renameStoredCredentialId funcionando (com e sem overwrite).");
  } finally {
    try { await issuer.walletClose(); } catch (_) {}
    try { await holder.walletClose(); } catch (_) {}
  }
})().catch((e) => {
  console.error("❌ FALHA NO TESTE:", e?.message || e);
  console.error(e?.stack || "");
  process.exit(1);
});
