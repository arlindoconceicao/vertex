/*
PARA RODAR ESTE TESTE:
TRUSTEE_SEED="000000000000000000000000Trustee1" \
TRUSTEE_DID="V4SGRU86Z58d6TV7PBUe6f" \
WALLET_PASS="minha_senha_teste" GENESIS_FILE=./genesis.txn \
node teste-node/presentations/test_presentation_store_get_list_delete.js

O QUE ESTE TESTE FAZ:
- Cria e abre uma wallet limpa (reset)
- Executa o ciclo completo de persistência de apresentação no wallet (Verifier use-case):
  1) storePresentation (Rust: store_presentation)
  2) getStoredPresentation (Rust: get_stored_presentation)
  3) listPresentations (Rust: list_presentations)
  4) deleteStoredPresentation (Rust: delete_stored_presentation)
- Valida:
  - que o record retornado no get bate com o que foi armazenado
  - que a listagem contém o id_local
  - que após delete, o get falha e a listagem não contém mais o id_local

IMPORTANTE:
- Este teste NÃO depende de ledger.
- GENESIS_FILE / TRUSTEE_* estão no cabeçalho só para manter o padrão da suíte.
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

  const verifierWalletPath = path.join(walletsDir, "verifier_presentation_store_test.db");
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

    // Um objeto com “cara de presentation”, mas serve qualquer JSON válido
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

    // Opcional: presentation_request (se o verifier tiver)
    const presentationRequest = {
      nonce: String(ts),
      name: "proof-dummy",
      version: "1.0",
      requested_attributes: { attr_nome: { name: "nome" } },
      requested_predicates: { pred_idade_ge_18: { name: "idade", p_type: ">=", p_value: 18 } },
    };

    // Meta livre: útil pra auditoria
    const meta = {
      role: "verifier",
      verified: true,
      verified_at: ts,
      note: "teste store/get/list/delete",
    };

    // ------------------------------------------------------------
    // 1) STORE
    // ------------------------------------------------------------
    console.log("3) storePresentation...");
    // NAPI camelCase (Rust snake_case)
    const storedId = await verifier.storePresentation(
      presIdLocal,
      JSON.stringify(presentation),
      JSON.stringify(presentationRequest),
      JSON.stringify(meta)
    );
    assert(storedId === presIdLocal, "storePresentation deve retornar o mesmo id_local");

    // ------------------------------------------------------------
    // 2) GET
    // ------------------------------------------------------------
    console.log("4) getStoredPresentation...");
    const recordStr = await verifier.getStoredPresentation(presIdLocal);
    assert(typeof recordStr === "string" && recordStr.length > 0, "getStoredPresentation deve retornar string JSON");

    const recordObj = safeJsonParse(recordStr, "recordStr");
    assert(recordObj && typeof recordObj === "object", "recordObj deve ser objeto");

    // O record V1 sugerido tem chaves: presentation, presentation_request, meta
    assert(recordObj.presentation, "recordObj.presentation ausente");
    assert(recordObj.presentation_request, "recordObj.presentation_request ausente (esperado no teste)");
    assert(recordObj.meta, "recordObj.meta ausente (esperado no teste)");

    // valida conteúdo principal
    assert(recordObj.presentation.thread_id === presentation.thread_id, "presentation.thread_id inconsistente");
    assert(recordObj.presentation_request.nonce === presentationRequest.nonce, "presentation_request.nonce inconsistente");
    assert(recordObj.meta.verified === true, "meta.verified inconsistente");

    // ------------------------------------------------------------
    // 3) LIST
    // ------------------------------------------------------------
    console.log("5) listPresentations...");
    const listStr = await verifier.listPresentations();
    const listArr = safeJsonParse(listStr, "listStr");
    assert(Array.isArray(listArr), "listPresentations deve retornar JSON array");

    const found = listArr.find((x) => x && x.id_local === presIdLocal);
    assert(!!found, "listPresentations deve conter o id_local recém armazenado");

    // ------------------------------------------------------------
    // 4) DELETE
    // ------------------------------------------------------------
    console.log("6) deleteStoredPresentation...");
    const delOk = await verifier.deleteStoredPresentation(presIdLocal);
    assert(delOk === true, "deleteStoredPresentation deve retornar true");

    // GET deve falhar após delete
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

    // LIST não deve conter mais
    console.log("8) Validando que listPresentations não contém após delete...");
    const list2Str = await verifier.listPresentations();
    const list2Arr = safeJsonParse(list2Str, "list2Str");
    const found2 = list2Arr.find((x) => x && x.id_local === presIdLocal);
    assert(!found2, "listPresentations NÃO deveria conter o id_local após delete");

    console.log("✅ OK: TESTE store/get/list/delete de apresentação passou.");
  } finally {
    try { await verifier.walletClose(); } catch (_) {}
  }
})().catch((e) => {
  console.error("FALHA NO TESTE:", e?.message || e);
  console.error(e?.stack || "");
  process.exit(1);
});
