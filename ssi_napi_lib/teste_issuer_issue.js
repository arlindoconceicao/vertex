// teste_issuer_issue.js
const fs = require('fs');

// Carrega Lib
let IndyAgent;
try { IndyAgent = require('./index.node').IndyAgent; } 
catch (e) { IndyAgent = require('./index.js').IndyAgent; }

const NETWORK_CONFIG = { genesisFile: "/tmp/von_genesis.txn", genesisUrl: "http://localhost:9000/genesis" };
const DB_PATH = "./wallet.db";
const DB_PASS = "indicio_key_secure";
const TRUSTEE_SEED = "000000000000000000000000Trustee1";

async function main() {
    console.log("🚀 TESTE: ISSUER - EMITIR CREDENCIAL FINAL");
    const agent = new IndyAgent();

    try {
        // Reset para garantir limpeza
        if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
        await agent.walletCreate(DB_PATH, DB_PASS);
        await agent.walletOpen(DB_PATH, DB_PASS);

        // --- 1. SETUP ISSUER ---
        console.log("1️⃣  Issuer Setup...");
        await agent.connectNetwork(NETWORK_CONFIG.genesisFile);
        const [issuerDid] = await agent.importDidFromSeed(TRUSTEE_SEED);
        
        const schemaId = await agent.createAndRegisterSchema(NETWORK_CONFIG.genesisFile, issuerDid, "FinalCred", "1.0."+Date.now(), ["nome", "cpf", "status"]);
        const credDefId = await agent.createAndRegisterCredDef(NETWORK_CONFIG.genesisFile, issuerDid, schemaId, "TAG_FINAL");
        
        // --- 2. SETUP HOLDER & REQUEST ---
        console.log("2️⃣  Holder Request...");
        const offerId = "offer-final-" + Date.now();
        const offerJson = await agent.createCredentialOffer(credDefId, offerId);
        
        await agent.createLinkSecret("segredo-final");
        const [holderDid] = await agent.createOwnDid();
        
        // Simula busca do ledger (transformada)
        const credDefJson = await agent.fetchCredDefFromLedger(NETWORK_CONFIG.genesisFile, credDefId);
        
        const requestJson = await agent.createCredentialRequest(
            "segredo-final",
            holderDid,
            credDefJson,
            offerJson
        );

        // --- 3. AÇÃO DO ISSUER: EMITIR ---
        console.log("3️⃣  Issuer Emitindo Credencial...");
        
        // Dados REAIS que vamos colocar na credencial
        const valores = JSON.stringify({
            "nome": "João da Silva",
            "cpf": "123.456.789-00",
            "status": "Ativo"
        });

        const credentialJson = await agent.createCredential(
            credDefId,    // Issuer usa isso para achar sua chave privada
            offerJson,    // Para validar o nonce
            requestJson,  // O pedido do Holder
            valores       // Os dados
        );

        console.log("\n✅ CREDENCIAL EMITIDA COM SUCESSO!");
        console.log("📦 Tamanho do JSON:", credentialJson.length, "bytes");
        
        const cred = JSON.parse(credentialJson);
        console.log("🔑 Schema ID na Credencial:", cred.schema_id);
        console.log("🔑 Values:", Object.keys(cred.values)); // Deve listar os campos

        // Validação extra
        if (credentialJson.includes("João da Silva")) {
             console.error("⚠️ ALERTA: O nome 'João da Silva' apareceu em texto plano?");
             console.log("   (Isso é normal no JSON da credencial entregue ao Holder, mas na prova ZKP ele será ocultado)");
        }

        console.log("\n📨 Próximo passo: O Holder receberia este JSON e salvaria na wallet.");

    } catch (e) {
        console.error("❌ ERRO:", e);
    } finally {
        await agent.walletClose();
    }
}

main();