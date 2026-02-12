// PARA RODAR USE:
// WALLET_PASS="minha_senha_teste" node teste-node/envelope/test_env_02_unpack_auto_none.js


/* eslint-disable no-console */
const path = require("path");
const { IndyAgent } = require(path.join(__dirname, "..", "..", "index.node"));

(async () => {
  const agent = new IndyAgent();
  const plaintext = JSON.stringify({ ok: true, t: Date.now() });

  const envJson = agent.envelopePackNone("test/none", null, plaintext, null, null);
  const out = await agent.envelopeUnpackAuto("DUMMY_DID_NOT_USED_IN_NONE", envJson);

  if (out !== plaintext) throw new Error("unpack_auto(mode=none) não retornou plaintext");

  console.log("✅ test_env_02_unpack_auto_none OK");
})().catch((e) => {
  console.error("❌ test_env_02_unpack_auto_none FAIL:", e?.message || e);
  process.exit(1);
});
