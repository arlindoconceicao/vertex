const fs = require("fs");
const path = require("path");

let IndyAgent;
try {
  IndyAgent = require(path.join(process.cwd(), "index.js")).IndyAgent;
} catch {
  IndyAgent = require(path.join(process.cwd(), "index.node")).IndyAgent;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assertion failed");
}

function parseJsonSafe(s, label = "json") {
  try { return JSON.parse(s); } catch (e) {
    throw new Error(`Falha ao parsear ${label}: ${e.message}`);
  }
}

function extractIdLocalFromSaveReturn(saveRet) {
  if (typeof saveRet !== "string") throw new Error("schemaSaveLocal retorno não-string");
  if (saveRet.startsWith("local:")) return saveRet;
  const obj = parseJsonSafe(saveRet, "schemaSaveLocal retorno");
  const id = obj.id_local || obj.idLocal;
  assert(typeof id === "string" && id.startsWith("local:"), "id_local inválido no retorno");
  return id;
}

(async () => {
  const agent = new IndyAgent();

  const dbPath = process.env.WALLET_PATH || path.join(__dirname, "..", "wallets", "test_wallet_schema_01.db");
  const pass = process.env.WALLET_PASS || "minha_senha_teste";

  console.log("🚀 TESTE SCHEMA 04: local filters (env/name/on_ledger)");
  console.log("Config:", { dbPath });

  await agent.walletOpen(dbPath, pass);

  const s1 = extractIdLocalFromSaveReturn(await agent.schemaSaveLocal("SchemaA", "1.0", ["a"], true, "env1"));
  const s2 = extractIdLocalFromSaveReturn(await agent.schemaSaveLocal("SchemaA", "1.1", ["a","b"], false, "env1"));
  const s3 = extractIdLocalFromSaveReturn(await agent.schemaSaveLocal("SchemaB", "1.0", ["x"], true, "env2"));

  // 1) list por env1 + name SchemaA
  const list1 = await agent.schemaListLocal(false, "env1", "SchemaA");
  assert(Array.isArray(list1) && list1.length >= 2, "Esperado >=2 schemas em env1/SchemaA");
  const p1 = list1.map((s) => parseJsonSafe(s, "list1 item"));
  assert(p1.some((x) => x.id_local === s1), "s1 não apareceu");
  assert(p1.some((x) => x.id_local === s2), "s2 não apareceu");

  // 2) list por env2 + name SchemaB
  const list2 = await agent.schemaListLocal(false, "env2", "SchemaB");
  assert(Array.isArray(list2) && list2.length >= 1, "Esperado >=1 schema em env2/SchemaB");
  const p2 = list2.map((s) => parseJsonSafe(s, "list2 item"));
  assert(p2.some((x) => x.id_local === s3), "s3 não apareceu");

  // cleanup
  await agent.schemaDeleteLocal(s1);
  await agent.schemaDeleteLocal(s2);
  await agent.schemaDeleteLocal(s3);

  await agent.walletClose();
  console.log("✅ OK: TESTE SCHEMA 04 passou.");
})().catch((e) => {
  console.error("❌ FALHA TESTE SCHEMA 04:", e && e.stack ? e.stack : e);
  process.exit(1);
});
