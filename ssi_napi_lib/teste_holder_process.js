// teste_holder_process.js
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
    console.log("🚀 TESTE: HOLDER - PROCESSAR OFERTA");
    const agent = new IndyAgent();

    try {
        if (!fs.existsSync(DB_PATH)) await agent.walletCreate(DB_PATH, DB_PASS);
        await agent.walletOpen(DB_PATH, DB_PASS);

        // --- PARTE A: ISSUER GERA A OFERTA (Simulação) ---
        console.log("\n--- [LADO DO EMISSOR] ---");
        await agent.connectNetwork(NETWORK_CONFIG.genesisFile);
        const [issuerDid] = await agent.importDidFromSeed(TRUSTEE_SEED);
        
        // Vamos reusar artefatos se existirem ou criar novos
        const schemaId = await agent.createAndRegisterSchema(NETWORK_CONFIG.genesisFile, issuerDid, "HolderTest", "1.0."+Date.now(), ["email"]);
        const credDefId = await agent.createAndRegisterCredDef(NETWORK_CONFIG.genesisFile, issuerDid, schemaId, "TAG_HOLDER");
        
        const offerId = "offer-for-holder-" + Date.now();
        const offerJsonString = await agent.createCredentialOffer(credDefId, offerId);
        
        console.log(`📨 Emissor gerou a oferta (JSON de ${offerJsonString.length} bytes)`);

        // --- AQUI ACONTECE O ENVIO PELA REDE (HTTP/QR CODE) ---
        // Vamos simular que o Holder recebeu essa string:
        const incomingOffer = offerJsonString;

        // --- PARTE B: HOLDER PROCESSA ---
        console.log("\n--- [LADO DO HOLDER] ---");
        
        // 1. Criar Link Secret (Obrigatório, fazemos apenas uma vez)
        console.log("1️⃣  Criando/Verificando Link Secret...");
        const linkSecretId = "link-secret-principal";
        await agent.createLinkSecret(linkSecretId);
        console.log(`    ✅ Link Secret '${linkSecretId}' configurado na wallet.`);

        // 2. Processar (Salvar) a Oferta Recebida
        console.log("2️⃣  Processando (Salvando) Oferta Recebida...");
        
        const localRecordId = await agent.storeReceivedOffer(incomingOffer);
        
        console.log(`    ✅ Oferta salva com sucesso!`);
        console.log(`    🆔 ID do Registro Local: ${localRecordId}`);
        
        // Validação: Poderíamos criar um listReceivedOffers, mas vamos confiar no retorno por enquanto
        console.log("\n🎉 O Holder está pronto para gerar o Credential Request no próximo passo.");

    } catch (e) {
        console.error("❌ ERRO:", e);
    } finally {
        await agent.walletClose();
    }
}

main();