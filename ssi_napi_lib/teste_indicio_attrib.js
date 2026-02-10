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

// SEU ENDORSER (Necessário para registrar o novo usuário na rede)
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
    console.log(`🚀 TESTE: ATTRIBS NA INDICIO TESTNET`);
    
    const dbPath = "./wallet.db";
    const pass = "indicio_key_secure";
    const agent = new IndyAgent();

    try {
        await downloadGenesisHttps(NETWORK_CONFIG.genesisUrl, NETWORK_CONFIG.genesisFile);

        // 1. Setup Wallet
        if (!fs.existsSync(dbPath)) await agent.walletCreate(dbPath, pass);
        await agent.walletOpen(dbPath, pass);
        await agent.connectNetwork(NETWORK_CONFIG.genesisFile);

        // 2. Importar Endorser
        console.log("1️⃣  Importando Endorser...");
        const [endorserDid] = await agent.importDidFromSeed(ISSUER_SEED);
        
        if (endorserDid !== ISSUER_DID) throw new Error("DID do Endorser incorreto!");

        // 3. Criar e Registrar um Novo Usuário
        // Precisamos de um DID novo para não sujar o Endorser com atributos de teste
        console.log("\n2️⃣  Criando Novo Usuário (Holder)...");
        const [newDid, newVerkey] = await agent.createOwnDid();
        console.log(`    Novo DID: ${newDid}`);

        console.log("    Registrando no Ledger (via Endorser)...");
        // Nota: O Endorser paga a taxa/assina a criação do novo DID
        await agent.registerDidOnLedger(
            NETWORK_CONFIG.genesisFile,
            endorserDid,
            newDid,
            newVerkey,
            null // Role USER comum
        );
        console.log("    ✅ Usuário Registrado com sucesso.");

        // 4. Escrever Atributo
        // O próprio usuário escreve em si mesmo.
        // A Indicio exige TAA, e nossa função writeAttribOnLedger já trata isso automaticamente.
        const key = "service_endpoint";
        const value = "https://meu-agente-indicio.com/endpoint";
        
        console.log(`\n3️⃣  Escrevendo ATTRIB (Auto-assinado com TAA)...`);
        console.log(`    DID:   ${newDid}`);
        console.log(`    Dados: { "${key}": "${value}" }`);

        await agent.writeAttribOnLedger(
            NETWORK_CONFIG.genesisFile,
            newDid, // Quem assina é o dono do atributo
            key,
            value
        );
        console.log("    ✅ Escrita Confirmada no Ledger.");

        // 5. Ler Atributo
        console.log(`\n4️⃣  Lendo ATTRIB do Ledger...`);
        
        // Delay para garantir propagação nos nós da rede pública
        console.log("    (Aguardando propagação...)");
        await new Promise(r => setTimeout(r, 3000));

        const readValue = await agent.readAttribFromLedger(
            NETWORK_CONFIG.genesisFile,
            newDid,
            key
        );

        console.log(`    📥 Valor Retornado: "${readValue}"`);

        if (readValue === value) {
            console.log("\n🎉 SUCESSO! O valor lido é igual ao escrito.");
        } else {
            console.error("\n❌ ERRO: O valor lido difere do esperado.");
        }

    } catch (e) {
        console.error("\n❌ ERRO FATAL:", e);
    } finally {
        await agent.walletClose();
        console.log("\n🔒 Wallet fechada.");
    }
}

main();