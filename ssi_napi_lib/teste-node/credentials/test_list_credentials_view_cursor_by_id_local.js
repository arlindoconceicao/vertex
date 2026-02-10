/*
PARA RODAR ESTE TESTE:
TRUSTEE_SEED="000000000000000000000000Trustee1" \
TRUSTEE_DID="V4SGRU86Z58d6TV7PBUe6f" \
WALLET_PASS="minha_senha_teste" GENESIS_FILE=./genesis.txn \
node teste-node/credentials/test_list_credentials_view_cursor_by_id_local.js

O QUE ESTE TESTE FAZ:
- Emite 2 credenciais e faz store
- Clona END via export/import (new_id_local) => total 3
- Itera via cursor por id_local (limit=2) até next_cursor=null
- Valida:
  - itens vêm ordenados por id_local (lexicográfico)
  - união dos IDs == listCredentialsView("compact")
- Mode inválido deve falhar
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

function isSortedLex(arr) {
  for (let i = 1; i < arr.length; i++) {
    if (String(arr[i - 1]) > String(arr[i])) return false;
  }
  return true;
}

(async () => {
  const GENESIS_FILE = mustEnv("GENESIS_FILE");
  const WALLET_PASS = process.env.WALLET_PASS || "minha_senha_teste";
  const TRUSTEE_SEED = mustEnv("TRUSTEE_SEED");
  const TRUSTEE_DID = mustEnv("TRUSTEE_DID");

  const walletsDir = path.join(__dirname, "..", "wallets");
  fs.mkdirSync(walletsDir, { recursive: true });

  const issuerWalletPath = path.join(walletsDir, "issuer_cursor_by_id.db");
  const holderWalletPath = path.join(walletsDir, "holder_cursor_by_id.db");
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

    const cpfIdLocal = "cred-a-cpf"; // proposital: garante ordem previsível
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

    const endIdLocal = "cred-b-end";
    await holder.storeCredential(endIdLocal, credEndJson, reqMetaEndId, credDefEndJsonLedger, null);
    console.log("✅ Store OK (ENDERECO).");

    console.log("\n11) Clonando END via export/import (new_id_local)...");
    const pkgJson = await holder.exportStoredCredential(endIdLocal);
    const cloneId = "cred-c-end-clone";
    await holder.importStoredCredential(pkgJson, false, cloneId);
    console.log("✅ OK clone:", cloneId);

    const allCompact = JSON.parse(await holder.listCredentialsView("compact"));
    const allIds = new Set(allCompact.map((c) => c.id_local));
    if (allIds.size !== 3) throw new Error("Esperado total=3.");

    // ============================================================
    // Cursor loop (compact, limit=2)
    // ============================================================
    console.log('\n12) Iterando via listCredentialsViewCursorByIdLocal("compact", 2, cursor) ...');
    let cursor = null;
    const gotIds = [];
    const gotSet = new Set();
    let rounds = 0;

    while (true) {
      rounds += 1;
      const resp = JSON.parse(await holder.listCredentialsViewCursorByIdLocal("compact", 2, cursor));
      const items = resp.items || [];
      const next = resp.next_cursor ?? null;

      const ids = items.map((it) => it.id_local);
      if (!isSortedLex(ids)) throw new Error("Página não veio ordenada por id_local.");

      for (const id of ids) {
        gotIds.push(id);
        gotSet.add(id);
      }

      if (!next) break;
      cursor = next;

      if (rounds > 10) throw new Error("Loop cursor excedeu limite.");
    }

    if (gotSet.size !== allIds.size) throw new Error("União via cursor != total.");
    for (const id of allIds) {
      if (!gotSet.has(id)) throw new Error(`ID faltando via cursor: ${id}`);
    }
    console.log("✅ OK: cursor por id_local percorreu todo o inventário.");

    // ============================================================
    // Mode inválido
    // ============================================================
    console.log('\n13) Mode inválido (deve falhar) ...');
    let badModeFailed = false;
    try {
      await holder.listCredentialsViewCursorByIdLocal("invalid", 2, null);
    } catch (e) {
      badModeFailed = true;
      console.log("✅ Falhou como esperado:", e?.message || String(e));
    }
    if (!badModeFailed) throw new Error("Era esperado falhar com mode inválido.");

    console.log("\n✅ OK: listCredentialsViewCursorByIdLocal funcionando.");
  } finally {
    try { await issuer.walletClose(); } catch (_) {}
    try { await holder.walletClose(); } catch (_) {}
  }
})().catch((e) => {
  console.error("❌ FALHA NO TESTE:", e?.message || e);
  console.error(e?.stack || "");
  process.exit(1);
});
