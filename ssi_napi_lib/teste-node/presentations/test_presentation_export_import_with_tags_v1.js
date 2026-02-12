/*
PARA RODAR ESTE TESTE:
TRUSTEE_SEED="000000000000000000000000Trustee1" \
TRUSTEE_DID="V4SGRU86Z58d6TV7PBUe6f" \
WALLET_PASS="minha_senha_teste" GENESIS_FILE=./genesis.txn \
node teste-node/presentations/test_presentation_export_import_with_tags_v1.js

O QUE ESTE TESTE FAZ (EXPORT/IMPORT COM TAGS NO PACKAGE - V1):
- Cria e abre uma wallet limpa (reset)
- Store de 1 apresentação com presentation_request (para gerar tag request_nonce)
- Lista e captura tags do item original (created_at, request_nonce)
- Exporta a apresentação e valida que o package inclui tags
- Deleta a apresentação e valida que sumiu
- Importa novamente (mesmo id_local) e valida que:
  - getStoredPresentation bate
  - listPresentations contém o item
  - tags após import foram reaplicadas (created_at/request_nonce iguais ao package)
- Importa clone (new_id_local) e valida:
  - clone aparece na listagem
  - clone recebeu as mesmas tags do package
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

function findByIdLocal(listArr, idLocal) {
  if (!Array.isArray(listArr)) return null;
  return listArr.find((x) => x && x.id_local === idLocal) || null;
}

function normTagVal(v) {
  // seu listPresentations usa t.value() => geralmente string;
  // mas vamos normalizar defensivamente.
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  return String(v);
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

  const walletPath = path.join(walletsDir, "verifier_presentation_export_import_tags_v1.db");
  rmIfExists(walletPath);

  const verifier = new IndyAgent();

  try {
    console.log("1) Criando wallet...");
    await verifier.walletCreate(walletPath, WALLET_PASS);

    console.log("2) Abrindo wallet...");
    await verifier.walletOpen(walletPath, WALLET_PASS);

    // ------------------------------------------------------------
    // Dados fake de apresentação
    // ------------------------------------------------------------
    const ts = Date.now();
    const presIdLocal = `pres-tags-${ts}`;

    const presentation = {
      "@type": "anoncreds/presentation",
      created_at: ts,
      thread_id: `th-tags-${ts}`,
      requested_proof: {
        revealed_attrs: { attr_nome: { raw: "Edimar Veríssimo", encoded: "123" } },
        predicates: { pred_idade_ge_18: { sub_proof_index: 0 } },
      },
      proofs: [{ primary_proof: { eq_proof: {} }, non_revoc_proof: null }],
      identifiers: [{ schema_id: "schema:dummy", cred_def_id: "creddef:dummy" }],
    };

    // IMPORTANTE: nonce aqui deve gerar tag request_nonce no store
    const presentationRequest = {
      nonce: String(ts),
      name: "proof-tags",
      version: "1.0",
      requested_attributes: { attr_nome: { name: "nome" } },
      requested_predicates: { pred_idade_ge_18: { name: "idade", p_type: ">=", p_value: 18 } },
    };

    const meta = { role: "verifier", verified: true, verified_at: ts, note: "teste tags", rev: 1 };

    // ============================================================
    // STORE
    // ============================================================
    console.log("3) storePresentation...");
    const storedId = await verifier.storePresentation(
      presIdLocal,
      JSON.stringify(presentation),
      JSON.stringify(presentationRequest),
      JSON.stringify(meta)
    );
    assert(storedId === presIdLocal, "storePresentation deve retornar o mesmo id_local");

    // ============================================================
    // LIST (capturar tags originais)
    // ============================================================
    console.log("4) listPresentations (capturar tags do original)...");
    const listStr0 = await verifier.listPresentations();
    const listArr0 = safeJsonParse(listStr0, "listStr0");
    const item0 = findByIdLocal(listArr0, presIdLocal);
    assert(!!item0, "listPresentations deve conter o id_local armazenado");
    assert(item0.tags && typeof item0.tags === "object", "item0.tags deve existir");

    const origCreatedAt = normTagVal(item0.tags.created_at);
    const origReqNonce = normTagVal(item0.tags.request_nonce);

    assert(origCreatedAt.length > 0, "tag created_at deve existir");
    assert(origReqNonce === String(ts), "tag request_nonce deve ser igual ao nonce do presentationRequest");

    console.log(`   - tags(orig): created_at=${origCreatedAt} request_nonce=${origReqNonce}`);

    // ============================================================
    // EXPORT (deve carregar tags)
    // ============================================================
    console.log("5) exportStoredPresentation (deve incluir tags)...");
    const pkgStr = await verifier.exportStoredPresentation(presIdLocal);
    const pkgObj = safeJsonParse(pkgStr, "pkgStr");

    assert(pkgObj.type === "ssi.presentation.package", "pkg.type inválido");
    assert(pkgObj.version === 1, "pkg.version inválido");
    assert(pkgObj.id_local === presIdLocal, "pkg.id_local inconsistente");
    assert(pkgObj.record && pkgObj.record.presentation, "pkg.record.presentation ausente");
    assert(pkgObj.tags && typeof pkgObj.tags === "object", "pkg.tags ausente");
    assert(normTagVal(pkgObj.tags.created_at).length > 0, "pkg.tags.created_at ausente");
    assert(normTagVal(pkgObj.tags.request_nonce) === String(ts), "pkg.tags.request_nonce inconsistente");

    const pkgCreatedAt = normTagVal(pkgObj.tags.created_at);
    const pkgReqNonce = normTagVal(pkgObj.tags.request_nonce);

    console.log(`   - tags(pkg):  created_at=${pkgCreatedAt} request_nonce=${pkgReqNonce}`);

    // ============================================================
    // DELETE (para provar roundtrip)
    // ============================================================
    console.log("6) deleteStoredPresentation (removendo original)...");
    const delOk = await verifier.deleteStoredPresentation(presIdLocal);
    assert(delOk === true, "deleteStoredPresentation deve retornar true");

    console.log("7) Validando que getStoredPresentation falha após delete...");
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
    // IMPORT (mesmo id_local) — deve reaplicar tags do package
    // ============================================================
    console.log("8) importStoredPresentation (mesmo id_local, reaplicar tags do package)...");
    const importedId = await verifier.importStoredPresentation(pkgStr, false, null);
    assert(importedId === presIdLocal, "importStoredPresentation deve retornar id_local original");

    console.log("9) listPresentations (validar tags após import)...");
    const listStr1 = await verifier.listPresentations();
    const listArr1 = safeJsonParse(listStr1, "listStr1");
    const item1 = findByIdLocal(listArr1, presIdLocal);
    assert(!!item1, "após import, listPresentations deve conter o item");
    assert(item1.tags && typeof item1.tags === "object", "item1.tags deve existir");

    const impCreatedAt = normTagVal(item1.tags.created_at);
    const impReqNonce = normTagVal(item1.tags.request_nonce);

    assert(impCreatedAt === pkgCreatedAt, "created_at após import deve ser igual ao do package");
    assert(impReqNonce === pkgReqNonce, "request_nonce após import deve ser igual ao do package");

    console.log(`   - tags(import): created_at=${impCreatedAt} request_nonce=${impReqNonce}`);

    // (opcional) validar conteúdo do record via get
    console.log("10) getStoredPresentation (validar record após import)...");
    const recStr1 = await verifier.getStoredPresentation(presIdLocal);
    const recObj1 = safeJsonParse(recStr1, "recStr1");
    assert(recObj1.presentation.thread_id === presentation.thread_id, "thread_id inconsistente após import");
    assert(recObj1.presentation_request.nonce === String(ts), "nonce inconsistente após import");
    assert(recObj1.meta.rev === 1, "meta.rev inconsistente após import");

    // ============================================================
    // IMPORT CLONE (new_id_local) — clone deve herdar tags do package
    // ============================================================
    console.log("11) importStoredPresentation (clone com new_id_local, herdar tags)...");
    const cloneId = `${presIdLocal}-clone`;
    const importedCloneId = await verifier.importStoredPresentation(pkgStr, false, cloneId);
    assert(importedCloneId === cloneId, "importStoredPresentation deve retornar cloneId");

    console.log("12) listPresentations (validar clone + tags)...");
    const listStr2 = await verifier.listPresentations();
    const listArr2 = safeJsonParse(listStr2, "listStr2");

    const itemClone = findByIdLocal(listArr2, cloneId);
    assert(!!itemClone, "listPresentations deve conter clone");
    assert(itemClone.tags && typeof itemClone.tags === "object", "clone.tags deve existir");

    const cloneCreatedAt = normTagVal(itemClone.tags.created_at);
    const cloneReqNonce = normTagVal(itemClone.tags.request_nonce);

    assert(cloneCreatedAt === pkgCreatedAt, "clone.created_at deve ser igual ao do package");
    assert(cloneReqNonce === pkgReqNonce, "clone.request_nonce deve ser igual ao do package");

    console.log(`   - tags(clone):  created_at=${cloneCreatedAt} request_nonce=${cloneReqNonce}`);

    console.log("✅ OK: TESTE export/import com tags (V1) passou.");
  } finally {
    try { await verifier.walletClose(); } catch (_) {}
  }
})().catch((e) => {
  console.error("FALHA NO TESTE:", e?.message || e);
  console.error(e?.stack || "");
  process.exit(1);
});
