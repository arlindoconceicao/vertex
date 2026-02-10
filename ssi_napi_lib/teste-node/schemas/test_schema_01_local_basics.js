/**
 * teste-node/schemas/test_schema_01_local_basics.js
 * (idempotente: walletCreate ignora WalletAlreadyExists)
 */

const fs = require("fs");
const path = require("path");

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assertion failed");
}

function parseJsonSafe(s, label = "json") {
  try {
    return JSON.parse(s);
  } catch (e) {
    throw new Error(
      `Falha ao parsear ${label}: ${e.message}\nConteúdo: ${String(s).slice(0, 500)}`
    );
  }
}

function rmIfExists(p) {
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch {}
}

function loadIndyAgent() {
  const envPath = process.env.SSI_NAPI_NODE;
  if (envPath && fs.existsSync(envPath)) {
    const mod = require(envPath);
    if (mod && mod.IndyAgent) return mod.IndyAgent;
    throw new Error(`Módulo em SSI_NAPI_NODE não exporta IndyAgent: ${envPath}`);
  }

  const cwdCandidate = path.join(process.cwd(), "index.node");
  if (fs.existsSync(cwdCandidate)) {
    const mod = require(cwdCandidate);
    if (mod && mod.IndyAgent) return mod.IndyAgent;
    throw new Error(`index.node em CWD não exporta IndyAgent: ${cwdCandidate}`);
  }

  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, "index.node");
    if (fs.existsSync(candidate)) {
      const mod = require(candidate);
      if (mod && mod.IndyAgent) return mod.IndyAgent;
      throw new Error(`index.node encontrado mas não exporta IndyAgent: ${candidate}`);
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  throw new Error(
    `Não encontrei index.node. Rode da raiz do projeto ou defina SSI_NAPI_NODE=/caminho/index.node`
  );
}

function extractIdLocalFromSaveReturn(saveRet) {
  if (typeof saveRet !== "string") {
    throw new Error(`schemaSaveLocal retorno inesperado (não-string): ${typeof saveRet}`);
  }
  if (saveRet.startsWith("local:")) return saveRet;

  const obj = parseJsonSafe(saveRet, "schemaSaveLocal() retorno");
  const id = obj.id_local || obj.idLocal;
  assert(typeof id === "string" && id.startsWith("local:"), "id_local inválido no retorno do schemaSaveLocal");
  return id;
}

// Detecta "WalletAlreadyExists" vindo como string JSON de erro
function isWalletAlreadyExists(err) {
  const msg = String(err && err.message ? err.message : err);
  if (msg.includes("WalletAlreadyExists")) return true;
  if (msg.includes("wallet já existe")) return true;

  // alguns erros vêm como JSON
  try {
    const obj = JSON.parse(msg);
    return obj && (obj.code === "WalletAlreadyExists" || String(obj.message || "").includes("wallet já existe"));
  } catch {
    return false;
  }
}

