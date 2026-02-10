// teste_schema.js
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

const ISSUER_SEED = "+0HGyElhOr/GuwUaDsyiTn926bFMrBUh"; // Seu Endorser
const ISSUER_DID  = "7DffLFWsgrwbt7T1Ni9cmu";

// =============================================================================
// UTILITÁRIOS
// =============================================================================
function downloadGenesisHttps(url, dest) {
    return new Promise((resolve, reject) => {
        if (fs.existsSync(dest)) { resolve(true); return; }
        const file = fs.createWriteStream(dest);
        https.get(url, (res) => {
            res.pipe(file);
            file.on('finish', () => { file.close(() => resolve(true)); });
        }).on('error', (err) => { fs.unlink(dest, () => {}); reject(err); });
    });
}

// =============================================================================
// FLUXO PRINCIPAL
// =============================================================================
async function main() {
    console.log("🚀 TESTE: CRIAR E REGISTRAR SCHEMA (Indicio TestNet)");
    
    // Usando a mesma wallet padronizada
    const dbPath = "./wallet.db";
    const pass = "indicio_key_secure";
    const agent = new IndyAgent();

    try {
        await downloadGenesisHttps(NETWORK_CONFIG.genesisUrl, NETWORK_CONFIG.genesisFile);

        // 1. Setup Wallet
        if (!fs.existsSync(dbPath)) {
            console.log("1️⃣  Criando nova Wallet...");
            await agent.walletCreate(dbPath, pass);
        } else {
            console.log("1️⃣  Abrindo Wallet existente...");
        }
        await agent.walletOpen(dbPath, pass);

        // 2. Conectar
        console.log("2️⃣  Conectando ao Ledger...");
        await agent.connectNetwork(NETWORK_CONFIG.genesisFile);

        // 3. Garantir Issuer (Endorser)
        console.log("3️⃣  Verificando Issuer...");
        const [myDid] = await agent.importDidFromSeed(ISSUER_SEED);
        console.log(`    Issuer: ${myDid}`);

        if (myDid !== ISSUER_DID) throw new Error("DID incorreto!");

        // 4. Definir Schema
        // IMPORTANTE: Nome + Versão deve ser ÚNICO no Ledger.
        // Usamos timestamp para garantir que o teste rode múltiplas vezes sem erro.
        const name = "CrachaFuncionario";
        const version = `1.${Math.floor(Date.now() / 1000)}`; 
        const attrs = ["nome_completo", "cargo", "cpf", "data_admissao"];

        console.log(`\n4️⃣  Registrando Schema: ${name} v${version}...`);
        console.log(`    Atributos: [${attrs.join(", ")}]`);
        
        // Chamada Rust (que agora inclui TAA)
        const schemaId = await agent.createAndRegisterSchema(
            NETWORK_CONFIG.genesisFile,
            myDid,      // Issuer (Endorser)
            name,       // Nome
            version,    // Versão
            attrs       // Atributos
        );

        console.log("\n✅ SUCESSO! Schema Registrado.");
        console.log("--------------------------------------------------");
        console.log(`🆔 Schema ID: ${schemaId}`);
        console.log("--------------------------------------------------");
        console.log("💡 Guarde este ID para criar a Credential Definition depois.");

    } catch (e) {
        console.error("\n❌ ERRO:", e);
    } finally {
        await agent.walletClose();
        console.log("🔒 Wallet fechada.");
    }
}

main();