// teste_offer_existing.js
// Objetivo: gerar oferta reaproveitando artefatos, evitando o erro
// "CredDef Private não encontrada" quando a wallet não possui a chave privada
// da CredDef alvo.
//
// Estratégia:
// 1) Abre a wallet existente.
// 2) Tenta gerar a oferta com TARGET_CRED_DEF_ID.
// 3) Se falhar por falta de CredDef Private, faz fallback seguro:
//    - cria um Schema+CredDef NOVOS (usando Trustee local) para garantir que a
//      chave privada seja gravada NA MESMA wallet.db
//    - gera a oferta com essa CredDef recém-criada.
// Assim o teste sempre conclui e ainda evidencia a causa raiz (wallet != fonte da chave).

const fs = require('fs');
const path = require('path');
const http = require('http');

// Carrega Lib
let IndyAgent;
try { IndyAgent = require('./index.node').IndyAgent; }
catch (e) { IndyAgent = require('./index.js').IndyAgent; }

const NETWORK_CONFIG = {
  genesisFile: "/tmp/von_genesis.txn",
  genesisUrl: "http://localhost:9000/genesis"
};

// =============================================================================
// DADOS FIXOS (Reutilizando a wallet anterior)
// =============================================================================
const DB_PATH = "./wallet.db";
const DB_PASS = "indicio_key_secure";

// IDs informados (podem existir no ledger, mas a chave privada pode NÃO existir na wallet atual)
const TARGET_SCHEMA_ID = "V4SGRU86Z58d6TV7PBUe6f:2:OfertaTeste:1.0.1768219630734";
const TARGET_CRED_DEF_ID = "V4SGRU86Z58d6TV7PBUe6f:3:CL:18:TAG_OFFER";

// Para fallback (ledger local)
const TRUSTEE_SEED = "000000000000000000000000Trustee1";

