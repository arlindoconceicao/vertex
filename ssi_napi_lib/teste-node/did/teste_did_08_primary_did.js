// RESET_WALLET=1 node ./teste-node/did/teste_did_08_primary_did.js
// teste-node/did/teste_did_08_primary_did.js
const {
  loadIndyAgent,
  resetWalletArtifacts,
  openOrCreateWallet,
  assert,
} = require("./_did_common");

const IndyAgent = loadIndyAgent();

function safeJsonParse(s, label = "json") {
  try { return JSON.parse(s); }
  catch (e) {
    throw new Error(`${label}: JSON inválido: ${String(e)} | raw=${String(s).slice(0, 300)}`);
  }
}

async function main() {
  console.log("🚀 TESTE DID 08: primary DID (setPrimaryDid/getPrimaryDid)");

  const dbPath = "./wallet_did_08.db";
  const pass = "pass_did_08";
  const agent = new IndyAgent();

  try {
    if (process.env.RESET_WALLET === "1") {
      console.log("🧹 RESET_WALLET=1: removendo wallet artifacts...");
      resetWalletArtifacts(dbPath);
    }

    await openOrCreateWallet(agent, dbPath, pass);

    // 1) getPrimaryDid antes de set -> deve falhar
    console.log("1) getPrimaryDid antes de set (deve falhar)...");
    let failed = false;
    try {
      await agent.getPrimaryDid();
    } catch (e) {
      failed = true;
      console.log("   ✅ Falhou como esperado:", String(e.message || e));
    }
    assert(failed === true, "getPrimaryDid deveria falhar quando não definido");

    // 2) Criar dois DIDs próprios
    console.log("2) Criando 2 DIDs próprios (createDidV2 local)...");
    const a = safeJsonParse(await agent.createDidV2(JSON.stringify({
      alias: "Primary A",
      public: false,
      role: "none",
    })), "createDidV2(A)");
    const b = safeJsonParse(await agent.createDidV2(JSON.stringify({
      alias: "Primary B",
      public: false,
      role: "none",
    })), "createDidV2(B)");

    assert(a.ok === true && typeof a.did === "string", "createDidV2(A) inválido");
    assert(b.ok === true && typeof b.did === "string", "createDidV2(B) inválido");

    // 3) Set primary = A
    console.log("3) setPrimaryDid(A)...");
    const setA = safeJsonParse(await agent.setPrimaryDid(a.did), "setPrimaryDid(A)");
    assert(setA.ok === true, "setPrimaryDid(A): ok !== true");
    assert(setA.did === a.did, "setPrimaryDid(A): did não bate");
    assert(typeof setA.setAt === "number", "setPrimaryDid(A): setAt inválido");

    // 4) getPrimary => A
    console.log("4) getPrimaryDid (deve ser A)...");
    const getA = safeJsonParse(await agent.getPrimaryDid(), "getPrimaryDid");
    assert(getA.ok === true, "getPrimaryDid: ok !== true");
    assert(getA.did === a.did, "getPrimaryDid: deveria retornar A");
    assert(typeof getA.setAt === "number", "getPrimaryDid: setAt inválido");

    // 5) Set primary = B (overwrite)
    console.log("5) setPrimaryDid(B) overwrite...");
    const setB = safeJsonParse(await agent.setPrimaryDid(b.did), "setPrimaryDid(B)");
    assert(setB.ok === true, "setPrimaryDid(B): ok !== true");
    assert(setB.did === b.did, "setPrimaryDid(B): did não bate");

    // 6) getPrimary => B
    console.log("6) getPrimaryDid (deve ser B)...");
    const getB = safeJsonParse(await agent.getPrimaryDid(), "getPrimaryDid(B)");
    assert(getB.did === b.did, "getPrimaryDid: deveria retornar B");

    // 7) setPrimaryDid com DID inexistente -> deve falhar
    console.log("7) setPrimaryDid com DID inexistente (deve falhar)...");
    failed = false;
    try {
      await agent.setPrimaryDid("NaoExisteDid123");
    } catch (e) {
      failed = true;
      console.log("   ✅ Falhou como esperado:", String(e.message || e));
    }
    assert(failed === true, "setPrimaryDid deveria falhar para DID inexistente");

    console.log("✅ OK: TESTE DID 08 passou.");
  } catch (e) {
    console.error("❌ ERRO:", e);
  } finally {
    console.log("🔒 Fechando wallet...");
    try { await agent.walletClose(); } catch (_) {}
    console.log("👋 Fim.");
  }
}

main();
