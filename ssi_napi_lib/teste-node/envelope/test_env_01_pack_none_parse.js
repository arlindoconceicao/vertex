// PARA RODAR USE:
// WALLET_PASS="minha_senha_teste" node teste-node/envelope/test_env_01_pack_none_parse.js

/* eslint-disable no-console */
const path = require("path");
const { IndyAgent } = require(path.join(__dirname, "..", "..", "index.node"));

(async () => {
  const agent = new IndyAgent();

  const meta = { tags: ["unit", "envelope"], note: "pack_none smoke" };
  const plaintext = JSON.stringify({ hello: "world", n: 1 });

  const envJson = agent.envelopePackNone(
    "test/plain",
    "th_test_01",
    plaintext,
    null,
    JSON.stringify(meta)
  );

  const envObj = JSON.parse(envJson);
  if (envObj.v !== 1) throw new Error("v != 1");
  if (envObj.crypto?.mode !== "none") throw new Error("mode != none");
  if (envObj.kind !== "test/plain") throw new Error("kind mismatch");
  if (envObj.thread_id !== "th_test_01") throw new Error("thread_id mismatch");
  if (envObj.payload?.ciphertext !== plaintext) throw new Error("payload mismatch");

  const summaryJson = agent.envelopeParse(envJson);
  const summary = JSON.parse(summaryJson);

  if (summary.kind !== "test/plain") throw new Error("parse.kind mismatch");
  if (summary.crypto.mode !== "none") throw new Error("parse.mode mismatch");
  if (summary.payload.ciphertext_len !== plaintext.length) throw new Error("ciphertext_len mismatch");

  console.log("✅ test_env_01_pack_none_parse OK");
})().catch((e) => {
  console.error("❌ test_env_01_pack_none_parse FAIL:", e?.message || e);
  process.exit(1);
});
