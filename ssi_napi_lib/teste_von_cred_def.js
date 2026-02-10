// teste_von_cred_def.js
// teste_von_cred_def.js
//
// OBJETIVO (corrigido):
// - Evitar falha "SeqNo ausente" quando o SCHEMA_ID não existe no ledger local.
// - Estratégia: tentar buscar o Schema informado; se não existir, criar e registrar
//   automaticamente um novo Schema na von-network e então criar a CredDef usando ele.
//
// Como usar:
//   node ./teste_von_cred_def.js
//
// Opcional (se quiser forçar um Schema específico):
//   SCHEMA_ID="V4SGRU86Z58d6TV7PBUe6f:2:MeuSchema:1.123" node ./teste_von_cred_def.js
//

const fs = require("fs");
const http = require("http");

// Importa a biblioteca (index.js ou .node)
let IndyAgent;
try {
  IndyAgent = require("./index.js").IndyAgent;
} catch {
  IndyAgent = require("./index.node").IndyAgent;
}

// =============================================================================
// CONFIGURAÇÃO: VON-NETWORK (LOCAL)
// =============================================================================
const NETWORK_CONFIG = {
  genesisUrl: "http://localhost:9000/genesis",
  genesisFile: "./von_genesis.txn",
  trusteeSeed: "000000000000000000000000Trustee1",
  trusteeDid: "V4SGRU86Z58d6TV7PBUe6f",
};

// Wallet padrão
const DB_PATH = "./wallet.db";
const DB_PASS = "indicio_key_secure";

// SCHEMA_ID opcional via env var (se não vier, a lógica pode criar um novo automaticamente)
const SCHEMA_ID_ENV = process.env.SCHEMA_ID || "";

// =============================================================================
// UTILITÁRIOS
// =============================================================================
function downloadGenesisHttp(url, dest) {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(dest)) return resolve(true);

    const file = fs.createWriteStream(dest);
    console.log(`⏳ Baixando Genesis de: ${url}...`);

    http
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          try { fs.unlinkSync(dest); } catch (_) {}
          return reject(new Error(`Falha ao baixar genesis: HTTP ${res.statusCode}`));
        }

        res.pipe(file);
        file.on("finish", () => file.close(() => resolve(true)));
      })
      .on("error", (err) => {
        try { fs.unlinkSync(dest); } catch (_) {}
        reject(err);
      });
  });
}

function isSeqNoMissingError(e) {
  const msg = (e && e.message) ? e.message : String(e);
  return (
    msg.includes("SeqNo ausente") ||
    msg.includes("seqNo ausente") ||
    msg.includes("não encontrado") ||
    msg.includes("not found") ||
    msg.includes("data is null")
  );
}

