// teste_von_get_schema.js
const fs = require('fs');
const http = require('http');

let IndyAgent;
try { IndyAgent = require('./index.js').IndyAgent; } 
catch { IndyAgent = require('./index.node').IndyAgent; }

// =============================================================================
// CONFIGURAÇÃO: VON-NETWORK
// =============================================================================
const NETWORK_CONFIG = {
    genesisUrl: "http://localhost:9000/genesis",
    genesisFile: "./von_genesis.txn",
    trusteeSeed: "000000000000000000000000Trustee1",
    trusteeDid:  "V4SGRU86Z58d6TV7PBUe6f"
};

function downloadGenesisHttp(url, dest) {
    return new Promise((resolve) => {
        if (fs.existsSync(dest)) { resolve(true); return; }
        const file = fs.createWriteStream(dest);
        http.get(url, (res) => {
            res.pipe(file);
            file.on('finish', () => { file.close(() => resolve(true)); });
        });
    });
}

async function main() {
    console.log(`🚀 TESTE: BUSCAR SCHEMA NO LEDGER (GET_SCHEMA)`);
    
    const dbPath = "./wallet.db";
    const pass = "indicio_key_secure";
    const agent = new IndyAgent();

    try {
        await downloadGenesisHttp(NETWORK_CONFIG.genesisUrl, NETWORK_CONFIG.genesisFile);

        // 1. Setup Wallet
        if (!fs.existsSync(dbPath)) await agent.walletCreate(dbPath, pass);
        await agent.walletOpen(dbPath, pass);
        await agent.connectNetwork(NETWORK_CONFIG.genesisFile);

        // 2. Garantir Identidade (Trustee)
        const [myDid] = await agent.importDidFromSeed(NETWORK_CONFIG.trusteeSeed);
        
        // 3. Criar um Schema para testar a busca
        const name = "SchemaDeTesteBusca";
        const version = `1.${Math.floor(Date.now() / 1000)}`;
        const attrs = ["campo_a", "campo_b"];

        console.log(`\n1️⃣  Registrando Schema de Teste: ${name} v${version}...`);
        const schemaId = await agent.createAndRegisterSchema(
            NETWORK_CONFIG.genesisFile,
            myDid,
            name,
            version,
            attrs
        );
        console.log(`    -> ID Criado: ${schemaId}`);

        // =====================================================================
        // 4. TESTE POSITIVO: BUSCAR SCHEMA EXISTENTE
        // =====================================================================
        console.log(`\n2️⃣  Consultando Schema no Ledger...`);
        const responseJson = await agent.fetchSchemaFromLedger(
            NETWORK_CONFIG.genesisFile,
            schemaId
        );
        
        const response = JSON.parse(responseJson);
        const data = response.result.data; // O Ledger retorna os dados aqui

        // O campo 'data' pode vir como string (nas versões antigas) ou objeto
        const schemaData = typeof data === 'string' ? JSON.parse(data) : data;

        console.log("    ✅ Schema Encontrado!");
        console.log(`       Nome: ${schemaData.name}`);
        console.log(`       Versão: ${schemaData.version}`);
        console.log(`       SeqNo: ${response.result.seqNo}`);

        if (schemaData.name !== name) throw new Error("Nome do schema retornado incorreto!");

        // =====================================================================
        // 5. TESTE NEGATIVO: BUSCAR SCHEMA INEXISTENTE
        // =====================================================================
        console.log(`\n3️⃣  Testando busca de Schema inexistente...`);
        const fakeId = `${myDid}:2:SchemaFantasma:99.99`;
        
        try {
            await agent.fetchSchemaFromLedger(NETWORK_CONFIG.genesisFile, fakeId);
            console.error("    ❌ ERRO: A função deveria ter falhado, mas encontrou algo!");
        } catch (e) {
            console.log("    ✅ Sucesso: O Ledger retornou erro como esperado.");
            console.log(`       Mensagem: ${e.message}`);
        }

    } catch (e) {
        console.error("\n❌ ERRO FATAL:", e);
    } finally {
        await agent.walletClose();
        console.log("\n🔒 Wallet fechada.");
    }
}

main();