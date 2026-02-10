/*
PARA RODAR ESTE TESTE:
TRUSTEE_SEED="000000000000000000000000Trustee1" \
TRUSTEE_DID="V4SGRU86Z58d6TV7PBUe6f" \
WALLET_PASS="minha_senha_teste" GENESIS_FILE=./genesis.txn \
node teste-node/credentials/test_list_credentials_view_cursor.js

O QUE ESTE TESTE FAZ:
- Emite 2 credenciais (CPF e END) e faz store
- Seta alias na END
- Faz clone da END via export/import com new_id_local => total 3 credenciais
- Itera via cursor (compact, limit=2) até next_cursor=null
- Valida: união dos IDs == listCredentialsView("compact")
- Testa cursor inválido e mode inválido
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

  const issuerWalletPath = path.join(walletsDir, "issuer_list_view_cursor.db");
  const holderWalletPath = path.join(walletsDir, "holder_list_view_cursor.db");
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
    const reqCpfJson = await holder.createCredentialRequest("default", holderDid, credDefCpfJsonLedger, offerCpfJson);

    const credCpfJson = await issuer.createCredential(
      credDefCpfId,
      offerCpfJson,
      reqCpfJson,
      JSON.stringify({ nome: "Edimar Veríssimo", cpf: "123.456.789-09", idade: "35" })
    );

    const cpfIdLocal = "cred-cpf-cursor";
    await holder.storeCredential(cpfIdLocal, credCpfJson, reqMetaCpfId, credDefCpfJsonLedger, null);
    console.log("✅ Store OK (CPF).");

    // END
    console.log("10) Emissão ENDERECO...");
    const offerEndJson = await issuer.createCredentialOffer(credDefEndId, `offer-end-${Date.now()}`);
    const reqMetaEndId = JSON.parse(offerEndJson)?.nonce;
    if (!reqMetaEndId) throw new Error("END: Offer sem nonce (reqMetaId).");

    const credDefEndJsonLedger = await holder.fetchCredDefFromLedger(GENESIS_FILE, credDefEndId);
    const reqEndJson = await holder.createCredentialRequest("default", holderDid, credDefEndJsonLedger, offerEndJson);

    const credEndJson = await issuer.createCredential(
      credDefEndId,
      offerEndJson,
      reqEndJson,
      JSON.stringify({ nome: "Edimar Veríssimo", endereco: "Rua Exemplo, 123", cidade: "São Paulo", estado: "SP" })
    );

    const endIdLocal = "cred-end-cursor";
    await holder.storeCredential(endIdLocal, credEndJson, reqMetaEndId, credDefEndJsonLedger, null);
    console.log("✅ Store OK (ENDERECO).");

    console.log("\n11) Setando alias na END...");
    await holder.setStoredCredentialAlias(endIdLocal, "Endereço - Casa");

    console.log("\n12) Clonando END via export/import (new_id_local)...");
    const pkgJson = await holder.exportStoredCredential(endIdLocal);
    const cloneId = `cred-end-clone-cursor-${Date.now()}`;
    const importedId = await holder.importStoredCredential(pkgJson, false, cloneId);
    if (importedId !== cloneId) throw new Error("Clone retornou id inesperado.");
    console.log("✅ OK clone:", cloneId);

    // Referência total (compact)
    const allCompact = JSON.parse(await holder.listCredentialsView("compact"));
    if (!Array.isArray(allCompact) || allCompact.length !== 3) {
      throw new Error(`Esperado total=3 no compact, obtido=${Array.isArray(allCompact) ? allCompact.length : "N/A"}`);
    }
    const allIds = new Set(allCompact.map((c) => c.id_local));

    // ============================================================
    // Cursor loop (compact, limit=2)
    // ============================================================
    console.log('\n13) Iterando via listCredentialsViewCursor("compact", 2, cursor) ...');
    let cursor = null;
    const gotIds = new Set();
    let rounds = 0;

    while (true) {
      rounds += 1;
      const resp = JSON.parse(await holder.listCredentialsViewCursor("compact", 2, cursor));
      const items = resp.items || [];
      const next = resp.next_cursor ?? null;

      if (!Array.isArray(items)) throw new Error("cursor: items inválido.");
      for (const it of items) {
        if (!it.id_local) throw new Error("cursor: item sem id_local.");
        gotIds.add(it.id_local);
      }

      if (!next) {
        cursor = null;
        break;
      }
      cursor = next;

      if (rounds > 10) throw new Error("Loop cursor excedeu limite (possível cursor infinito).");
    }

    if (gotIds.size !== allIds.size) throw new Error("Cursor union != total (compact).");
    for (const id of allIds) {
      if (!gotIds.has(id)) throw new Error(`ID faltando via cursor: ${id}`);
    }
    console.log("✅ OK: cursor percorreu todo o inventário (compact).");

    // ============================================================
    // Cursor inválido
    // ============================================================
    console.log('\n14) Cursor inválido (deve falhar) ...');
    let badCursorFailed = false;
    try {
      await holder.listCredentialsViewCursor("compact", 2, "abc");
    } catch (e) {
      badCursorFailed = true;
      console.log("✅ Falhou como esperado:", e?.message || String(e));
    }
    if (!badCursorFailed) throw new Error("Era esperado falhar com cursor inválido.");

    // ============================================================
    // Mode inválido
    // ============================================================
    console.log('\n15) Mode inválido (deve falhar) ...');
    let badModeFailed = false;
    try {
      await holder.listCredentialsViewCursor("invalid", 2, null);
    } catch (e) {
      badModeFailed = true;
      console.log("✅ Falhou como esperado:", e?.message || String(e));
    }
    if (!badModeFailed) throw new Error("Era esperado falhar com mode inválido.");

    console.log("\n✅ OK: listCredentialsViewCursor(mode, limit, cursor) funcionando.");
  } finally {
    try { await issuer.walletClose(); } catch (_) {}
    try { await holder.walletClose(); } catch (_) {}
  }
})().catch((e) => {
  console.error("❌ FALHA NO TESTE:", e?.message || e);
  console.error(e?.stack || "");
  process.exit(1);
});