// =============================================================================
// FLUXO PRINCIPAL
// =============================================================================
async function main() {
  console.log("🚀 TESTE: CREDENTIAL DEFINITION (Von-Network) - CORRIGIDO (COM FALLBACK)");

  const agent = new IndyAgent();

  try {
    // 1) Garantir Genesis
    await downloadGenesisHttp(NETWORK_CONFIG.genesisUrl, NETWORK_CONFIG.genesisFile);

    // 2) Wallet (persistente)
    if (!fs.existsSync(DB_PATH)) {
      console.log("1️⃣  Criando nova Wallet...");
      await agent.walletCreate(DB_PATH, DB_PASS);
    } else {
      console.log("1️⃣  Abrindo Wallet existente...");
    }
    await agent.walletOpen(DB_PATH, DB_PASS);

    // 3) Conectar no pool
    console.log("2️⃣  Conectando ao Pool...");
    await agent.connectNetwork(NETWORK_CONFIG.genesisFile);

    // 4) Importar Trustee
    console.log("3️⃣  Importando Trustee (Issuer)...");
    const [issuerDid] = await agent.importDidFromSeed(NETWORK_CONFIG.trusteeSeed);
    console.log(`    Issuer DID: ${issuerDid}`);

    if (issuerDid !== NETWORK_CONFIG.trusteeDid) {
      console.warn(
        `⚠️  Aviso: DID importado (${issuerDid}) difere do esperado (${NETWORK_CONFIG.trusteeDid}).`
      );
    }

    // 5) Determinar Schema a usar: tentar buscar o fornecido, senão criar um novo
    let schemaIdToUse = SCHEMA_ID_ENV.trim();
    let schemaWasCreated = false;

    if (schemaIdToUse) {
      console.log(`\n4️⃣  Verificando Schema informado (env SCHEMA_ID)...`);
      console.log(`    Schema ID: ${schemaIdToUse}`);

      try {
        const schemaRespJson = await agent.fetchSchemaFromLedger(
          NETWORK_CONFIG.genesisFile,
          schemaIdToUse
        );

        // Opcional: apenas validar que retornou algo com seqNo.
        const schemaResp = JSON.parse(schemaRespJson);
        if (!schemaResp.result || !schemaResp.result.seqNo) {
          // Alguns ledgers podem estruturar diferente; mas se não tem seqNo, tratamos como ausente.
          throw new Error("SeqNo ausente (schema não existe no ledger?)");
        }

        console.log(`    ✅ Schema existe no ledger (seqNo: ${schemaResp.result.seqNo}).`);
      } catch (e) {
        if (!isSeqNoMissingError(e)) throw e;

        console.warn("    ⚠️  Schema informado NÃO existe no ledger local (SeqNo ausente).");
        console.warn("    Fazendo FALLBACK: criando um novo Schema na von-network...");
        schemaIdToUse = ""; // força criação abaixo
      }
    }

    if (!schemaIdToUse) {
      // Criar schema novo automaticamente
      const name = "CrachaCorporativoAuto";
      const version = `1.0.${Date.now()}`; // garante unicidade no ledger local
      const attrs = ["nome_completo", "cargo", "cpf", "data_admissao"];

      console.log(`\n4️⃣  Criando Schema (fallback automático)...`);
      console.log(`    Nome: ${name}`);
      console.log(`    Versão: ${version}`);
      console.log(`    Atributos: [${attrs.join(", ")}]`);

      schemaIdToUse = await agent.createAndRegisterSchema(
        NETWORK_CONFIG.genesisFile,
        issuerDid,
        name,
        version,
        attrs
      );

      schemaWasCreated = true;
      console.log(`    ✅ Schema criado: ${schemaIdToUse}`);
    }

    // 6) Criar CredDef
    const tag = schemaWasCreated ? "default_auto" : "default";
    console.log(`\n5️⃣  Criando Credential Definition...`);
    console.log(`    Schema ID: ${schemaIdToUse}`);
    console.log(`    Tag:       ${tag}`);

    const credDefId = await agent.createAndRegisterCredDef(
      NETWORK_CONFIG.genesisFile,
      issuerDid,
      schemaIdToUse,
      tag
    );

    console.log("\n✅ SUCESSO! CredDef Registrada na Von-Network.");
    console.log("--------------------------------------------------");
    console.log(`🆔 Schema ID:  ${schemaIdToUse}`);
    console.log(`🆔 CredDef ID: ${credDefId}`);
    console.log("--------------------------------------------------");

    if (!SCHEMA_ID_ENV) {
      console.log("💡 Dica: se quiser reutilizar o mesmo schema em execuções futuras, rode:");
      console.log(`   SCHEMA_ID="${schemaIdToUse}" node ./teste_von_cred_def.js`);
    }
  } catch (e) {
    console.error("\n❌ ERRO:", e);
    console.error(
      "Dica: verifique se a von-network está rodando e se o genesis está acessível em http://localhost:9000/genesis"
    );
  } finally {
    try {
      await agent.walletClose();
    } catch (_) {}
    console.log("🔒 Carteira fechada.");
  }
}

main();
