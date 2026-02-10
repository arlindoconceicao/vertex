// teste_list_range.js
const fs = require('fs');

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

async function main() {
    console.log("🚀 TESTE: FILTRO POR DATA (CREATED_AT)");
    const agent = new IndyAgent();

    try {
        if (!fs.existsSync(DB_PATH)) {
            // Setup rápido se não existir
            await agent.walletCreate(DB_PATH, DB_PASS);
        }
        await agent.walletOpen(DB_PATH, DB_PASS);

        // --- PREPARAÇÃO: Criar uma oferta "AGORA" para garantir dados ---
        await agent.connectNetwork(NETWORK_CONFIG.genesisFile);
        const [issuerDid] = await agent.importDidFromSeed(TRUSTEE_SEED);
        
        // Cria artefatos rápidos
        const schemaId = await agent.createAndRegisterSchema(NETWORK_CONFIG.genesisFile, issuerDid, "RangeCheck", "1.0."+Date.now(), ["attr"]);
        const credDefId = await agent.createAndRegisterCredDef(NETWORK_CONFIG.genesisFile, issuerDid, schemaId, "TAG");
        
        const nowId = "offer-now-" + Date.now();
        await agent.createCredentialOffer(credDefId, nowId);
        console.log(`✅ Oferta criada agora: ${nowId}`);

        // --- DEFINIÇÃO DE DATAS (EM SEGUNDOS) ---
        // JS Date.now() é milissegundos. Rust SystemTime é Segundos.
        // Precisamos dividir por 1000.
        
        const nowSeconds = Math.floor(Date.now() / 1000);
        
        // Intervalo 1: Últimos 5 minutos (Deve encontrar a oferta criada acima)
        const start1 = nowSeconds - 300; 
        const end1   = nowSeconds + 60; 

        console.log(`\n🔎 BUSCA 1: Recentes (${start1} até ${end1})`);
        const json1 = await agent.listCredentialOffersRange(start1, end1);
        const list1 = JSON.parse(json1);
        console.log(`   Resultados: ${list1.length}`);
        
        const found = list1.find(o => o.id_local === nowId);
        if (found) console.log(`   ✅ Sucesso: Encontrou a oferta ${nowId}`);
        else console.error(`   ❌ Falha: Não encontrou a oferta recém criada.`);

        // Intervalo 2: Ano Passado (Não deve encontrar a oferta de hoje)
        const start2 = nowSeconds - 1000000;
        const end2   = nowSeconds - 900000;
        
        console.log(`\n🔎 BUSCA 2: Passado Distante (${start2} até ${end2})`);
        const json2 = await agent.listCredentialOffersRange(start2, end2);
        const list2 = JSON.parse(json2);
        console.log(`   Resultados: ${list2.length}`);

        if (list2.length === 0) console.log("   ✅ Sucesso: Lista vazia conforme esperado.");
        else console.error("   ❌ Falha: Encontrou registros que não deveriam estar aqui.");

    } catch (e) {
        console.error("❌ ERRO:", e);
    } finally {
        await agent.walletClose();
    }
}

main();