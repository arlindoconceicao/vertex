/**
 * teste-node/schemas/test_schema_02_ledger_smoke.js
 * Baseado no teste funcional teste_von_schema.js
 *
 * Execução:
 *   node teste-node/schemas/test_schema_02_ledger_smoke.js
 *
 * Opcional:
 *   RESET_WALLET=1 WALLET_PASS=indicio_key_secure node teste-node/schemas/test_schema_02_ledger_smoke.js
 */

const fs = require("fs");
const path = require("path");
const http = require("http");

// =============================================================================
// CONFIGURAÇÃO: VON-NETWORK (LOCAL)
// =============================================================================
const NETWORK_CONFIG = {
  name: "Von-Network Local",
  genesisUrl: "http://localhost:9000/genesis",
  genesisFile: "./von_genesis.txn",
  trusteeSeed: "000000000000000000000000Trustee1",
  trusteeDid: "V4SGRU86Z58d6TV7PBUe6f",
};

// =============================================================================
// LOAD BINDING (igual ao teste que funciona)
// =============================================================================
let IndyAgent;
try {
  const binding = require(path.join(process.cwd(), "index.js"));
  IndyAgent = binding.IndyAgent;
} catch (e) {
  try {
    const binding = require(path.join(process.cwd(), "index.node"));
    IndyAgent = binding.IndyAgent;
  } catch (e2) {
    console.error("❌ Não foi possível carregar a biblioteca nativa (index.js ou index.node na raiz).");
    process.exit(1);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assertion failed");
}

// =============================================================================
// UTILITÁRIOS
// =============================================================================
function downloadGenesisHttp(url, destAbs) {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(destAbs)) {
      console.log("📂 Genesis já existe, pulando download.");
      return resolve(true);
    }

    fs.mkdirSync(path.dirname(destAbs), { recursive: true });

    const file = fs.createWriteStream(destAbs);
    console.log(`⏳ Baixando Genesis de: ${url}...`);

    http
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`Erro HTTP: ${res.statusCode}`));
          return;
        }
        res.pipe(file);
        file.on("finish", () => {
          file.close(() => {
            console.log("✅ Genesis baixado.");
            resolve(true);
          });
        });
      })
      .on("error", (err) => {
        try { fs.unlinkSync(destAbs); } catch { }
        reject(err);
      });
  });
}

function rmIfExists(p) {
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch { }
}

