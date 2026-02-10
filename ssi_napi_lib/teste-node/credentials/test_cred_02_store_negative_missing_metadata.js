const path = require("path");
const fs = require("fs");
const {
  NETWORK_CONFIG,
  assert,
  downloadGenesisHttp,
  loadIndyAgent,
  fn,
  walletCreateOpenIdempotent,
} = require("./_helpers");

function isMissingMetadataErr(e) {
  const msg = String(e && e.message ? e.message : e);
  if (msg.includes("Request Metadata não encontrado")) return true;
  try {
    const obj = JSON.parse(msg);
    return obj && String(obj.message || "").includes("Request Metadata não encontrado");
  } catch {
    return false;
  }
}

(async () => {
  const IndyAgent = loadIndyAgent();

  const pass = process.env.WALLET_PASS || "minha_senha_teste";

  const walletDir = path.join(__dirname, "..", "wallets");
  fs.mkdirSync(walletDir, { recursive: true });

  const holderDb = process.env.WALLET_HOLDER || path.join(walletDir, "test_wallet_cred_holder.db");
  const genesisAbs = path.join(process.cwd(), NETWORK_CONFIG.genesisFile);

  console.log("🚀 TESTE CRED 02: negativo (store_credential sem request_metadata)");
  console.log("Config:", { holderDb, genesisAbs });

  await downloadGenesisHttp(NETWORK_CONFIG.genesisUrl, genesisAbs);

  const holder = new IndyAgent();
  await walletCreateOpenIdempotent(holder, holderDb, pass);

  try {
    await holder.connectNetwork(genesisAbs);

    const storeCredential = fn(holder, "storeCredential", "store_credential");

    // Dados fake só para chegar no ponto do erro de metadata:
    const fakeCredJson = JSON.stringify({ foo: "bar" });
    const fakeCredDefJson = JSON.stringify({ foo: "bar" });

    try {
      await storeCredential("cred-neg", fakeCredJson, "metadata_inexistente", fakeCredDefJson, null);
      throw new Error("Esperava falha, mas store_credential retornou sucesso.");
    } catch (e) {
      if (!isMissingMetadataErr(e)) throw e;
      console.log("✅ OK: erro esperado capturado:", String(e.message || e));
    }

    console.log("✅ OK: TESTE CRED 02 passou.");
  } finally {
    try { await holder.walletClose(); } catch {}
  }
})().catch((e) => {
  console.error("❌ FALHA TESTE CRED 02:", e && e.stack ? e.stack : e);
  process.exit(1);
});
