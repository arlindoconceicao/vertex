// teste_indicio_get_cred_def.js
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

// SEU ENDORSER (Necessário para criar o schema e a cred def)
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
    console.log(`🚀 TESTE: BUSCAR CREDENTIAL DEFINITION (Indicio TestNet)`);
    
    const dbPath = "./wallet.db";
    const pass = "indicio_key_secure";
    const agent = new IndyAgent();

    try {
        await downloadGenesisHttps(NETWORK_CONFIG.genesisUrl, NETWORK_CONFIG.genesisFile);

        // 1. Setup Wallet
        if (!fs.existsSync(dbPath)) await agent.walletCreate(dbPath, pass);
        await agent.walletOpen(dbPath, pass);
        await agent.connectNetwork(NETWORK_CONFIG.genesisFile);

        // 2. Garantir Identidade
        console.log("1️⃣  Verificando Identidade...");
        const [myDid] = await agent.importDidFromSeed(ISSUER_SEED);
        
        if (myDid !== ISSUER_DID) throw new Error("DID incorreto!");

        // 3. Preparar: Schema + CredDef
        // Usamos timestamp para garantir unicidade na rede pública
        const name = "SchemaBuscaIndicio";
        const version = `1.${Math.floor(Date.now() / 1000)}`;
        const attrs = ["nome_completo", "documento", "status"];

        console.log(`\n2️⃣  Registrando Schema Base: ${name} v${version}...`);
        // (Envolve TAA automático)
        const schemaId = await agent.createAndRegisterSchema(
            NETWORK_CONFIG.genesisFile,
            myDid,
            name,
            version,
            attrs
        );
        console.log(`    -> Schema ID: ${schemaId}`);

        console.log(`\n3️⃣  Registrando Credential Definition...`);
        const tag = "tag_busca_indicio";
        // (Envolve leitura do schema no ledger + TAA automático)
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
        console.log(`\n4️⃣  Consultando CredDef no Ledger (GET)...`);
        
        // Pequeno delay para garantir propagação em rede pública
        await new Promise(r => setTimeout(r, 2000));

        const responseJson = await agent.fetchCredDefFromLedger(
            NETWORK_CONFIG.genesisFile,
            credDefId
        );
        
        const response = JSON.parse(responseJson);
        const data = response.result.data;

        // O Ledger pode retornar o objeto direto ou dentro de uma string em 'data'
        const credDefData = typeof data === 'string' ? JSON.parse(data) : data;

        if (credDefData && (credDefData.id === credDefId || credDefData.id)) {
             console.log("    ✅ CredDef Encontrada!");
             console.log(`       ID:   ${credDefData.id}`);
             console.log(`       Type: ${credDefData.type}`);
             console.log(`       Ver:  ${credDefData.ver}`);
        } else {
             console.warn("    ⚠️  CredDef retornada, mas formato inesperado:");
             console.log(JSON.stringify(credDefData));
        }

        // =====================================================================
        // 5. TESTE NEGATIVO: BUSCAR CRED DEF INEXISTENTE
        // =====================================================================
        console.log(`\n5️⃣  Testando busca de CredDef inexistente...`);
        // Criamos um ID válido mas com seqNo impossível (ex: 9999999)
        const fakeId = `${myDid}:3:CL:9999999:${tag}`;
        
        try {
            await agent.fetchCredDefFromLedger(NETWORK_CONFIG.genesisFile, fakeId);
            console.error("    ❌ ERRO: A função deveria ter falhado, mas encontrou algo!");
        } catch (e) {
            if (e.message.includes("não encontrada")) {
                console.log("    ✅ Sucesso: O Ledger retornou erro controlado.");
                console.log(`       Mensagem: ${e.message}`);
            } else {
                console.warn("    ⚠️  Erro capturado (ok), mas mensagem diferente:", e.message);
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