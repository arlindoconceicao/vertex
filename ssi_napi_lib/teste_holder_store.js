// teste_holder_store.js
const fs = require('fs');
const http = require('http');

// Carrega Lib
let IndyAgent;
try { IndyAgent = require('./index.node').IndyAgent; } 
catch (e) { IndyAgent = require('./index.js').IndyAgent; }

const GENESIS_PATH = "/tmp/von_genesis.txn";
const GENESIS_URL = "http://localhost:9000/genesis";
const DB_PATH = "./wallet.db";
const DB_PASS = "indicio_key_secure";
const TRUSTEE_SEED = "000000000000000000000000Trustee1";

// --- FUNÇÃO AUXILIAR: BAIXAR GENESIS ---
function ensureGenesisFile() {
    return new Promise((resolve, reject) => {
        if (fs.existsSync(GENESIS_PATH)) {
            console.log("📄 Arquivo Genesis já existe.");
            return resolve();
        }

        console.log("⬇️  Baixando Genesis de", GENESIS_URL, "...");
        const file = fs.createWriteStream(GENESIS_PATH);
        http.get(GENESIS_URL, function(response) {
            if (response.statusCode !== 200) {
                return reject(`Falha ao baixar genesis: Status ${response.statusCode}`);
            }
            response.pipe(file);
            file.on('finish', () => {
                file.close(() => {
                    console.log("✅ Genesis baixado com sucesso.");
                    resolve();
                });
            });
        }).on('error', (err) => {
            fs.unlink(GENESIS_PATH, () => {}); // Apaga arquivo corrompido
            reject(err.message);
        });
    });
}

async function main() {
    console.log("🚀 TESTE: HOLDER - ARMAZENAR CREDENCIAL");
    
    try {
        // Garante o arquivo antes de começar
        await ensureGenesisFile();

        const agent = new IndyAgent();

        // Limpeza inicial
        if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
        await agent.walletCreate(DB_PATH, DB_PASS);
        await agent.walletOpen(DB_PATH, DB_PASS);

        // --- FASE 1: PREPARAÇÃO (ISSUER & NETWORK) ---
        console.log("1️⃣  Setup e Oferta (Issuer)...");
        await agent.connectNetwork(GENESIS_PATH);
        const [issuerDid] = await agent.importDidFromSeed(TRUSTEE_SEED);
        
        const schemaId = await agent.createAndRegisterSchema(GENESIS_PATH, issuerDid, "FinalCred", "1.0."+Date.now(), ["nome"]);
        const credDefId = await agent.createAndRegisterCredDef(GENESIS_PATH, issuerDid, schemaId, "TAG_STORE");
        
        const offerId = "offer-" + Date.now();
        const offerJson = await agent.createCredentialOffer(credDefId, offerId);

        // --- FASE 2: HOLDER GERA REQUEST ---
        console.log("2️⃣  Holder Request...");
        // Agora isso salva na MEMÓRIA do Rust
        await agent.createLinkSecret("segredo-final");
        const [holderDid] = await agent.createOwnDid();
        
        const credDefJson = await agent.fetchCredDefFromLedger(GENESIS_PATH, credDefId);
        
        // Usa o segredo da memória
        const requestJson = await agent.createCredentialRequest(
            "segredo-final",
            holderDid,
            credDefJson,
            offerJson
        );
        
        const offerObj = JSON.parse(offerJson);
        // const requestMetadataId = "req-meta-" + offerObj.nonce;

        // O Rust salvou usando apenas o nonce como chave
        const requestMetadataId = offerObj.nonce;

        // --- FASE 3: ISSUER EMITE CREDENCIAL ---
        console.log("3️⃣  Issuer Emite Credencial...");
        const valores = JSON.stringify({ "nome": "Yugi Muto" });
        const credentialJson = await agent.createCredential(
            credDefId, 
            offerJson, 
            requestJson, 
            valores
        );

        // --- FASE 4: HOLDER ARMAZENA ---
        console.log("4️⃣  Holder Armazena (Store)...");
        const myCredId = "minha-credencial-01";
        
        // Usa o segredo da memória para validar q == q'
        const storedId = await agent.storeCredential(
            myCredId,
            credentialJson,
            requestMetadataId,
            credDefJson,
            null
        );

        console.log(`    ✅ SUCESSO! Credencial armazenada com ID: ${storedId}`);
        console.log("\n🎉 Ciclo Completo de Emissão Finalizado!");
        await agent.walletClose();

    } catch (e) {
        console.error("❌ ERRO:", e);
    }
}

main();