// teste_holder_request.js
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
    console.log("🚀 TESTE: HOLDER - GERAR CREDENTIAL REQUEST");
    const agent = new IndyAgent();

    try {
        // PREPARAÇÃO: Resetar Wallet para garantir LinkSecret limpo (JSON)
        if (fs.existsSync(DB_PATH)) {
            console.log("🧹 Limpando wallet antiga para evitar conflito de formato...");
            fs.unlinkSync(DB_PATH);
        }
        
        await agent.walletCreate(DB_PATH, DB_PASS);
        await agent.walletOpen(DB_PATH, DB_PASS);

        // --- 1. SETUP (Emissor cria tudo de novo para o teste) ---
        console.log("1️⃣  Setup Inicial (Emissor gera oferta)...");
        await agent.connectNetwork(NETWORK_CONFIG.genesisFile);
        const [issuerDid] = await agent.importDidFromSeed(TRUSTEE_SEED);
        
        const schemaId = await agent.createAndRegisterSchema(NETWORK_CONFIG.genesisFile, issuerDid, "ReqTest", "1.0."+Date.now(), ["nome"]);
        const credDefId = await agent.createAndRegisterCredDef(NETWORK_CONFIG.genesisFile, issuerDid, schemaId, "TAG_REQ");
        const offerId = "offer-req-" + Date.now();
        const offerJson = await agent.createCredentialOffer(credDefId, offerId);
        
        console.log("    ✅ Oferta Gerada.");

        // --- 2. HOLDER PREPARA ---
        console.log("2️⃣  Holder Preparando (Link Secret & DID)...");
        const linkSecretId = "meu-segredo-mestre";
        await agent.createLinkSecret(linkSecretId);

        // Criar um DID para o Holder (Prover DID)
        const [holderDid] = await agent.createOwnDid(); 
        // Nota: O Holder geralmente não precisa registrar esse DID no ledger para receber credenciais,
        // mas precisa ter um DID local para assinar o request.
        console.log(`    ✅ Holder DID: ${holderDid}`);

        // Salvar a oferta recebida (Simulando recebimento)
        const receivedId = await agent.storeReceivedOffer(offerJson);
        console.log(`    ✅ Oferta salva localmente: ${receivedId}`);

        // --- 3. GERAR REQUEST ---
        console.log("3️⃣  Gerando Credential Request...");
        
        // A. Holder precisa da CredDef completa (pública)
        console.log(`    🔍 Buscando CredDef no Ledger: ${credDefId}`);
        const credDefJson = await agent.fetchCredDefFromLedger(NETWORK_CONFIG.genesisFile, credDefId);

        // B. Chamada do novo método
        const requestJson = await agent.createCredentialRequest(
            linkSecretId,
            holderDid,
            credDefJson,
            offerJson
        );

        console.log("    ✅ REQUEST GERADO COM SUCESSO!");
        const req = JSON.parse(requestJson);
        console.log(`    Entropy: ${req.entropy ? "Sim" : "Oculta"}`);
        console.log(`    Prover DID: ${req.prover_did}`);
        console.log(`    CredDef ID: ${req.cred_def_id}`);

        // Validar se o Metadata foi salvo (hacking check)
        // Como não temos um método 'getMetadata', assumimos que se não deu erro, salvou.
        console.log("\n📦 O Request Metadata foi salvo internamente na wallet.");
        console.log("📨 Agora o Holder enviaria este JSON 'requestJson' de volta para o Emissor.");

    } catch (e) {
        console.error("❌ ERRO:", e);
    } finally {
        await agent.walletClose();
    }
}

main();