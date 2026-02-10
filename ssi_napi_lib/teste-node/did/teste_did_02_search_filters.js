// teste-node/did/teste_did_02_search_filters.js
const { loadIndyAgent, resetWalletArtifacts, openOrCreateWallet, assert } = require("./_did_common");

async function main() {
  console.log("🚀 TESTE DID 02: searchDids filtros (own/external/query/paginação)");

  const IndyAgent = loadIndyAgent();
  const agent = new IndyAgent();

  const dbPath = "./wallet_did_02.db";
  const pass = "pass_did_02";

  try {
    if (process.env.RESET_WALLET === "1") {
      console.log("🧹 RESET_WALLET=1: removendo wallet artifacts...");
      resetWalletArtifacts(dbPath);
    }

    await openOrCreateWallet(agent, dbPath, pass);

    console.log("1) Criando 3 DIDs próprios (v2 local)...");
    const created = [];
    for (let i = 0; i < 3; i++) {
      const out = JSON.parse(await agent.createDidV2(JSON.stringify({
        alias: `Own ${i}`,
        public: false,
        role: "none",
        policy: { requireTrusteeForEndorser: true }
      })));
      created.push(out);
    }

    console.log("2) Inserindo 2 DIDs externos (storeTheirDid legado, mas tag type=external)...");
    // DIDs externos fake (apenas formato) — verkey fake ok pra storage
    await agent.storeTheirDid("WgWxqztrNooG92RXvxSTWv", "8wZcEriaNLNKtteJvx7f8iRZsK2vJ7uUVDnqgPjV7y5o", "Ext A");
    await agent.storeTheirDid("L5bKcZr1JYcQ1y7mPp5r7Q", "9L8y2f6m3cWbqQmG4KXyZx3v2z1Vn1Bq9aQxWm7n8pQ", "Ext B");

    console.log("3) searchDids type=own...");
    const ownArr = JSON.parse(await agent.searchDids(JSON.stringify({ type: "own", limit: 100, offset: 0 })));
    assert(Array.isArray(ownArr), "searchDids deve retornar array");
    assert(ownArr.length >= 3, "searchDids own deve retornar >=3");
    assert(ownArr.every(x => x.type === "own"), "todos os itens own devem ter type=own");

    console.log("4) searchDids type=external...");
    const extArr = JSON.parse(await agent.searchDids(JSON.stringify({ type: "external", limit: 100, offset: 0 })));
    assert(extArr.length >= 2, "searchDids external deve retornar >=2");
    assert(extArr.every(x => x.type === "external"), "todos os itens external devem ter type=external");

    console.log("5) searchDids type=all...");
    const allArr = JSON.parse(await agent.searchDids(JSON.stringify({ type: "all", limit: 100, offset: 0 })));
    assert(allArr.length >= ownArr.length + extArr.length, "all deve conter own+external (>=)");

    console.log("6) searchDids query por alias 'Ext A'...");
    const qArr = JSON.parse(await agent.searchDids(JSON.stringify({ type: "all", query: "Ext A", limit: 50, offset: 0 })));
    assert(qArr.length >= 1, "query deve retornar pelo menos 1");
    assert(qArr.some(x => (x.alias || "").includes("Ext A")), "resultado deve conter alias Ext A");

    console.log("7) Paginação limit/offset...");
    const page1 = JSON.parse(await agent.searchDids(JSON.stringify({ type: "own", limit: 2, offset: 0 })));
    const page2 = JSON.parse(await agent.searchDids(JSON.stringify({ type: "own", limit: 2, offset: 2 })));
    assert(page1.length <= 2 && page2.length <= 2, "paginação deve limitar resultados");
    // Não força diferenças (ordenação pode variar por createdAt), mas valida que é array
    assert(Array.isArray(page1) && Array.isArray(page2), "páginas devem ser arrays");

    console.log("✅ OK: TESTE DID 02 passou.");
  } catch (e) {
    console.error("❌ ERRO:", e);
    process.exitCode = 1;
  } finally {
    console.log("🔒 Fechando wallet...");
    try { await agent.walletClose(); } catch (_) {}
    console.log("👋 Fim.");
  }
}

main();
