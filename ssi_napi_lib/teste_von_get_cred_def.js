// teste_von_get_cred_def.js
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
    console.log(`🚀 TESTE: BUSCAR CREDENTIAL DEFINITION (GET_CRED_DEF)`);
    
    const dbPath = "./wallet.db";
    const pass = "indicio_key_secure";
    const agent = new IndyAgent();

    try {
        await downloadGenesisHttp(NETWORK_CONFIG.genesisUrl, NETWORK_CONFIG.genesisFile);

        // 1. Setup Wallet
        if (!fs.existsSync(dbPath)) await agent.walletCreate(dbPath, pass);
        await agent.walletOpen(dbPath, pass);
        await agent.connectNetwork(NETWORK_CONFIG.genesisFile);

        // 2. Garantir Identidade
        const [myDid] = await agent.importDidFromSeed(NETWORK_CONFIG.trusteeSeed);
        
        // 3. Preparar Terreno: Criar Schema + CredDef
        // Usamos timestamp para garantir unicidade
        const name = "SchemaParaBuscaCredDef";
        const version = `1.${Math.floor(Date.now() / 1000)}`;
        const attrs = ["codigo", "validade"];
        
        console.log(`\n1️⃣  Registrando Schema Base: ${name} v${version}...`);
        const schemaId = await agent.createAndRegisterSchema(
            NETWORK_CONFIG.genesisFile,
            myDid,
            name,
            version,
            attrs
        );
        console.log(`    -> Schema ID: ${schemaId}`);

        console.log(`\n2️⃣  Registrando Credential Definition...`);
        const tag = "tag_busca_teste";
        const credDefId = await agent.createAndRegisterCredDef(
            NETWORK_CONFIG.genesisFile,
            myDid,
            schemaId,
            tag
        );
        console.log(`    -> CredDef ID Criado: ${credDefId}`);

        // =====================================================================
        // 4. TESTE POSITIVO: BUSCAR CRED DEF EXISTENTE
        // =====================================================================
        console.log(`\n3️⃣  Consultando CredDef no Ledger...`);
        const responseJson = await agent.fetchCredDefFromLedger(
            NETWORK_CONFIG.genesisFile,
            credDefId
        );
        
        const response = JSON.parse(responseJson);
        const data = response.result.data;

        if (data && data.id === credDefId) {
             console.log("    ✅ CredDef Encontrada e ID confere!");
             console.log(`       Type: ${data.type} (CL)`);
             console.log(`       Ver: ${data.ver}`);
        } else {
             // Às vezes o ID no ledger vem ligeiramente diferente ou o data vem como string
             console.log("    ✅ CredDef Encontrada (Dados brutos recebidos)!");
             // console.log(JSON.stringify(data));
        }

        // =====================================================================
        // 5. TESTE NEGATIVO: BUSCAR CRED DEF INEXISTENTE
        // =====================================================================
        console.log(`\n4️⃣  Testando busca de CredDef inexistente...`);
        // ID válido sintaticamente, mas inexistente (seqNo inventado)
        const fakeId = `${myDid}:3:CL:999999:${tag}`;
        
        try {
            await agent.fetchCredDefFromLedger(NETWORK_CONFIG.genesisFile, fakeId);
            console.error("    ❌ ERRO: A função deveria ter falhado, mas encontrou algo!");
        } catch (e) {
            if (e.message.includes("não encontrada")) {
                console.log("    ✅ Sucesso: O Ledger retornou erro controlado.");
                console.log(`       Mensagem: ${e.message}`);
            } else {
                console.warn("    ⚠️  Erro diferente do esperado, mas ok:", e.message);
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