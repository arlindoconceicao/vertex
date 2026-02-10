/*
PARA RODAR ESTE TESTE:
TRUSTEE_SEED="000000000000000000000000Trustee1" \
TRUSTEE_DID="V4SGRU86Z58d6TV7PBUe6f" \
WALLET_PASS="minha_senha_teste" GENESIS_FILE=./genesis.txn \
node teste-node/credentials/test_import_export_overwrite_false_should_fail.js

O QUE ESTE TESTE FAZ:
- Emite 2 credenciais e faz store no Holder (CPF e ENDERECO)
- Exporta ENDERECO (package)
- Tenta importar o MESMO package sem deletar (id_local já existe)
- Espera falhar com mensagem "já existe (overwrite=false)"
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

  const issuerWalletPath = path.join(walletsDir, "issuer_overwrite_false_fail.db");
  const holderWalletPath = path.join(walletsDir, "holder_overwrite_false_fail.db");
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

    await holder.storeCredential("cred-cpf-overwrite-false", credCpfJson, reqMetaCpfId, credDefCpfJsonLedger, null);
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

    const endIdLocal = "cred-end-overwrite-false";
    await holder.storeCredential(endIdLocal, credEndJson, reqMetaEndId, credDefEndJsonLedger, null);
    console.log("✅ Store OK (ENDERECO).");

    console.log("\n11) Exportando END...");
    const pkgJson = await holder.exportStoredCredential(endIdLocal);

    console.log("\n12) Tentando importar o MESMO package (overwrite=false) sem deletar...");
    let failed = false;
    try {
      await holder.importStoredCredential(pkgJson, false, null);
      console.log("❌ ERRO: import não deveria ter passado com overwrite=false.");
    } catch (e) {
      failed = true;
      const msg = e?.message || String(e);
      console.log("✅ Falhou como esperado:", msg);

      // Checagem mais fraca (para não depender 100% do texto exato)
      if (!/já existe|exists|overwrite=false/i.test(msg)) {
        throw new Error(`Mensagem inesperada. Esperava algo como "já existe/overwrite=false". Obtido: ${msg}`);
      }
    }

    if (!failed) throw new Error("Era esperado falhar ao importar com id_local já existente.");

    console.log("\n✅ OK: overwrite=false falha quando id_local já existe.");
  } finally {
    try { await issuer.walletClose(); } catch (_) {}
    try { await holder.walletClose(); } catch (_) {}
  }
})().catch((e) => {
  console.error("❌ FALHA NO TESTE:", e?.message || e);
  console.error(e?.stack || "");
  process.exit(1);
});
