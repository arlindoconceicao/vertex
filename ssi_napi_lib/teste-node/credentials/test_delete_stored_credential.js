/*
PARA RODAR ESTE TESTE:
TRUSTEE_SEED="000000000000000000000000Trustee1" \
TRUSTEE_DID="V4SGRU86Z58d6TV7PBUe6f" \
WALLET_PASS="minha_senha_teste" GENESIS_FILE=./genesis.txn \
node teste-node/credentials/test_delete_stored_credential.js

O QUE ESTE TESTE FAZ:
- Cria DIDs do issuer e do holder
- Registra no ledger via Trustee (ignora se já existir)
- Cria 2 Schemas + 2 CredDefs (CPF e ENDERECO)
- Emite 2 credenciais e faz store no holder
- Lista credenciais (espera 2)
- Deleta 1 credencial pelo id_local (novo método deleteStoredCredential)
- Lista novamente (espera 1)
- Tenta abrir a credencial deletada (deve falhar)
*/

/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const { IndyAgent } = require(path.join(__dirname, "..", "..", "index.node"));

// -------------------------
// Helpers FS / ENV
// -------------------------
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

// -------------------------
// MAIN
// -------------------------
(async () => {
  const GENESIS_FILE = mustEnv("GENESIS_FILE");
  const WALLET_PASS = process.env.WALLET_PASS || "minha_senha_teste";

  const TRUSTEE_SEED = mustEnv("TRUSTEE_SEED");
  const TRUSTEE_DID = mustEnv("TRUSTEE_DID");

  const walletsDir = path.join(__dirname, "..", "wallets");
  fs.mkdirSync(walletsDir, { recursive: true });

  const issuerWalletPath = path.join(walletsDir, "issuer_delete_stored_cred.db");
  const holderWalletPath = path.join(walletsDir, "holder_delete_stored_cred.db");
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
      GENESIS_FILE,
      issuerDid,
      "cpf",
      `1.0.${Date.now()}`,
      ["nome", "cpf", "idade"]
    );

    const schemaEndId = await issuer.createAndRegisterSchema(
      GENESIS_FILE,
      issuerDid,
      "endereco",
      `1.0.${Date.now()}`,
      ["nome", "endereco", "cidade", "estado"]
    );

    const credDefCpfId = await issuer.createAndRegisterCredDef(
      GENESIS_FILE,
      issuerDid,
      schemaCpfId,
      `TAG_CPF_${Date.now()}`
    );

    const credDefEndId = await issuer.createAndRegisterCredDef(
      GENESIS_FILE,
      issuerDid,
      schemaEndId,
      `TAG_END_${Date.now()}`
    );

    console.log("8) Garantindo Link Secret no holder...");
    try { await holder.createLinkSecret("default"); } catch (_) {}

    // ------------------------------------------------------------
    // Emitir + Store CPF
    // ------------------------------------------------------------
    console.log("9) Emissão CPF...");
    const offerCpfJson = await issuer.createCredentialOffer(credDefCpfId, `offer-cpf-${Date.now()}`);
    const offerCpfObj = JSON.parse(offerCpfJson);
    const reqMetaCpfId = offerCpfObj?.nonce;
    if (!reqMetaCpfId) throw new Error("CPF: Offer sem nonce (reqMetaId).");

    const credDefCpfJsonLedger = await holder.fetchCredDefFromLedger(GENESIS_FILE, credDefCpfId);

    const reqCpfJson = await holder.createCredentialRequest(
      "default",
      holderDid,
      credDefCpfJsonLedger,
      offerCpfJson
    );

    const credCpfJson = await issuer.createCredential(
      credDefCpfId,
      offerCpfJson,
      reqCpfJson,
      JSON.stringify({ nome: "Edimar Veríssimo", cpf: "123.456.789-09", idade: "35" })
    );

    const cpfIdLocal = "cred-cpf-delete-test";
    await holder.storeCredential(cpfIdLocal, credCpfJson, reqMetaCpfId, credDefCpfJsonLedger, null);
    console.log("✅ Store OK (CPF).");

    // ------------------------------------------------------------
    // Emitir + Store ENDERECO
    // ------------------------------------------------------------
    console.log("10) Emissão ENDERECO...");
    const offerEndJson = await issuer.createCredentialOffer(credDefEndId, `offer-end-${Date.now()}`);
    const offerEndObj = JSON.parse(offerEndJson);
    const reqMetaEndId = offerEndObj?.nonce;
    if (!reqMetaEndId) throw new Error("END: Offer sem nonce (reqMetaId).");

    const credDefEndJsonLedger = await holder.fetchCredDefFromLedger(GENESIS_FILE, credDefEndId);

    const reqEndJson = await holder.createCredentialRequest(
      "default",
      holderDid,
      credDefEndJsonLedger,
      offerEndJson
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

    const endIdLocal = "cred-end-delete-test";
    await holder.storeCredential(endIdLocal, credEndJson, reqMetaEndId, credDefEndJsonLedger, null);
    console.log("✅ Store OK (ENDERECO).");

    // ------------------------------------------------------------
    // NOVAS FUNÇÕES: list + get + delete
    // ------------------------------------------------------------
    console.log("\n11) holder.listCredentials() (espera >=2)...");
    let list = JSON.parse(await holder.listCredentials());
    console.log(`📦 total=${list.length}`);
    if (list.length < 2) throw new Error("Esperado >= 2 credenciais na lista.");

    // Vamos deletar a credencial END (por id_local vindo da lista)
    const toDelete = list.find((c) => c.id_local === endIdLocal) || list[0];
    if (!toDelete?.id_local) throw new Error("Lista sem id_local.");

    console.log(`\n12) holder.getStoredCredential("${toDelete.id_local}") (antes de deletar)...`);
    const beforeJson = await holder.getStoredCredential(toDelete.id_local);
    const before = JSON.parse(beforeJson);
    console.log("🔎 OK abriu. schema_id:", before.schema_id);

    console.log(`\n13) holder.deleteStoredCredential("${toDelete.id_local}")...`);
    const delOk = await holder.deleteStoredCredential(toDelete.id_local);
    if (delOk !== true) throw new Error("deleteStoredCredential não retornou true.");
    console.log("🗑️ OK deletou.");

    console.log("\n14) holder.listCredentials() (deve diminuir 1)...");
    const list2 = JSON.parse(await holder.listCredentials());
    console.log(`📦 total agora=${list2.length}`);
    if (list2.length !== list.length - 1) {
      throw new Error(`Esperado total=${list.length - 1}, obtido=${list2.length}`);
    }

    console.log(`\n15) holder.getStoredCredential("${toDelete.id_local}") (deve falhar)...`);
    let failed = false;
    try {
      await holder.getStoredCredential(toDelete.id_local);
    } catch (e) {
      failed = true;
      console.log("✅ Falhou como esperado:", e?.message || String(e));
    }
    if (!failed) throw new Error("Era esperado erro ao abrir credencial deletada.");

    console.log("\n✅ OK: deleteStoredCredential funcionando.");
  } finally {
    try { await issuer.walletClose(); } catch (_) {}
    try { await holder.walletClose(); } catch (_) {}
  }
})().catch((e) => {
  console.error("❌ FALHA NO TESTE:", e?.message || e);
  console.error(e?.stack || "");
  process.exit(1);
});
