// teste_indicio_get_schema.js
const fs = require('fs');
const https = require('https');

let IndyAgent;
try { IndyAgent = require('./index.js').IndyAgent; } 
catch { IndyAgent = require('./index.node').IndyAgent; }

// =============================================================================
// CONFIGURAÇÃO: INDICIO TESTNET
// =============================================================================
const NETWORK_CONFIG = {
    name: "Indicio TestNet",
    genesisUrl: "https://raw.githubusercontent.com/Indicio-tech/indicio-network/refs/heads/main/genesis_files/pool_transactions_testnet_genesis",
    genesisFile: "./indicio_testnet.txn"
};

// SEU ENDORSER (Necessário para criar o schema que vamos buscar depois)
const ISSUER_SEED = "+0HGyElhOr/GuwUaDsyiTn926bFMrBUh";
const ISSUER_DID  = "7DffLFWsgrwbt7T1Ni9cmu";

// =============================================================================
// UTILITÁRIOS
// =============================================================================
function downloadGenesisHttps(url, dest) {
    return new Promise((resolve, reject) => {
        if (fs.existsSync(dest)) { resolve(true); return; }
        const file = fs.createWriteStream(dest);
        console.log(`⏳ Baixando Genesis de: ${NETWORK_CONFIG.name}...`);
        https.get(url, (res) => {
            if (res.statusCode !== 200) { reject(new Error(`Erro HTTP: ${res.statusCode}`)); return; }
            res.pipe(file);
            file.on('finish', () => { file.close(() => { console.log("✅ Genesis baixado."); resolve(true); }); });
        }).on('error', (err) => { fs.unlink(dest, () => {}); reject(err); });
    });
}

async function main() {
    console.log(`🚀 TESTE: BUSCAR SCHEMA NA INDICIO TESTNET`);
    
    const dbPath = "./wallet.db";
    const pass = "indicio_key_secure";
    const agent = new IndyAgent();

    try {
        await downloadGenesisHttps(NETWORK_CONFIG.genesisUrl, NETWORK_CONFIG.genesisFile);

        // 1. Setup Wallet
        if (!fs.existsSync(dbPath)) await agent.walletCreate(dbPath, pass);
        await agent.walletOpen(dbPath, pass);
        await agent.connectNetwork(NETWORK_CONFIG.genesisFile);

        // 2. Garantir Identidade (Endorser)
        console.log("\n1️⃣  Verificando Identidade...");
        const [myDid] = await agent.importDidFromSeed(ISSUER_SEED);
        console.log(`    Issuer: ${myDid}`);

        if (myDid !== ISSUER_DID) throw new Error("DID incorreto para este teste!");

        // 3. Criar um Schema para garantir que temos algo para buscar
        // Usamos timestamp para garantir unicidade na rede pública
        const name = "SchemaTesteBuscaIndicio";
        const version = `1.${Math.floor(Date.now() / 1000)}`;
        const attrs = ["nome", "cpf", "validade"];

        console.log(`\n2️⃣  Registrando Schema de Teste: ${name} v${version}...`);
        console.log("    (Isso envolve aceitar TAA, pode levar alguns segundos...)");
        
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
        console.log(`\n3️⃣  Consultando Schema no Ledger (GET)...`);
        const responseJson = await agent.fetchSchemaFromLedger(
            NETWORK_CONFIG.genesisFile,
            schemaId
        );
        
        const response = JSON.parse(responseJson);
        const data = response.result.data; // O Ledger retorna os dados aqui

        // Tratamento robusto do campo data (pode vir como string ou objeto)
        const schemaData = typeof data === 'string' ? JSON.parse(data) : data;

        console.log("    ✅ Schema Encontrado!");
        console.log(`       Nome: ${schemaData.name}`);
        console.log(`       Versão: ${schemaData.version}`);
        console.log(`       SeqNo: ${response.result.seqNo}`); // A prova real de existência

        if (schemaData.name !== name) throw new Error("Nome do schema retornado incorreto!");

        // =====================================================================
        // 5. TESTE NEGATIVO: BUSCAR SCHEMA INEXISTENTE
        // =====================================================================
        console.log(`\n4️⃣  Testando busca de Schema inexistente...`);
        // Criamos um ID sintaticamente válido, mas que não existe no ledger
        const fakeId = `${myDid}:2:SchemaInexistenteXYZ:99.99`;
        
        try {
            await agent.fetchSchemaFromLedger(NETWORK_CONFIG.genesisFile, fakeId);
            console.error("    ❌ ERRO: A função deveria ter falhado, mas encontrou algo!");
        } catch (e) {
            // Verificamos se o erro foi o nosso "seqNo ausente"
            if (e.message.includes("seqNo ausente") || e.message.includes("não encontrado")) {
                console.log("    ✅ Sucesso: O Ledger retornou erro controlado.");
                console.log(`       Mensagem: ${e.message}`);
            } else {
                console.warn("    ⚠️  Erro diferente do esperado, mas ainda falhou (ok):", e.message);
            }
        }

    } catch (e) {
        console.error("\n❌ ERRO FATAL:", e);
    } finally {
        await agent.walletClose();
        console.log("\n🔒 Wallet fechada.");
    }
}

main();