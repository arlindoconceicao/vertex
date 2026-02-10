/*
PARA RODAR ESTE TESTE:
TRUSTEE_SEED="000000000000000000000000Trustee1" \
TRUSTEE_DID="V4SGRU86Z58d6TV7PBUe6f" \
WALLET_PASS="minha_senha_teste" GENESIS_FILE=./genesis.txn \
node teste-node/credentials/test_list_and_get_stored_credentials.js

O QUE ESTE TESTE FAZ:
- Cria DIDs do issuer e do holder via createOwnDid()
- Registra ambos no ledger via Trustee (ignora se já existir)
- Cria 2 Schemas + 2 CredDefs (CPF e ENDERECO)
- Emite 2 credenciais (CPF e ENDERECO) e faz store no Holder
- CHAMA AS NOVAS FUNÇÕES:
  - holder.listCredentials() -> imprime a lista
  - holder.getStoredCredential(id_local) -> abre 1 credencial e imprime detalhes

OBS:
- Este teste não usa troca por arquivos cifrados (para ficar focado no armazenamento/listagem).
- Se quiser, dá para adaptar para "strict file exchange", mas não é necessário para testar list/get.
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

// -------------------------
// Ledger: register DID (ignore if exists)
// -------------------------
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
// Pretty prints
// -------------------------
function printCredList(list) {
  console.log(`\n📦 Credenciais encontradas: ${list.length}\n`);
  list.forEach((c, idx) => {
    console.log(`--- [${idx}] -----------------------------`);
    console.log(`id_local   : ${c.id_local}`);
    console.log(`schema_id  : ${c.schema_id}`);
    console.log(`cred_def_id: ${c.cred_def_id}`);
    console.log(`stored_at  : ${c.stored_at}`);
    console.log(`values_raw :`, c.values_raw);
  });
}

// -------------------------
// MAIN
// -------------------------
(async () => {
  const GENESIS_FILE = mustEnv("GENESIS_FILE");
  const WALLET_PASS = process.env.WALLET_PASS || "minha_senha_teste";

  // Trustee via ENV
  const TRUSTEE_SEED = mustEnv("TRUSTEE_SEED");
  const TRUSTEE_DID = mustEnv("TRUSTEE_DID");

  // Wallets (reset)
  const walletsDir = path.join(__dirname, "..", "wallets");
  fs.mkdirSync(walletsDir, { recursive: true });

  const issuerWalletPath = path.join(walletsDir, "issuer_list_get_creds.db");
  const holderWalletPath = path.join(walletsDir, "holder_list_get_creds.db");
  rmIfExists(issuerWalletPath);
  rmIfExists(holderWalletPath);

  // Agentes
  const issuer = new IndyAgent();
  const holder = new IndyAgent();

  try {
    // ============================================================
    // SETUP
    // ============================================================
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

    // ============================================================
    // 1) Criar DIDs (issuer + holder) e publicar (via Trustee)
    // ============================================================
    console.log("5) Issuer criando DID (createOwnDid)...");
    const [issuerDid, issuerVerkey] = await issuer.createOwnDid();

    console.log("6) Holder criando DID (createOwnDid)...");
    const [holderDid, holderVerkey] = await holder.createOwnDid();

    console.log("7) Registrando DIDs no ledger (NYM) via Trustee...");
    await tryRegisterDid(issuer, GENESIS_FILE, TRUSTEE_DID, issuerDid, issuerVerkey, "ENDORSER");
    await tryRegisterDid(issuer, GENESIS_FILE, TRUSTEE_DID, holderDid, holderVerkey, null);

    // ============================================================
    // 2) Criar Schema + CredDef (2 credenciais)
    // ============================================================
    console.log("8) Issuer criando+registrando Schema CPF...");
    const schemaCpfVer = `1.0.${Date.now()}`;
    const schemaCpfId = await issuer.createAndRegisterSchema(
      GENESIS_FILE,
      issuerDid,
      "cpf",
      schemaCpfVer,
      ["nome", "cpf", "idade"]
    );

    console.log("9) Issuer criando+registrando Schema ENDERECO...");
    const schemaEndVer = `1.0.${Date.now()}`;
    const schemaEndId = await issuer.createAndRegisterSchema(
      GENESIS_FILE,
      issuerDid,
      "endereco",
      schemaEndVer,
      ["nome", "endereco", "cidade", "estado"]
    );

    console.log("10) Issuer criando+registrando CredDef CPF...");
    const credDefCpfTag = `TAG_CPF_${Date.now()}`;
    const credDefCpfId = await issuer.createAndRegisterCredDef(
      GENESIS_FILE,
      issuerDid,
      schemaCpfId,
      credDefCpfTag
    );

    console.log("11) Issuer criando+registrando CredDef ENDERECO...");
    const credDefEndTag = `TAG_END_${Date.now()}`;
    const credDefEndId = await issuer.createAndRegisterCredDef(
      GENESIS_FILE,
      issuerDid,
      schemaEndId,
      credDefEndTag
    );

    console.log("12) Garantindo Link Secret no holder...");
    try { await holder.createLinkSecret("default"); } catch (_) {}

    // ============================================================
    // 3) Emissão + Store: CPF
    // ============================================================
    console.log("\n13) Emissão CPF...");
    const offerCpfId = `offer-cpf-${Date.now()}`;
    const offerCpfJson = await issuer.createCredentialOffer(credDefCpfId, offerCpfId);

    // Holder precisa do CredDef (ledger)
    const credDefCpfJsonLedger = await holder.fetchCredDefFromLedger(GENESIS_FILE, credDefCpfId);

    const reqCpfJson = await holder.createCredentialRequest(
      "default",
      holderDid,
      credDefCpfJsonLedger,
      offerCpfJson
    );

    // Para store, o holder precisa do reqMetaId -> no seu fluxo atual vocês usam nonce do offer
    const offerCpfObj = JSON.parse(offerCpfJson);
    const reqMetaCpfId = offerCpfObj?.nonce;
    if (!reqMetaCpfId) throw new Error("CPF: Offer sem nonce (reqMetaId).");

    // ⚠️ Para predicado/ZKP: idade deve ser "string numérica" (ex: "35"), não número 35.
    const valuesCpf = {
      nome: "Edimar Veríssimo",
      cpf: "123.456.789-09",
      idade: "35",
    };

    const credCpfJson = await issuer.createCredential(
      credDefCpfId,
      offerCpfJson,
      reqCpfJson,
      JSON.stringify(valuesCpf)
    );

    const credCpfIdInWallet = "cred-cpf-list-get";
    await holder.storeCredential(
      credCpfIdInWallet,
      credCpfJson,
      reqMetaCpfId,
      credDefCpfJsonLedger,
      null
    );

    console.log("✅ Store OK (CPF).");

    // ============================================================
    // 4) Emissão + Store: ENDERECO
    // ============================================================
    console.log("\n14) Emissão ENDERECO...");
    const offerEndId = `offer-end-${Date.now()}`;
    const offerEndJson = await issuer.createCredentialOffer(credDefEndId, offerEndId);

    const credDefEndJsonLedger = await holder.fetchCredDefFromLedger(GENESIS_FILE, credDefEndId);

    const reqEndJson = await holder.createCredentialRequest(
      "default",
      holderDid,
      credDefEndJsonLedger,
      offerEndJson
    );

    const offerEndObj = JSON.parse(offerEndJson);
    const reqMetaEndId = offerEndObj?.nonce;
    if (!reqMetaEndId) throw new Error("END: Offer sem nonce (reqMetaId).");

    const valuesEnd = {
      nome: "Edimar Veríssimo",
      endereco: "Rua Exemplo, 123",
      cidade: "São Paulo",
      estado: "SP",
    };

    const credEndJson = await issuer.createCredential(
      credDefEndId,
      offerEndJson,
      reqEndJson,
      JSON.stringify(valuesEnd)
    );

    const credEndIdInWallet = "cred-end-list-get";
    await holder.storeCredential(
      credEndIdInWallet,
      credEndJson,
      reqMetaEndId,
      credDefEndJsonLedger,
      null
    );

    console.log("✅ Store OK (ENDERECO).");

    // ============================================================
    // 5) TESTE: NOVAS FUNÇÕES
    // ============================================================
    console.log("\n15) Chamando holder.listCredentials() ...");
    const listJson = await holder.listCredentials();
    const list = JSON.parse(listJson);

    printCredList(list);

    if (!Array.isArray(list) || list.length === 0) {
      throw new Error("Nenhuma credencial retornada por listCredentials().");
    }

    const pick = list[0];
    if (!pick?.id_local) throw new Error("Lista retornou item sem id_local.");

    console.log(`\n16) Chamando holder.getStoredCredential("${pick.id_local}") ...`);
    const oneJson = await holder.getStoredCredential(pick.id_local);
    const one = JSON.parse(oneJson);

    console.log("\n🔎 Credencial (JSON completo) aberta por id_local:");
    console.log(JSON.stringify(one, null, 2));

    console.log("\n✅ OK: listCredentials + getStoredCredential funcionando.");
  } finally {
    try { await issuer.walletClose(); } catch (_) {}
    try { await holder.walletClose(); } catch (_) {}
  }
})().catch((e) => {
  console.error("❌ FALHA NO TESTE:", e?.message || e);
  console.error(e?.stack || "");
  process.exit(1);
});
