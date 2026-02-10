const fs = require('fs');
const https = require('https');

let IndyAgent;
try { IndyAgent = require('./index.js').IndyAgent; } 
catch { IndyAgent = require('./index.node').IndyAgent; }

// =============================================================================
// CONFIGURAÇÃO: INDICIO TESTNET
// =============================================================================
const NETWORK_CONFIG = {
    genesisUrl: "https://raw.githubusercontent.com/Indicio-tech/indicio-network/refs/heads/main/genesis_files/pool_transactions_testnet_genesis",
    genesisFile: "./indicio_testnet.txn"
};

const ISSUER_SEED = "+0HGyElhOr/GuwUaDsyiTn926bFMrBUh";
const ISSUER_DID  = "7DffLFWsgrwbt7T1Ni9cmu";

// ⚠️ IMPORTANTE: COLOQUE AQUI O SCHEMA ID QUE VOCÊ GEROU NO TESTE ANTERIOR
// Exemplo: "7Dff...:2:CrachaFuncionario:1.171..."
const SCHEMA_ID = "7DffLFWsgrwbt7T1Ni9cmu:2:CrachaFuncionario:1.1767889899"; // <-- ATUALIZE ISSO!

function downloadGenesisHttps(url, dest) {
    return new Promise((resolve) => {
        if (fs.existsSync(dest)) { resolve(true); return; }
        const file = fs.createWriteStream(dest);
        https.get(url, (res) => {
            res.pipe(file);
            file.on('finish', () => { file.close(() => resolve(true)); });
        });
    });
}

async function main() {
    console.log("🚀 TESTE: CREDENTIAL DEFINITION (Indicio TestNet)");

    const dbPath = "./wallet.db";
    const pass = "indicio_key_secure";
    const agent = new IndyAgent();

    try {
        await downloadGenesisHttps(NETWORK_CONFIG.genesisUrl, NETWORK_CONFIG.genesisFile);

        if (!fs.existsSync(dbPath)) {
            // Se por acaso apagou a wallet, vai dar erro pois precisa das chaves do Issuer
            console.error("❌ Erro: Wallet não encontrada. Rode o teste_schema.js antes para preparar o ambiente.");
            return;
        }
        
        await agent.walletOpen(dbPath, pass);
        await agent.connectNetwork(NETWORK_CONFIG.genesisFile);

        console.log("1️⃣  Verificando Issuer...");
        const [myDid] = await agent.importDidFromSeed(ISSUER_SEED);
        
        // Tag para diferenciar CredDefs do mesmo schema (ex: 'default', 'tag1', 'v2')
        const tag = "default";

        console.log(`\n2️⃣  Criando Credential Definition...`);
        console.log(`    Schema ID: ${SCHEMA_ID}`);
        console.log(`    Tag:       ${tag}`);
        console.log("    (Isso pode demorar alguns segundos gerando chaves...)");

        const credDefId = await agent.createAndRegisterCredDef(
            NETWORK_CONFIG.genesisFile,
            myDid,      // Issuer
            SCHEMA_ID,  // Schema ID (que já deve estar no Ledger)
            tag         // Tag única
        );

        console.log("\n✅ SUCESSO! CredDef Registrada.");
        console.log("--------------------------------------------------");
        console.log(`🆔 CredDef ID: ${credDefId}`);
        console.log("--------------------------------------------------");
        console.log("💡 Agora você pode emitir credenciais usando este ID!");

    } catch (e) {
        console.error("❌ ERRO:", e);
    } finally {
        await agent.walletClose();
    }
}

main();