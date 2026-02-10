/*
PARA RODAR ESTE TESTE:
TRUSTEE_SEED="000000000000000000000000Trustee1" \
TRUSTEE_DID="V4SGRU86Z58d6TV7PBUe6f" \
WALLET_PASS="minha_senha_teste" GENESIS_FILE=./genesis.txn \
node teste-node/credentials/test_list_credentials_view_paged.js

O QUE ESTE TESTE FAZ:
- Emite 2 credenciais (CPF e END) e faz store
- Seta alias na END
- Faz clone da END via export/import com new_id_local => total 3 credenciais
- Valida paginação:
  - compact limit=2 offset=0 => 2 itens
  - compact limit=2 offset=2 => 1 item
  - união das páginas == listCredentialsView("compact")
  - full também retorna a contagem esperada por página e possui values_raw
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
  for (const k of ["id_local", "schema_id", "cred_def_id", "stored_at"]) {
    if (!item?.[k]) throw new Error(`${label}: faltando ${k}`);
  }
  if (Object.prototype.hasOwnProperty.call(item, "values_raw")) {
    throw new Error(`${label}: compact não pode ter values_raw`);
  }
}

(async () => {
  const GENESIS_FILE = mustEnv("GENESIS_FILE");
  const WALLET_PASS = process.env.WALLET_PASS || "minha_senha_teste";
  const TRUSTEE_SEED = mustEnv("TRUSTEE_SEED");
  const TRUSTEE_DID = mustEnv("TRUSTEE_DID");

  const walletsDir = path.join(__dirname, "..", "wallets");
  fs.mkdirSync(walletsDir, { recursive: true });

  const issuerWalletPath = path.join(walletsDir, "issuer_list_view_paged.db");
  const holderWalletPath = path.join(walletsDir, "holder_list_view_paged.db");
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

    const cpfIdLocal = "cred-cpf-view-paged";
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

    const endIdLocal = "cred-end-view-paged";
    await holder.storeCredential(endIdLocal, credEndJson, reqMetaEndId, credDefEndJsonLedger, null);
    console.log("✅ Store OK (ENDERECO).");

    console.log("\n11) Setando alias na END...");
    await holder.setStoredCredentialAlias(endIdLocal, "Endereço - Casa");

    console.log("\n12) Clonando END via export/import (new_id_local)...");
    const pkgJson = await holder.exportStoredCredential(endIdLocal);
    const cloneId = `cred-end-clone-paged-${Date.now()}`;
    const importedId = await holder.importStoredCredential(pkgJson, false, cloneId);
    if (importedId !== cloneId) throw new Error("Clone retornou id inesperado.");
    console.log("✅ OK clone:", cloneId);

    // Referência total (compact sem paginação)
    const allCompact = JSON.parse(await holder.listCredentialsView("compact"));
    if (!Array.isArray(allCompact) || allCompact.length !== 3) {
      throw new Error(`Esperado total=3 no compact, obtido=${Array.isArray(allCompact) ? allCompact.length : "N/A"}`);
    }

    // ============================================================
    // PAGED COMPACT
    // ============================================================
    console.log('\n13) listCredentialsViewPaged("compact", 2, 0) ...');
    const p0 = JSON.parse(await holder.listCredentialsViewPaged("compact", 2, 0));
    if (!Array.isArray(p0) || p0.length !== 2) throw new Error(`p0: esperado 2, obtido ${p0?.length}`);
    p0.forEach((it, i) => mustHaveCompactShape(it, `p0[${i}]`));

    console.log('\n14) listCredentialsViewPaged("compact", 2, 2) ...');
    const p1 = JSON.parse(await holder.listCredentialsViewPaged("compact", 2, 2));
    if (!Array.isArray(p1) || p1.length !== 1) throw new Error(`p1: esperado 1, obtido ${p1?.length}`);
    p1.forEach((it, i) => mustHaveCompactShape(it, `p1[${i}]`));

    const unionIds = new Set([...p0, ...p1].map((c) => c.id_local));
    const allIds = new Set(allCompact.map((c) => c.id_local));
    if (unionIds.size !== allIds.size) throw new Error("União das páginas != total (compact).");
    for (const id of allIds) {
      if (!unionIds.has(id)) throw new Error(`ID faltando na união das páginas (compact): ${id}`);
    }
    console.log("✅ OK: paginação compact cobre todo o inventário.");

    // ============================================================
    // PAGED FULL (só checar count e values_raw)
    // ============================================================
    console.log('\n15) listCredentialsViewPaged("full", 2, 0) ...');
    const f0 = JSON.parse(await holder.listCredentialsViewPaged("full", 2, 0));
    if (!Array.isArray(f0) || f0.length !== 2) throw new Error(`f0: esperado 2, obtido ${f0?.length}`);
    if (!f0[0]?.values_raw || typeof f0[0].values_raw !== "object") throw new Error("f0: esperado values_raw.");

    console.log('\n16) listCredentialsViewPaged("full", 2, 2) ...');
    const f1 = JSON.parse(await holder.listCredentialsViewPaged("full", 2, 2));
    if (!Array.isArray(f1) || f1.length !== 1) throw new Error(`f1: esperado 1, obtido ${f1?.length}`);
    if (!f1[0]?.values_raw || typeof f1[0].values_raw !== "object") throw new Error("f1: esperado values_raw.");

    console.log("✅ OK: paginação full retorna values_raw.");

    // ============================================================
    // MODE INVÁLIDO
    // ============================================================
    console.log('\n17) listCredentialsViewPaged("invalid", 2, 0) (deve falhar) ...');
    let failed = false;
    try {
      await holder.listCredentialsViewPaged("invalid", 2, 0);
    } catch (e) {
      failed = true;
      console.log("✅ Falhou como esperado:", e?.message || String(e));
    }
    if (!failed) throw new Error("Era esperado falhar com mode inválido.");

    console.log("\n✅ OK: listCredentialsViewPaged(mode, limit, offset) funcionando.");
  } finally {
    try { await issuer.walletClose(); } catch (_) {}
    try { await holder.walletClose(); } catch (_) {}
  }
})().catch((e) => {
  console.error("❌ FALHA NO TESTE:", e?.message || e);
  console.error(e?.stack || "");
  process.exit(1);
});
