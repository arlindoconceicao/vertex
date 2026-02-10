// teste_von_attrib.js
const fs = require('fs');
const http = require('http');

let IndyAgent;
try { IndyAgent = require('./index.js').IndyAgent; } 
catch { IndyAgent = require('./index.node').IndyAgent; }

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
    console.log(`🚀 TESTE: ATTRIBS (Escrita e Leitura)`);
    
    const dbPath = "./wallet.db";
    const pass = "indicio_key_secure";
    const agent = new IndyAgent();

    try {
        await downloadGenesisHttp(NETWORK_CONFIG.genesisUrl, NETWORK_CONFIG.genesisFile);

        if (!fs.existsSync(dbPath)) await agent.walletCreate(dbPath, pass);
        await agent.walletOpen(dbPath, pass);
        await agent.connectNetwork(NETWORK_CONFIG.genesisFile);

        console.log("1️⃣  Importando Trustee...");
        const [trusteeDid] = await agent.importDidFromSeed(NETWORK_CONFIG.trusteeSeed);

        console.log("\n2️⃣  Criando Novo Usuário...");
        const [newDid, newVerkey] = await agent.createOwnDid();
        console.log(`    Novo DID: ${newDid}`);

        console.log("    Registrando no Ledger...");
        await agent.registerDidOnLedger(
            NETWORK_CONFIG.genesisFile,
            trusteeDid,
            newDid,
            newVerkey,
            null
        );
        console.log("    ✅ Usuário Registrado.");

        // USANDO UMA CHAVE GENÉRICA PARA EVITAR VALIDAÇÃO ESTRITA DE 'ENDPOINT'
        const key = "service_url";
        const value = "https://meu-agente.com/didcomm";
        
        console.log(`\n3️⃣  Escrevendo ATTRIB...`);
        console.log(`    DID:   ${newDid}`);
        console.log(`    Dados: { "${key}": "${value}" }`);

        await agent.writeAttribOnLedger(
            NETWORK_CONFIG.genesisFile,
            newDid,
            key,
            value
        );
        console.log("    ✅ Escrita Confirmada no Ledger.");

        console.log(`\n4️⃣  Lendo ATTRIB do Ledger...`);
        
        // Pequeno delay
        await new Promise(r => setTimeout(r, 1000));

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
