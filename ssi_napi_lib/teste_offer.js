// teste_offer.js
const fs = require('fs');
const http = require('http');

// Carrega Lib
let IndyAgent;
try { IndyAgent = require('./index.node').IndyAgent; } 
catch (e) { IndyAgent = require('./index.js').IndyAgent; }

const NETWORK_CONFIG = {
    genesisFile: "/tmp/von_genesis.txn",
    genesisUrl: "http://localhost:9000/genesis"
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

// Dados Fixos para teste
const TRUSTEE_SEED = "000000000000000000000000Trustee1";
const DB_PATH = "./wallet.db";
const DB_PASS = "indicio_key_secure";

async function main() {
    console.log("🚀 TESTE: CRIAR CREDENTIAL OFFER (COM PERSISTÊNCIA)");
    const agent = new IndyAgent();

    try {

        await downloadGenesisHttp(NETWORK_CONFIG.genesisUrl, NETWORK_CONFIG.genesisFile);

        // =====================================================================
        // CORREÇÃO: Lógica de Persistência
        // Não deletamos mais a wallet. Se ela existe, usamos ela.
        // =====================================================================
        if (fs.existsSync(DB_PATH)) {
            console.log("📂 Carteira 'wallet.db' encontrada. Abrindo...");
            // Não chamamos walletCreate, pois já existe
        } else {
            console.log("🆕 Carteira não encontrada. Criando nova...");
            await agent.walletCreate(DB_PATH, DB_PASS);
        }
        
        // Abre a carteira (seja nova ou existente)
        await agent.walletOpen(DB_PATH, DB_PASS);

        // 1. Setup Básico (Conectar e Importar Issuer)
        console.log("1️⃣  Setup Issuer...");
        await agent.connectNetwork(NETWORK_CONFIG.genesisFile);
        
        // O importDidFromSeed é idempotente na nossa lib (se já existe, não duplica)
        const [issuerDid] = await agent.importDidFromSeed(TRUSTEE_SEED);

        // 2. Criar Schema
        // Usamos Date.now() para garantir que sempre crie um schema novo e único
        // para este teste, acumulando registros no Ledger e na Wallet.
        console.log("2️⃣  Criando Schema...");
        const schemaId = await agent.createAndRegisterSchema(
            NETWORK_CONFIG.genesisFile,
            issuerDid,
            "OfertaTeste",
            "1.0." + Date.now(), 
            ["nome", "email"]
        );
        console.log(`    Schema ID: ${schemaId}`);

        // 3. Criar Cred Def
        console.log("3️⃣  Criando Credential Definition...");
        const credDefId = await agent.createAndRegisterCredDef(
            NETWORK_CONFIG.genesisFile,
            issuerDid,
            schemaId,
            "TAG_OFFER"
        );
        console.log(`    CredDef ID: ${credDefId}`);

        // 4. TESTAR O NOVO MÉTODO COM PERSISTÊNCIA
        console.log("4️⃣  Gerando e Salvando Credential Offer...");

        // Gera um ID único para esta oferta
        const myOfferId = "offer-" + Date.now();

        // Passamos o credDefId E o novo ID
        const offerJson = await agent.createCredentialOffer(credDefId, myOfferId);

        console.log(`✅ OFERTA GERADA E SALVA! ID: ${myOfferId}`);

        const offer = JSON.parse(offerJson);
        console.log("    Schema ID na oferta:", offer.schema_id);
        console.log("    CredDef ID na oferta:", offer.cred_def_id);
        console.log("    KeyProof presente?", !!offer.key_correctness_proof ? "Sim" : "Não");

    } catch (e) {
        console.error("❌ ERRO:", e);
    } finally {
        await agent.walletClose();
        console.log("🔒 Wallet fechada.");
    }
}

main();