// teste-node/did/teste_did_03_export_import_batch.js
const { loadIndyAgent, resetWalletArtifacts, openOrCreateWallet, assert } = require("./_did_common");

async function main() {
  console.log("🚀 TESTE DID 03: export/import batch (A -> B)");

  const IndyAgent = loadIndyAgent();
  const agentA = new IndyAgent();
  const agentB = new IndyAgent();

  const dbA = "./wallet_did_03_A.db";
  const dbB = "./wallet_did_03_B.db";
  const passA = "pass_did_03_A";
  const passB = "pass_did_03_B";

  try {
    if (process.env.RESET_WALLET === "1") {
      console.log("🧹 RESET_WALLET=1: removendo wallet artifacts...");
      resetWalletArtifacts(dbA);
      resetWalletArtifacts(dbB);
    }

    console.log("\n1) Wallet A...");
    await openOrCreateWallet(agentA, dbA, passA);

    console.log("2) Criando 2 DIDs próprios (A)...");
    for (let i = 0; i < 2; i++) {
      const out = JSON.parse(await agentA.createDidV2(JSON.stringify({
        alias: `A Own ${i}`,
        public: false,
        role: "none",
        policy: { requireTrusteeForEndorser: true }
      })));
      assert(out.ok === true, "createDidV2 em A ok");
    }

    console.log("3) Criando 2 DIDs externos (A)...");
    await agentA.storeTheirDid("Th7MpTaRZVRYnPiabds81Y", "CnEDk9HrMnmiHXEV1WFgbVCRteYnPqsJwrTdcZaNhFVW", "A Ext 1");
    await agentA.storeTheirDid("EbP4aYNeTHL6q385GuVpRV", "9wBBr1J6vZsV3pNQyQ6YwG4cB9hVtYVwQeGg1g2h3i4j", "A Ext 2");

    console.log("\n4) Export batch dos externos (A)...");
    const batchStr = await agentA.exportDidsBatch(JSON.stringify({ type: "external", limit: 1000, offset: 0 }));
    const batch = JSON.parse(batchStr);

    assert(batch.type === "ssi-did-batch-v1", "batch.type deve ser ssi-did-batch-v1");
    assert(Array.isArray(batch.items), "batch.items deve ser array");
    assert(batch.items.length >= 2, "batch deve conter >=2 itens");
    assert(batch.items.every(x => x.did && x.verkey), "cada item deve ter did+verkey");
    assert(JSON.stringify(batch).includes("seed") === false, "batch nunca deve conter seed");

    console.log("\n5) Wallet B...");
    await openOrCreateWallet(agentB, dbB, passB);

    console.log("6) Import batch em B...");
    const impStr = await agentB.importDidsBatch(JSON.stringify(batch), "external");
    const imp = JSON.parse(impStr);

    assert(imp.ok === true, "import ok");
    assert(imp.imported >= 1, "imported >=1");
    assert(imp.mode === "external", "mode external");

    console.log("7) Verificando se B tem externos via searchDids...");
    const extB = JSON.parse(await agentB.searchDids(JSON.stringify({ type: "external", limit: 1000, offset: 0 })));
    assert(extB.length >= 2, "B deve ter >=2 externos após import");
    assert(extB.some(x => x.alias === "A Ext 1" || (x.alias || "").includes("Ext")), "B deve conter aliases importados");

    console.log("8) Reimport idempotente (deve pular)...");
    const imp2 = JSON.parse(await agentB.importDidsBatch(JSON.stringify(batch), "external"));
    assert(imp2.ok === true, "reimport ok");
    assert(imp2.imported === 0, "reimport deve imported=0 (idempotente)");
    assert(imp2.skipped >= 1, "reimport deve skipped>=1");

    console.log("✅ OK: TESTE DID 03 passou.");
  } catch (e) {
    console.error("❌ ERRO:", e);
    process.exitCode = 1;
  } finally {
    console.log("🔒 Fechando wallets...");
    try { await agentA.walletClose(); } catch (_) {}
    try { await agentB.walletClose(); } catch (_) {}
    console.log("👋 Fim.");
  }
}

main();
