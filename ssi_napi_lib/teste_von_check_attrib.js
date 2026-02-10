// teste_von_check_attrib.js
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
    console.log(`🚀 TESTE: VERIFICAR EXISTÊNCIA DE ATTRIB (Von-Network)`);
    
    const dbPath = "./wallet.db";
    const pass = "indicio_key_secure";
    const agent = new IndyAgent();

    try {
        await downloadGenesisHttp(NETWORK_CONFIG.genesisUrl, NETWORK_CONFIG.genesisFile);

        // 1. Setup Wallet e Rede
        if (!fs.existsSync(dbPath)) await agent.walletCreate(dbPath, pass);
        await agent.walletOpen(dbPath, pass);
        await agent.connectNetwork(NETWORK_CONFIG.genesisFile);

        // 2. Importar Trustee e Criar Usuário
        console.log("1️⃣  Preparando Identidade...");
        const [trusteeDid] = await agent.importDidFromSeed(NETWORK_CONFIG.trusteeSeed);
        const [myDid, myVerkey] = await agent.createOwnDid();
        
        await agent.registerDidOnLedger(
            NETWORK_CONFIG.genesisFile,
            trusteeDid,
            myDid,
            myVerkey,
            null
        );
        console.log(`    DID Registrado: ${myDid}`);

        // 3. TESTE 1: Verificar antes de escrever (Deve ser FALSE)
        const testKey = "status_conta";
        const testValue = "ativa";

        console.log(`\n2️⃣  Verificando chave '${testKey}' (Esperado: FALSE)...`);
        const existsBefore = await agent.checkAttribExists(
            NETWORK_CONFIG.genesisFile,
            myDid,
            testKey
        );

        if (existsBefore === false) {
            console.log("    ✅ Correto! O atributo ainda não existe.");
        } else {
            throw new Error("❌ Falha: O atributo foi encontrado antes de ser escrito!");
        }

        // 4. AÇÃO: Escrever o Atributo
        console.log(`\n3️⃣  Escrevendo ATTRIB no Ledger...`);
        await agent.writeAttribOnLedger(
            NETWORK_CONFIG.genesisFile,
            myDid,
            testKey,
            testValue
        );
        console.log("    ✅ Escrita concluída.");

        // Pequeno delay para garantir que o Ledger processou
        await new Promise(r => setTimeout(r, 1000));

        // 5. TESTE 2: Verificar depois de escrever (Deve ser TRUE)
        console.log(`\n4️⃣  Verificando chave '${testKey}' novamente (Esperado: TRUE)...`);
        const existsAfter = await agent.checkAttribExists(
            NETWORK_CONFIG.genesisFile,
            myDid,
            testKey
        );

        if (existsAfter === true) {
            console.log("    ✅ SUCESSO! O atributo foi detectado no Ledger.");
        } else {
            console.error("    ❌ ERRO: O atributo foi escrito mas não foi detectado!");
        }

    } catch (e) {
        console.error("\n❌ ERRO FATAL:", e);
    } finally {
        await agent.walletClose();
        console.log("\n🔒 Wallet fechada.");
    }
}

main();