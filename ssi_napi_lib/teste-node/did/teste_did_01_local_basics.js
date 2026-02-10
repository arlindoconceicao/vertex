// teste-node/did/teste_did_01_local_basics.js
const { loadIndyAgent, resetWalletArtifacts, openOrCreateWallet, assert } = require("./_did_common");
const fs = require("fs");

async function main() {
  console.log("🚀 TESTE DID 01: local basics (createDidV2 + getDid + getDidByVerkey)");

  const IndyAgent = loadIndyAgent();
  const agent = new IndyAgent();

  const dbPath = "./wallet_did_01.db";
  const pass = "pass_did_01";

  try {
    if (process.env.RESET_WALLET === "1") {
      console.log("🧹 RESET_WALLET=1: removendo wallet artifacts...");
      resetWalletArtifacts(dbPath);
    }

    await openOrCreateWallet(agent, dbPath, pass);

    console.log("1) Criando DID v2 (local)...");
    const opts = {
      alias: "Meu DID V2 Local",
      public: false,
      role: "none",
      policy: { requireTrusteeForEndorser: true },
    };

    const outStr = await agent.createDidV2(JSON.stringify(opts));
    const out = JSON.parse(outStr);

    assert(out.ok === true, "createDidV2 deve retornar ok:true");
    assert(typeof out.did === "string" && out.did.length > 0, "createDidV2 deve retornar did");
    assert(typeof out.verkey === "string" && out.verkey.length > 0, "createDidV2 deve retornar verkey");
    assert(out.isPublic === false, "createDidV2 local deve ser isPublic:false");
    assert(typeof out.createdAt === "number" && out.createdAt > 0, "createDidV2 deve retornar createdAt>0");

    const did = out.did;
    const verkey = out.verkey;

    console.log("2) getDid...");
    const didJsonStr = await agent.getDid(did);
    const didJson = JSON.parse(didJsonStr);

    assert(didJson.did === did, "getDid deve retornar o mesmo did");
    assert(didJson.verkey === verkey, "getDid deve retornar a verkey correta");
    assert(didJson.seed === undefined, "getDid nunca deve incluir seed");
    assert(didJson.privateKey === undefined, "getDid nunca deve incluir privateKey");
    assert(didJson.secret === undefined, "getDid nunca deve incluir secret");

    console.log("3) getDidByVerkey...");
    const byVkStr = await agent.getDidByVerkey(verkey);
    const byVk = JSON.parse(byVkStr);

    assert(byVk.verkey === verkey, "getDidByVerkey deve retornar a verkey correta");
    assert(byVk.seed === undefined, "getDidByVerkey nunca deve incluir seed");

    console.log("✅ OK: TESTE DID 01 passou.");
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