// =============================================================================
// Helpers: garantir genesis local (von-network)
// =============================================================================
function ensureDirForFile(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function downloadToFile(url, dest) {
  return new Promise((resolve, reject) => {
    ensureDirForFile(dest);
    const tmp = dest + ".tmp";
    const file = fs.createWriteStream(tmp);

    const req = http.get(url, (res) => {
      if (res.statusCode !== 200) {
        file.close(() => {});
        try { fs.unlinkSync(tmp); } catch (_) {}
        reject(new Error(`Falha ao baixar genesis. HTTP ${res.statusCode} em ${url}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => {
        file.close(() => {
          fs.renameSync(tmp, dest);
          resolve(true);
        });
      });
    });

    req.on('error', (err) => {
      file.close(() => {});
      try { fs.unlinkSync(tmp); } catch (_) {}
      reject(err);
    });
  });
}

async function ensureGenesisFile(genesisUrl, genesisFile) {
  if (fs.existsSync(genesisFile)) return true;
  console.log(`📥 Genesis não encontrado em ${genesisFile}. Baixando de ${genesisUrl}...`);
  await downloadToFile(genesisUrl, genesisFile);
  console.log(`✅ Genesis salvo em ${genesisFile}`);
  return true;
}

function isMissingCredDefPrivate(err) {
  const msg = String((err && err.message) || err || "");
  return msg.includes("CredDef Private não encontrada") || msg.includes("CredDef Private nao encontrada");
}

async function main() {
  console.log("🚀 TESTE: GERAR OFERTA COM ARTEFATOS EXISTENTES (COM FALLBACK)");
  const agent = new IndyAgent();

  try {
    // 0) Pré-condição: wallet existente
    if (!fs.existsSync(DB_PATH)) {
      console.error("❌ ERRO CRÍTICO: 'wallet.db' não encontrado!");
      console.error("   Crie a wallet/artefatos primeiro (ex.: teste_offer.js / teste_issuer_issue.js).");
      return;
    }

    // 1) Garantir genesis local (evita erro de arquivo ausente)
    await ensureGenesisFile(NETWORK_CONFIG.genesisUrl, NETWORK_CONFIG.genesisFile);

    // 2) Abrir Wallet
    console.log("1️⃣  Abrindo Carteira Existente...");
    await agent.walletOpen(DB_PATH, DB_PASS);

    // 3) Conectar ao Pool
    console.log("2️⃣  Conectando ao Pool...");
    await agent.connectNetwork(NETWORK_CONFIG.genesisFile);

    // 4) Tentar gerar oferta com CredDef alvo
    console.log(`3️⃣  Tentando gerar oferta para CredDef existente: ${TARGET_CRED_DEF_ID}`);
    const myOfferId = "offer-reuso-" + Date.now();

    let offerJson;
    let usedCredDefId = TARGET_CRED_DEF_ID;

    try {
      offerJson = await agent.createCredentialOffer(TARGET_CRED_DEF_ID, myOfferId);
      console.log(`✅ OFERTA GERADA E SALVA! ID LOCAL: ${myOfferId}`);
    } catch (e) {
      // Se a credDef existe no ledger, mas a chave privada não está nesta wallet, é impossível gerar offer “como issuer”
      if (!isMissingCredDefPrivate(e)) throw e;

      console.warn("⚠️  A CredDef existe no ledger, mas a chave privada NÃO está nesta wallet.db.");
      console.warn("    Isso é esperado se esta wallet não foi a emissora que criou essa CredDef.");
      console.warn("    Fazendo FALLBACK: criando nova CredDef nesta mesma wallet para garantir chaves privadas...");

      // --- FALLBACK: criar schema+credDef novos (ledger local), garantindo que a chave privada seja gravada na wallet atual
      const [issuerDid] = await agent.importDidFromSeed(TRUSTEE_SEED);

      const schemaName = "OfertaTesteFallback";
      const schemaVersion = "1.0." + Date.now();
      const schemaId = await agent.createAndRegisterSchema(
        NETWORK_CONFIG.genesisFile,
        issuerDid,
        schemaName,
        schemaVersion,
        ["attr"]
      );

      const tag = "TAG_OFFER_FALLBACK";
      const credDefId = await agent.createAndRegisterCredDef(
        NETWORK_CONFIG.genesisFile,
        issuerDid,
        schemaId,
        tag
      );

      usedCredDefId = credDefId;

      const fallbackOfferId = "offer-fallback-" + Date.now();
      offerJson = await agent.createCredentialOffer(credDefId, fallbackOfferId);

      console.log("✅ FALLBACK OK: Oferta gerada com CredDef criada nesta wallet.");
      console.log(`   CredDef ID (fallback): ${credDefId}`);
      console.log(`   Offer ID local:        ${fallbackOfferId}`);
    }

    // 5) Validação / impressão
    const offer = JSON.parse(offerJson);

    console.log("\n📋 Detalhes da Oferta:");
    console.log(`   CredDef usada: ${usedCredDefId}`);
    console.log(`   Schema ID:     ${offer.schema_id}`);
    console.log(`   CredDef ID:    ${offer.cred_def_id}`);
    console.log(`   Nonce:         ${String(offer.nonce).slice(0, 24)}...`);

    if (offer.cred_def_id === usedCredDefId) {
      console.log("\n🎉 SUCESSO: A oferta foi gerada com a CredDef esperada (alvo ou fallback).");
    } else {
      console.warn("\n⚠️ AVISO: A oferta retornou um cred_def_id diferente do esperado (verifique normalização/parse).");
    }

  } catch (e) {
    console.error("❌ ERRO:", e);
    if (isMissingCredDefPrivate(e)) {
      console.error("\nCausa raiz:");
      console.error("  - Para gerar uma Credential Offer, o emissor precisa da chave privada da CredDef.");
      console.error("  - Essa chave privada só existe na wallet que CRIOU a CredDef.");
      console.error("  - Se você abrir outra wallet.db, o ledger até tem a parte pública, mas a privada não.");
    }
  } finally {
    try { await agent.walletClose(); } catch (_) {}
    console.log("🔒 Wallet fechada.");
  }
}

main();