// =============================================================================
// FLUXO PRINCIPAL
// =============================================================================
async function main() {
  console.log("🚀 TESTE SCHEMA 02: ledger smoke (baseado no teste_von_schema.js)");

  const WALLET_PASS = process.env.WALLET_PASS || "indicio_key_secure";
  const RESET_WALLET = process.env.RESET_WALLET === "1";

  // Wallet isolada para suite schema
  const walletDir = path.join(__dirname, "..", "wallets");
  fs.mkdirSync(walletDir, { recursive: true });

  const dbPath = process.env.WALLET_PATH || path.join(walletDir, "test_wallet_schema_02.db");

  // genesis na raiz do projeto (mesmo padrão do seu teste)
  const genesisAbs = path.join(process.cwd(), NETWORK_CONFIG.genesisFile);

  console.log("Config:", {
    dbPath,
    WALLET_PASS: "***",
    RESET_WALLET,
    genesisAbs,
    genesisUrl: NETWORK_CONFIG.genesisUrl,
  });

  const agent = new IndyAgent();

  try {
    // 1) Baixar genesis
    await downloadGenesisHttp(NETWORK_CONFIG.genesisUrl, genesisAbs);

    // 2) Wallet idempotente
    if (RESET_WALLET) {
      console.log("🧹 RESET_WALLET=1: removendo wallet artifacts...");
      rmIfExists(dbPath);
      rmIfExists(dbPath + ".sidecar"); // ajuste se o seu sidecar tiver outro nome
      rmIfExists(dbPath + ".kdf.json");
    }

    if (fs.existsSync(dbPath)) {
      console.log("1️⃣  Carteira encontrada. Abrindo...");
    } else {
      console.log("1️⃣  Carteira não encontrada. Criando nova...");
      await agent.walletCreate(dbPath, WALLET_PASS);
    }
    await agent.walletOpen(dbPath, WALLET_PASS);
    console.log("✅ Wallet aberta.");

    // 3) Conectar na rede
    console.log("2️⃣  Conectando ao Pool...");
    await agent.connectNetwork(genesisAbs);
    console.log("✅ Pool conectado.");

    // 4) Trustee (igual ao teste que funciona)
    console.log("3️⃣  Importando DID Trustee via seed...");
    const [myDid, myVerkey] = await agent.importDidFromSeed(NETWORK_CONFIG.trusteeSeed);

    console.log("    Issuer DID:", myDid);
    console.log("    Issuer Verkey:", myVerkey);

    assert(
      myDid === NETWORK_CONFIG.trusteeDid,
      `DID incorreto! Esperado: ${NETWORK_CONFIG.trusteeDid}, Obtido: ${myDid}`
    );

    // 5) Registrar Schema
    const name = "SchemaLedgerSmoke";
    const version = `1.${Math.floor(Date.now() / 1000)}`; // único
    const attrs = ["nome", "cpf", "idade"];

    console.log(`\n4️⃣  Registrando Schema: ${name} v${version}...`);
    console.log(`    Atributos: [${attrs.join(", ")}]`);

    // Nota: dependendo do seu binding, createAndRegisterSchema pode:
    // - retornar string schemaId (como no seu teste_von_schema.js)
    // - ou retornar objeto { ok, schemaId, ... } (como em versões anteriores)
    const regRet = await agent.createAndRegisterSchema(genesisAbs, myDid, name, version, attrs);

    let schemaId;
    if (typeof regRet === "string") {
      schemaId = regRet;
    } else if (regRet && typeof regRet === "object" && regRet.ok === true && regRet.schemaId) {
      schemaId = regRet.schemaId;
    } else {
      throw new Error(`Retorno inesperado de createAndRegisterSchema: ${JSON.stringify(regRet)}`);
    }

    console.log("\n✅ SUCESSO! Schema Registrado.");
    console.log("🆔 Schema ID:", schemaId);

    // 6) Fetch do schema (validação extra)
    if (typeof agent.fetchSchemaFromLedger === "function") {
      console.log("\n5️⃣  Fetch schema do ledger...");

      function normalizeFetchPayload(fetched) {
        if (typeof fetched === "string") return JSON.parse(fetched);
        if (fetched && typeof fetched === "object") {
          if (fetched.ok === true && typeof fetched.json === "string") return JSON.parse(fetched.json);
          return fetched; // caso raro
        }
        throw new Error("fetchSchemaFromLedger retorno inesperado");
      }

      function pickAttrNames(schemaData) {
        // compat com diferentes formatos
        return (
          schemaData.attrNames ||
          schemaData.attr_names ||
          schemaData.data?.attr_names ||
          schemaData.data?.attrNames ||
          null
        );
      }

      console.log("\n5️⃣  Fetch schema do ledger (validação forte)...");
      const fetchedRaw = await agent.fetchSchemaFromLedger(genesisAbs, schemaId);
      const payload = normalizeFetchPayload(fetchedRaw);

      // Esperado no Indy: { op: "REPLY", result: { data: { name, version, attr_names, id, ... } } }
      assert(payload && payload.op, "Fetch payload sem campo 'op'");
      assert(payload.result, "Fetch payload sem campo 'result'");

      const data = payload.result.data;
      assert(data, "Fetch payload sem result.data (schema não encontrado ou formato inesperado)");

      const fetchedName = data.name;
      const fetchedVersion = data.version;
      const fetchedId = data.id || payload.result.id;

      const fetchedAttrs = pickAttrNames(data);
      assert(typeof fetchedName === "string", "Schema data.name inválido");
      assert(typeof fetchedVersion === "string", "Schema data.version inválido");
      assert(Array.isArray(fetchedAttrs), "Schema data.attr_names inválido (não é array)");

      assert(fetchedName === name, `Nome do schema diferente. esperado=${name} obtido=${fetchedName}`);
      assert(fetchedVersion === version, `Versão do schema diferente. esperado=${version} obtido=${fetchedVersion}`);

      for (const a of attrs) {
        assert(fetchedAttrs.includes(a), `Atributo ausente no schema. faltando=${a}`);
      }

      // Opcional: valida que o id retornado bate com schemaId
      if (fetchedId) {
        // em muitos ledgers o ID vem igual ao schemaId
        assert(
          String(fetchedId) === String(schemaId),
          `Schema id retornado diferente. esperado=${schemaId} obtido=${fetchedId}`
        );
      }

      console.log("✅ Fetch OK: name/version/attrs confirmados.");

    } else {
      console.log("ℹ️ fetchSchemaFromLedger não existe no binding; pulando validação de fetch.");
    }

  } catch (e) {
    console.error("\n❌ ERRO:", e && e.stack ? e.stack : e);
    process.exitCode = 1;
  } finally {
    console.log("\n🔒 Fechando Wallet...");
    try { await agent.walletClose(); } catch { }
    console.log("👋 Encerrando.");
  }
}

main();