(async () => {
  const IndyAgent = loadIndyAgent();
  const agent = new IndyAgent();

  const WALLET_PASS = process.env.WALLET_PASS || "minha_senha_teste";
  const RESET_WALLET = process.env.RESET_WALLET === "1";

  const walletDir = path.join(__dirname, "..", "wallets");
  fs.mkdirSync(walletDir, { recursive: true });

  const walletPath =
    process.env.WALLET_PATH || path.join(walletDir, "test_wallet_schema_01.db");

  console.log("🚀 TESTE SCHEMA 01: local basics (idempotente)");
  console.log("Config:", { walletPath, RESET_WALLET, node: process.versions.node });

  if (RESET_WALLET) {
    console.log("🧹 RESET_WALLET=1: removendo wallet artifacts...");
    rmIfExists(walletPath);
    rmIfExists(walletPath + ".sidecar");
    rmIfExists(walletPath + ".kdf.json");
  }

  // Wallet create (idempotente)
  console.log("1) Criando wallet (se não existir)...");
  try {
    await agent.walletCreate(walletPath, WALLET_PASS);
    console.log("✅ Wallet criada.");
  } catch (e) {
    if (isWalletAlreadyExists(e)) {
      console.log("ℹ️ Wallet já existe. Seguindo para walletOpen...");
    } else {
      throw e;
    }
  }

  console.log("2) Abrindo wallet...");
  await agent.walletOpen(walletPath, WALLET_PASS);
  console.log("✅ Wallet aberta.");

  // preview
  const name = "schema_teste_local";
  const version = "1.0";
  const attrs = ["nome", "cpf", "idade"];
  const revocable = true;

  console.log("3) schemaBuildPreview...");
  const previewStr = agent.schemaBuildPreview(name, version, attrs, revocable);
  const preview = parseJsonSafe(previewStr, "schemaBuildPreview()");
  assert(preview.name === name, "preview.name diferente");
  assert(preview.version === version, "preview.version diferente");
  assert(Array.isArray(preview.finalAttrNames), "preview.finalAttrNames não é array");
  for (const a of attrs) assert(preview.finalAttrNames.includes(a), `finalAttrNames não contém '${a}'`);
  console.log("✅ Preview OK:", preview.finalAttrNames);

  // save local
  console.log("4) schemaSaveLocal...");
  const envLabel = "template";
  const saveRet = await agent.schemaSaveLocal(name, version, attrs, revocable, envLabel);
  const idLocal = extractIdLocalFromSaveReturn(saveRet);

  console.log("✅ Salvo local.");
  console.log("   retorno schemaSaveLocal:", saveRet);
  console.log("   idLocal extraído:", idLocal);

  // get local
  console.log("5) schemaGetLocal...");
  const getRes = await agent.schemaGetLocal(idLocal);
  assert(getRes && getRes.ok === true, "schemaGetLocal retornou ok=false");
  assert(typeof getRes.json === "string" && getRes.json.length > 10, "schemaGetLocal.json inválido");

  const rec = parseJsonSafe(getRes.json, "schemaGetLocal().json");
  assert(rec.id_local === idLocal, "rec.id_local diferente");
  assert(rec.on_ledger === false, "rec.on_ledger deveria ser false (local)");
  assert(rec.env === envLabel, "rec.env diferente");
  assert(rec.name === name, "rec.name diferente");
  assert(rec.version === version, "rec.version diferente");
  assert(rec.revocable === revocable, "rec.revocable diferente");
  assert(Array.isArray(rec.final_attr_names), "rec.final_attr_names não é array");
  console.log("✅ Get local OK");

  // list local
  console.log("6) schemaListLocal...");
  const listed = await agent.schemaListLocal(false, envLabel, name);
  assert(Array.isArray(listed), "schemaListLocal não retornou array");
  assert(listed.length >= 1, "schemaListLocal retornou vazio");

  const parsed = listed.map((s) => parseJsonSafe(s, "schemaListLocal item"));
  const found = parsed.find((x) => x.id_local === idLocal);
  assert(found, "Schema salvo não apareceu no list");
  console.log("✅ List OK (itens:", listed.length, ")");

  // default issuer did
  console.log("7) set/get default_schema_issuer_did...");
  const didFake = "did:indy:local:TESTE_DEFAULT_DID";
  const setOk = await agent.setDefaultSchemaIssuerDid(didFake);
  assert(setOk === true, "setDefaultSchemaIssuerDid não retornou true");

  const got = await agent.getDefaultSchemaIssuerDid();
  assert(got === didFake, "getDefaultSchemaIssuerDid retornou valor diferente");
  console.log("✅ Default DID OK");

  // delete
  console.log("8) schemaDeleteLocal...");
  const delRes = await agent.schemaDeleteLocal(idLocal);
  assert(delRes && delRes.ok === true, "schemaDeleteLocal retornou ok=false");
  console.log("✅ Delete OK");

  // confirm not in list
  console.log("9) schemaListLocal (pós-delete)...");
  const listed2 = await agent.schemaListLocal(false, envLabel, name);
  const parsed2 = listed2.map((s) => parseJsonSafe(s, "schemaListLocal item pós-delete"));
  const found2 = parsed2.find((x) => x.id_local === idLocal);
  assert(!found2, "Schema ainda aparece no list após delete");
  console.log("✅ Pós-delete OK");

  console.log("10) Fechando wallet...");
  await agent.walletClose();
  console.log("✅ OK: TESTE SCHEMA 01 passou.");
})().catch((e) => {
  console.error("❌ FALHA TESTE SCHEMA 01:", e && e.stack ? e.stack : e);
  process.exit(1);
});
