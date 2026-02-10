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

// Endorser para pagar as taxas de registro do novo usuário
const ISSUER_SEED = "+0HGyElhOr/GuwUaDsyiTn926bFMrBUh";
const ISSUER_DID  = "7DffLFWsgrwbt7T1Ni9cmu";

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
    console.log(`🚀 TESTE: VERIFICAR EXISTÊNCIA DE ATTRIB (Indicio TestNet)`);
    
    const dbPath = "./wallet.db";
    const pass = "indicio_key_secure";
    const agent = new IndyAgent();

    try {
        await downloadGenesisHttps(NETWORK_CONFIG.genesisUrl, NETWORK_CONFIG.genesisFile);

        // 1. Setup
        if (!fs.existsSync(dbPath)) await agent.walletCreate(dbPath, pass);
        await agent.walletOpen(dbPath, pass);
        await agent.connectNetwork(NETWORK_CONFIG.genesisFile);

        // 2. Preparar Identidades
        console.log("1️⃣  Autenticando Endorser...");
        const [endorserDid] = await agent.importDidFromSeed(ISSUER_SEED);

        console.log("\n2️⃣  Criando Novo Usuário (Holder)...");
        // Criamos um DID novo a cada teste para garantir estado limpo (sem atributos prévios)
        const [newDid, newVerkey] = await agent.createOwnDid();
        console.log(`    Novo DID: ${newDid}`);

        console.log("    Registrando no Ledger (via Endorser)...");
        await agent.registerDidOnLedger(
            NETWORK_CONFIG.genesisFile,
            endorserDid,
            newDid,
            newVerkey,
            null
        );
        console.log("    ✅ Usuário Registrado.");

        // 3. TESTE 1: Verificar antes de escrever (Esperado: FALSE)
        // Usamos uma chave única com timestamp para evitar colisão se rodar o teste rápido demais
        const testKey = "kyc_status";
        const testValue = "verified_level_2";

        console.log(`\n3️⃣  Verificando chave '${testKey}' (Esperado: FALSE)...`);
        const existsBefore = await agent.checkAttribExists(
            NETWORK_CONFIG.genesisFile,
            newDid,
            testKey
        );

        if (existsBefore === false) {
            console.log("    ✅ Correto! O atributo ainda não existe.");
        } else {
            throw new Error("❌ Falha: O atributo foi encontrado antes de ser escrito!");
        }

        // 4. AÇÃO: Escrever o Atributo
        console.log(`\n4️⃣  Escrevendo ATTRIB no Ledger...`);
        console.log("    (Enviando transação com TAA automático...)");
        
        await agent.writeAttribOnLedger(
            NETWORK_CONFIG.genesisFile,
            newDid,
            testKey,
            testValue
        );
        console.log("    ✅ Escrita concluída.");

        // Delay para propagação na rede pública
        console.log("    ⏳ Aguardando 3s para propagação...");
        await new Promise(r => setTimeout(r, 3000));

        // 5. TESTE 2: Verificar depois de escrever (Esperado: TRUE)
        console.log(`\n5️⃣  Verificando chave '${testKey}' novamente (Esperado: TRUE)...`);
        const existsAfter = await agent.checkAttribExists(
            NETWORK_CONFIG.genesisFile,
            newDid,
            testKey
        );

        if (existsAfter === true) {
            console.log("    ✅ SUCESSO! O atributo foi detectado no Ledger.");
        } else {
            // Tenta ler para ver o erro detalhado se falhar
            console.warn("    ⚠️  Check falhou. Tentando leitura direta para debug...");
            try {
                await agent.readAttribFromLedger(NETWORK_CONFIG.genesisFile, newDid, testKey);
            } catch(e) {
                console.log("    Erro na leitura:", e.message);
            }
            console.error("    ❌ ERRO: O atributo foi escrito mas a verificação retornou FALSE.");
        }

    } catch (e) {
        console.error("\n❌ ERRO FATAL:", e);
    } finally {
        await agent.walletClose();
        console.log("\n🔒 Wallet fechada.");
    }
}

main();