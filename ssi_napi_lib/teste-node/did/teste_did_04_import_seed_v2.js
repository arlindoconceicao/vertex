// teste-node/did/teste_did_04_import_seed_v2.js
const { loadIndyAgent, resetWalletArtifacts, openOrCreateWallet, assert } = require("./_did_common");

function hexToBase64(hex) {
  const buf = Buffer.from(hex, "hex");
  return buf.toString("base64");
}

async function main() {
  console.log("🚀 TESTE DID 04: importDidFromSeedV2 (hex/base64 + determinismo)");

  const IndyAgent = loadIndyAgent();
  const agent = new IndyAgent();

  const dbPath = "./wallet_did_04.db";
  const pass = "pass_did_04";

  // 32 bytes => 64 hex chars
  const SEED_HEX = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
  const SEED_B64 = hexToBase64(SEED_HEX);

  try {
    if (process.env.RESET_WALLET === "1") {
      console.log("🧹 RESET_WALLET=1: removendo wallet artifacts...");
      resetWalletArtifacts(dbPath);
    }

    await openOrCreateWallet(agent, dbPath, pass);

    console.log("1) Import via HEX...");
    const a = JSON.parse(await agent.importDidFromSeedV2(SEED_HEX, "Seed DID HEX"));
    assert(a.ok === true, "import hex ok");
    assert(typeof a.did === "string" && a.did.length > 0, "did ok");
    assert(typeof a.verkey === "string" && a.verkey.length > 0, "verkey ok");
    assert(a.origin === "imported_seed", "origin deve ser imported_seed");

    console.log("2) Import via Base64 (mesma seed, deve gerar mesmo DID/verkey)...");
    const b = JSON.parse(await agent.importDidFromSeedV2(SEED_B64, "Seed DID B64"));
    assert(b.ok === true, "import base64 ok");
    assert(b.did === a.did, "did deve ser igual (determinístico)");
    assert(b.verkey === a.verkey, "verkey deve ser igual (determinístico)");

    console.log("3) getDid (não deve vazar seed)...");
    const got = JSON.parse(await agent.getDid(a.did));
    assert(got.seed === undefined, "seed não pode aparecer em getDid");
    assert(got.privateKey === undefined, "privateKey não pode aparecer");

    console.log("✅ OK: TESTE DID 04 passou.");
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
