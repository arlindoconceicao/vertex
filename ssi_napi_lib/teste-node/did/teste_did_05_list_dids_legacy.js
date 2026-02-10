// teste-node/did/teste_did_05_list_dids_legacy.js
const path = require("path");
const {
  loadIndyAgent,
  resetWalletArtifacts,
  openOrCreateWallet,
  assert,
} = require("./_did_common");

const IndyAgent = loadIndyAgent();

function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch (e) {
    throw new Error("JSON inválido retornado pela lib: " + String(e));
  }
}

function assertNoSecrets(obj, ctx) {
  const dump = JSON.stringify(obj);
  assert(!dump.includes('"seed"'), `${ctx}: vazou campo seed`);
  assert(!dump.includes("seedHex"), `${ctx}: vazou seedHex`);
  assert(!dump.includes("seedB64"), `${ctx}: vazou seedB64`);
  assert(!dump.includes("privateKey"), `${ctx}: vazou privateKey`);
  assert(!dump.includes("secret"), `${ctx}: vazou secret`);
}

function assertDidRecordShape(r, expectedType, ctx) {
  assert(r && typeof r === "object", `${ctx}: record não é objeto`);
  assert(typeof r.did === "string" && r.did.length > 5, `${ctx}: did inválido`);
  assert(typeof r.verkey === "string" && r.verkey.length > 10, `${ctx}: verkey inválida`);

  // PR-01 defaults
  assert(typeof r.method === "string", `${ctx}: method ausente`);
  assert(r.method === "sov", `${ctx}: method != sov (veio ${r.method})`);

  assert(typeof r.type === "string", `${ctx}: type ausente`);
  assert(r.type === expectedType, `${ctx}: type esperado ${expectedType}, veio ${r.type}`);

  // campos adicionais (podem existir em registros antigos, mas após PR-01 devem aparecer)
  assert("createdAt" in r, `${ctx}: createdAt ausente`);
  assert(typeof r.createdAt === "number", `${ctx}: createdAt não é number`);

  assert("isPublic" in r, `${ctx}: isPublic ausente`);
  assert(typeof r.isPublic === "boolean", `${ctx}: isPublic não é boolean`);

  assert("origin" in r, `${ctx}: origin ausente`);
  assert(typeof r.origin === "string", `${ctx}: origin não é string`);

  assert("role" in r, `${ctx}: role ausente`);
  // role pode ser null ou string
  assert(r.role === null || typeof r.role === "string", `${ctx}: role inválido`);

  assertNoSecrets(r, ctx);
}

async function main() {
  console.log("🚀 TESTE DID 05: listDids legado (normalização PR-01)");

  const dbPath = "./wallet_did_05.db";
  const pass = "pass_did_05";
  const agent = new IndyAgent();

  try {
    // Reset opcional via env
    if (process.env.RESET_WALLET === "1") {
      console.log("🧹 RESET_WALLET=1: removendo wallet artifacts...");
      resetWalletArtifacts(dbPath);
    }

    await openOrCreateWallet(agent, dbPath, pass);

    console.log("1) Criando 2 DIDs próprios via createDidV2 (local)...");
    const d1 = safeJsonParse(await agent.createDidV2(JSON.stringify({ alias: "Own 1", public: false })));
    const d2 = safeJsonParse(await agent.createDidV2(JSON.stringify({ alias: "Own 2", public: false })));
    assert(d1.ok === true && d2.ok === true, "createDidV2 não retornou ok=true");

    console.log("2) Inserindo 2 DIDs externos via storeTheirDid (legado)...");
    // IDs “fake” mas com formato plausível (o storeTheirDid não valida ledger aqui)
    const extDidA = "ExtDidA1111111111";
    const extVkA = "ExtVerkeyA111111111111111111111111111111111111111111";
    const extDidB = "ExtDidB2222222222";
    const extVkB = "ExtVerkeyB222222222222222222222222222222222222222222";

    await agent.storeTheirDid(extDidA, extVkA, "Ext A");
    await agent.storeTheirDid(extDidB, extVkB, "Ext B");

    console.log("3) listDids('own')...");
    const ownStr = await agent.listDids("own");
    const ownArr = safeJsonParse(ownStr);
    assert(Array.isArray(ownArr), "listDids('own') não retornou array");
    assert(ownArr.length >= 2, `esperado >=2 próprios, veio ${ownArr.length}`);

    // valida ao menos 1 item
    assertDidRecordShape(ownArr[0], "own", "own[0]");

    console.log("4) listDids('external')...");
    const extStr = await agent.listDids("external");
    const extArr = safeJsonParse(extStr);
    assert(Array.isArray(extArr), "listDids('external') não retornou array");
    assert(extArr.length >= 2, `esperado >=2 externos, veio ${extArr.length}`);

    // deve conter os dois externos criados
    const extDids = new Set(extArr.map(x => x.did));
    assert(extDids.has(extDidA), "external: não encontrou ExtDidA");
    assert(extDids.has(extDidB), "external: não encontrou ExtDidB");

    // valida shape (pega um dos externos inseridos)
    const extA = extArr.find(x => x.did === extDidA);
    assertDidRecordShape(extA, "external", "external[ExtDidA]");

    console.log("5) listDids('invalid') deve falhar...");
    let failed = false;
    try {
      await agent.listDids("all"); // inválido no legado ajustado
    } catch (e) {
      failed = true;
      const msg = (e && e.message) ? String(e.message) : String(e);
      console.log("   ✅ Falhou como esperado:", msg);
    }
    assert(failed, "listDids('all') deveria falhar e não falhou");

    console.log("✅ OK: TESTE DID 05 passou.");
  } catch (e) {
    console.error("❌ ERRO:", e);
  } finally {
    console.log("🔒 Fechando wallet...");
    try { await agent.walletClose(); } catch (_) {}
    console.log("👋 Fim.");
  }
}

main();
