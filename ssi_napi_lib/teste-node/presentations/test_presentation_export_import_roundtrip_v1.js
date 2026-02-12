/*
PARA RODAR ESTE TESTE:
TRUSTEE_SEED="000000000000000000000000Trustee1" \
TRUSTEE_DID="V4SGRU86Z58d6TV7PBUe6f" \
WALLET_PASS="minha_senha_teste" GENESIS_FILE=./genesis.txn \
node teste-node/presentations/test_presentation_export_import_roundtrip_v1.js

O QUE ESTE TESTE FAZ (EXPORT/IMPORT - OPÇÃO B):
- Cria e abre uma wallet limpa (reset)
- Armazena 1 apresentação local (storePresentation)
- Exporta a apresentação (exportStoredPresentation) => gera package JSON versionado
- Remove da wallet (deleteStoredPresentation) e valida que sumiu
- Importa novamente com mesmo id_local (importStoredPresentation, overwrite=false, new_id_local=null)
- Valida conteúdo via getStoredPresentation
- Importa novamente como CLONE com novo id_local (new_id_local = "<id>-clone")
- Valida que agora existem 2 itens na listagem
- Testa conflito sem overwrite (deve falhar)
- Testa overwrite=true (deve sobrescrever e manter o mesmo id_local)

IMPORTANTE:
- Este teste NÃO depende de ledger.
- GENESIS_FILE / TRUSTEE_* estão no cabeçalho só para manter o padrão da suíte.
- Requer que você tenha implementado na N-API:
  exportStoredPresentation (Rust: export_stored_presentation)
  importStoredPresentation (Rust: import_stored_presentation)
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

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT FAIL: ${msg}`);
}

function safeJsonParse(s, label) {
  try {
    return JSON.parse(s);
  } catch (e) {
    throw new Error(`${label}: JSON inválido: ${e?.message || e}`);
  }
}

function hasIdLocal(listArr, idLocal) {
  return Array.isArray(listArr) && listArr.some((x) => x && x.id_local === idLocal);
}

function dumpCompact(listArr) {
  if (!Array.isArray(listArr)) return String(listArr);
  return listArr.map((x) => x?.id_local).filter(Boolean).join(", ");
}

// -------------------------
// MAIN
// -------------------------
(async () => {
  // Mantemos o padrão de env (mesmo que não use ledger aqui)
  mustEnv("GENESIS_FILE");
  mustEnv("TRUSTEE_SEED");
  mustEnv("TRUSTEE_DID");

  const WALLET_PASS = process.env.WALLET_PASS || "minha_senha_teste";

  const walletsDir = path.join(__dirname, "..", "wallets");
  fs.mkdirSync(walletsDir, { recursive: true });

  const verifierWalletPath = path.join(walletsDir, "verifier_presentation_export_import_v1.db");
  rmIfExists(verifierWalletPath);

  const verifier = new IndyAgent();

  try {
    console.log("1) Criando wallet...");
    await verifier.walletCreate(verifierWalletPath, WALLET_PASS);

    console.log("2) Abrindo wallet...");
    await verifier.walletOpen(verifierWalletPath, WALLET_PASS);

    // ------------------------------------------------------------
    // Dados fake de apresentação (não depende de ledger)
    // ------------------------------------------------------------
    const ts = Date.now();
    const presIdLocal = `pres-local-${ts}`;

    const presentation = {
      "@type": "anoncreds/presentation",
      created_at: ts,
      thread_id: `th-${ts}`,
      requested_proof: {
        revealed_attrs: {
          attr_nome: { raw: "Edimar Veríssimo", encoded: "123" },
        },
        predicates: {
          pred_idade_ge_18: { sub_proof_index: 0 },
        },
      },
      proofs: [{ primary_proof: { eq_proof: {} }, non_revoc_proof: null }],
      identifiers: [{ schema_id: "schema:dummy", cred_def_id: "creddef:dummy" }],
    };

    const presentationRequest = {
      nonce: String(ts),
      name: "proof-dummy",
      version: "1.0",
      requested_attributes: { attr_nome: { name: "nome" } },
      requested_predicates: { pred_idade_ge_18: { name: "idade", p_type: ">=", p_value: 18 } },
    };

    const metaV1 = {
      role: "verifier",
      verified: true,
      verified_at: ts,
      note: "teste export/import roundtrip",
      rev: 1,
    };

    // ============================================================
    // STORE
    // ============================================================
    console.log("3) storePresentation...");
    const storedId = await verifier.storePresentation(
      presIdLocal,
      JSON.stringify(presentation),
      JSON.stringify(presentationRequest),
      JSON.stringify(metaV1)
    );
    assert(storedId === presIdLocal, "storePresentation deve retornar o mesmo id_local");

    // ============================================================
    // EXPORT
    // ============================================================
    console.log("4) exportStoredPresentation...");
    const pkgStr = await verifier.exportStoredPresentation(presIdLocal);
    assert(typeof pkgStr === "string" && pkgStr.length > 0, "exportStoredPresentation deve retornar string JSON");

    const pkgObj = safeJsonParse(pkgStr, "pkgStr");
    assert(pkgObj.type === "ssi.presentation.package", "pkg.type inválido");
    assert(pkgObj.version === 1, "pkg.version inválido");
    assert(pkgObj.id_local === presIdLocal, "pkg.id_local inconsistente");
    assert(pkgObj.record && pkgObj.record.presentation, "pkg.record.presentation ausente");

    // ============================================================
    // DELETE (para provar roundtrip)
    // ============================================================
    console.log("5) deleteStoredPresentation (removendo original)...");
    const delOk = await verifier.deleteStoredPresentation(presIdLocal);
    assert(delOk === true, "deleteStoredPresentation deve retornar true");

    console.log("6) Validando que getStoredPresentation falha após delete...");
    let gotErr = false;
    try {
      await verifier.getStoredPresentation(presIdLocal);
    } catch (e) {
      gotErr = true;
      const msg = e?.message || String(e);
      console.log(`✅ getStoredPresentation falhou como esperado: ${msg}`);
    }
    assert(gotErr, "getStoredPresentation deveria falhar após delete");

    // ============================================================
    // IMPORT (mesmo id_local)
    // ============================================================
    console.log("7) importStoredPresentation (mesmo id_local)...");
    const importedId = await verifier.importStoredPresentation(pkgStr, false, null);
    assert(importedId === presIdLocal, "importStoredPresentation deve retornar id_local original");

    console.log("8) getStoredPresentation (após import)...");
    const recStr1 = await verifier.getStoredPresentation(presIdLocal);
    const recObj1 = safeJsonParse(recStr1, "recStr1");
    assert(recObj1.presentation.thread_id === presentation.thread_id, "thread_id inconsistente após import");
    assert(recObj1.presentation_request.nonce === presentationRequest.nonce, "nonce inconsistente após import");
    assert(recObj1.meta.verified === true, "meta.verified inconsistente após import");
    assert(recObj1.meta.rev === 1, "meta.rev inconsistente após import");

    // ============================================================
    // IMPORT CLONE (new_id_local)
    // ============================================================
    console.log("9) importStoredPresentation (clone com new_id_local)...");
    const cloneId = `${presIdLocal}-clone`;
    const importedCloneId = await verifier.importStoredPresentation(pkgStr, false, cloneId);
    assert(importedCloneId === cloneId, "importStoredPresentation deve retornar cloneId");

    console.log("10) listPresentations (deve conter original e clone)...");
    const listStr1 = await verifier.listPresentations();
    const listArr1 = safeJsonParse(listStr1, "listStr1");
    assert(hasIdLocal(listArr1, presIdLocal), "listPresentations deve conter original");
    assert(hasIdLocal(listArr1, cloneId), "listPresentations deve conter clone");
    console.log(`📌 Itens: ${dumpCompact(listArr1)}`);

    // ============================================================
    // CONFLITO SEM OVERWRITE (deve falhar)
    // ============================================================
    console.log("11) importStoredPresentation (conflito, overwrite=false) deve falhar...");
    let conflictErr = false;
    try {
      await verifier.importStoredPresentation(pkgStr, false, null); // tenta importar novamente no mesmo id_local
    } catch (e) {
      conflictErr = true;
      const msg = e?.message || String(e);
      console.log(`✅ conflito detectado como esperado: ${msg}`);
      assert(/já existe|existe/i.test(msg), "mensagem deveria indicar conflito/exists");
    }
    assert(conflictErr, "importStoredPresentation deveria falhar em conflito sem overwrite");

    // ============================================================
    // OVERWRITE (deve sobrescrever mantendo id_local)
    // ============================================================
    console.log("12) importStoredPresentation (overwrite=true) sobrescrevendo meta...");
    const metaV2 = { ...metaV1, rev: 2, note: "overwrite aplicado" };

    // cria um novo package (mesmo formato) para simular nova versão do record
    const pkgObj2 = {
      ...pkgObj,
      record: {
        ...pkgObj.record,
        meta: metaV2,
      },
    };
    const pkgStr2 = JSON.stringify(pkgObj2);

    const overwrittenId = await verifier.importStoredPresentation(pkgStr2, true, null);
    assert(overwrittenId === presIdLocal, "overwrite deve manter o id_local");

    console.log("13) getStoredPresentation (validar overwrite)...");
    const recStr2 = await verifier.getStoredPresentation(presIdLocal);
    const recObj2 = safeJsonParse(recStr2, "recStr2");
    assert(recObj2.meta.rev === 2, "overwrite não aplicou meta.rev=2");
    assert(recObj2.meta.note === "overwrite aplicado", "overwrite não aplicou meta.note");

    console.log("✅ OK: TESTE export/import roundtrip (Opção B) passou.");
  } finally {
    try { await verifier.walletClose(); } catch (_) {}
  }
})().catch((e) => {
  console.error("FALHA NO TESTE:", e?.message || e);
  console.error(e?.stack || "");
  process.exit(1);
});
