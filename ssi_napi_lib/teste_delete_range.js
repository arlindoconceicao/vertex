// teste_delete_range.js
const fs = require('fs');
const path = require('path');
const http = require('http');            // von-network local é HTTP
const https = require('https');          // fallback caso use https
const { promisify } = require('util');
const sleep = promisify(setTimeout);

// Carrega Lib
let IndyAgent;
try { IndyAgent = require('./index.node').IndyAgent; } 
catch (e) { IndyAgent = require('./index.js').IndyAgent; }

const NETWORK_CONFIG = {
  genesisFile: "/tmp/von_genesis.txn",
  genesisUrl: "http://localhost:9000/genesis"
};

const DB_PATH = "./wallet.db";
const DB_PASS = "indicio_key_secure";
const TRUSTEE_SEED = "000000000000000000000000Trustee1";

function ensureDirForFile(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function downloadToFile(url, dest) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https://') ? https : http;

    ensureDirForFile(dest);

    const tmp = dest + ".tmp";
    const file = fs.createWriteStream(tmp);

    const req = proto.get(url, (res) => {
      if (res.statusCode !== 200) {
        file.close(() => {});
        try { fs.unlinkSync(tmp); } catch (_) {}
        reject(new Error(`Falha ao baixar genesis. HTTP ${res.statusCode} em ${url}`));
        return;
      }

      res.pipe(file);
      file.on('finish', () => {
        file.close(() => {
          // troca atômica
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

async function main() {
  console.log("🚀 TESTE: EXCLUSÃO EM LOTE POR DATA");
  const agent = new IndyAgent();

  try {
    // 0) Garantir genesis local
    await ensureGenesisFile(NETWORK_CONFIG.genesisUrl, NETWORK_CONFIG.genesisFile);

    // 1) Wallet + Network
    if (!fs.existsSync(DB_PATH)) await agent.walletCreate(DB_PATH, DB_PASS);
    await agent.walletOpen(DB_PATH, DB_PASS);
    await agent.connectNetwork(NETWORK_CONFIG.genesisFile);

    const [issuerDid] = await agent.importDidFromSeed(TRUSTEE_SEED);

    // Setup rápido (escreve no ledger local)
    const schemaId = await agent.createAndRegisterSchema(
      NETWORK_CONFIG.genesisFile,
      issuerDid,
      "DelRange",
      "1.0." + Date.now(),
      ["a"]
    );

    const credDefId = await agent.createAndRegisterCredDef(
      NETWORK_CONFIG.genesisFile,
      issuerDid,
      schemaId,
      "TAG"
    );

    // --- PASSO 1: CRIAR LOTE ANTIGO (Para ser deletado) ---
    console.log("1️⃣  Criando Lote Antigo (3 ofertas)...");
    for (let i = 0; i < 3; i++) {
      await agent.createCredentialOffer(credDefId, `lote-antigo-${i}-${Date.now()}`);
    }

    console.log("    ⏳ Aguardando 2 segundos...");
    await sleep(2000);

    // Define o ponto de corte (Agora)
    const cutoffTimestamp = Math.floor(Date.now() / 1000);
    console.log(`    ✂️  Ponto de Corte: ${cutoffTimestamp}`);

    console.log("    ⏳ Aguardando mais 2 segundos...");
    await sleep(2000);

    // --- PASSO 2: CRIAR LOTE NOVO (Para ser mantido) ---
    console.log("2️⃣  Criando Lote Novo (2 ofertas)...");
    for (let i = 0; i < 2; i++) {
      await agent.createCredentialOffer(credDefId, `lote-novo-${i}-${Date.now()}`);
    }

    // Total antes
    const jsonAntes = await agent.listCredentialOffers();
    const totalAntes = JSON.parse(jsonAntes).length;
    console.log(`    📦 Total na carteira antes: ${totalAntes}`);

    // --- PASSO 3: EXECUTAR DELEÇÃO ---
    console.log(`3️⃣  Deletando tudo criado ANTES de ${cutoffTimestamp}...`);
    const deletedCount = await agent.deleteCredentialOffersRange(0, cutoffTimestamp);
    console.log(`    🗑️  Registros deletados: ${deletedCount}`);

    // --- PASSO 4: VERIFICAÇÃO ---
    const jsonDepois = await agent.listCredentialOffers();
    const listaDepois = JSON.parse(jsonDepois);
    console.log(`    📦 Total na carteira depois: ${listaDepois.length}`);

    const temNovo = listaDepois.some(o => String(o.id_local).includes("lote-novo"));
    const temAntigo = listaDepois.some(o => String(o.id_local).includes("lote-antigo"));

    if (temNovo && !temAntigo) {
      console.log("✅ SUCESSO: Ofertas antigas removidas e novas preservadas.");
    } else {
      console.error("❌ FALHA NA LÓGICA DE EXCLUSÃO:");
      console.log(`   Tem Novo? ${temNovo}`);
      console.log(`   Tem Antigo? ${temAntigo}`);
    }

  } catch (e) {
    console.error("❌ ERRO:", e);
  } finally {
    await agent.walletClose();
  }
}

main();
