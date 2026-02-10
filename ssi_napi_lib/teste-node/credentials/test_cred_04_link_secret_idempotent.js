const path = require("path");
const fs = require("fs");
const {
  assert,
  loadIndyAgent,
  fn,
  walletCreateOpenIdempotent,
} = require("./_helpers");

(async () => {
  const IndyAgent = loadIndyAgent();
  const pass = process.env.WALLET_PASS || "minha_senha_teste";

  const walletDir = path.join(__dirname, "..", "wallets");
  fs.mkdirSync(walletDir, { recursive: true });

  const holderDb =
    process.env.WALLET_HOLDER ||
    path.join(walletDir, "test_wallet_cred_holder.db");

  console.log("🚀 TESTE CRED 04: idempotência Link Secret (default)");
  console.log("Config:", { holderDb });

  const holder = new IndyAgent();
  await walletCreateOpenIdempotent(holder, holderDb, pass);

  try {
    const createLinkSecret = fn(holder, "createLinkSecret", "create_link_secret");

    console.log('1) createLinkSecret("default") #1 ...');
    const id1 = await createLinkSecret("default");
    assert(id1 === "default", `retorno inesperado: ${id1}`);

    console.log('2) createLinkSecret("default") #2 ...');
    const id2 = await createLinkSecret("default");
    assert(id2 === "default", `retorno inesperado: ${id2}`);

    console.log("✅ OK: idempotência em mesma sessão confirmada.");

  } finally {
    try { await holder.walletClose(); } catch {}
  }

  // --- cold start (cache vazio) ---
  const holder2 = new IndyAgent();
  await walletCreateOpenIdempotent(holder2, holderDb, pass);

  try {
    const createLinkSecret2 = fn(holder2, "createLinkSecret", "create_link_secret");

    console.log('3) createLinkSecret("default") após reabrir wallet (cache vazio) ...');
    const id3 = await createLinkSecret2("default");
    assert(id3 === "default", `retorno inesperado: ${id3}`);

    console.log("✅ OK: idempotência em cold start confirmada.");
    console.log("✅ OK: TESTE CRED 04 passou.");
  } finally {
    try { await holder2.walletClose(); } catch {}
  }
})().catch((e) => {
  console.error("❌ FALHA TESTE CRED 04:", e && e.stack ? e.stack : e);
  process.exit(1);
});
