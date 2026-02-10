// teste_full_cycle.js
const fs = require('fs');
const http = require('http');
const path = require('path');

// Tenta carregar o módulo nativo compilado
let IndyAgent;
try {
    IndyAgent = require('./index.node').IndyAgent;
} catch (e) {
    console.log("⚠️ Tentando carregar de index.js (fallback)...");
    IndyAgent = require('./index.js').IndyAgent;
}

// --- CONFIGURAÇÕES ---
// URL do Ledger local (von-network)
const GENESIS_URL = "http://localhost:9000/genesis";
const GENESIS_PATH = path.resolve("/tmp/von_genesis.txn");

// Configurações da Wallet e Credenciais
const DB_PATH = "./wallet_full_cycle.db";
const DB_PASS = "senha_super_segura_123";
// Seed do Trustee (Admin) padrão do von-network
const TRUSTEE_SEED = "000000000000000000000000Trustee1";
const LINK_SECRET_ID = "default"; // OBRIGATÓRIO: O Rust busca por "default" no Lazy Load

// --- HELPER: DOWNLOAD GENESIS ---
function ensureGenesis() {
    return new Promise((resolve, reject) => {
        if (fs.existsSync(GENESIS_PATH)) {
            console.log("✅ Genesis file já existe.");
            return resolve();
        }

        console.log(`📥 Baixando Genesis de ${GENESIS_URL}...`);
        const file = fs.createWriteStream(GENESIS_PATH);
        http.get(GENESIS_URL, (response) => {
            if (response.statusCode !== 200) {
                return reject(new Error(`Falha ao baixar genesis: Status ${response.statusCode}`));
            }
            response.pipe(file);
            file.on('finish', () => {
                file.close(resolve);
                console.log("✅ Genesis baixado com sucesso.");
            });
        }).on('error', (err) => {
            fs.unlink(GENESIS_PATH, () => {});
            reject(err);
        });
    });
}

// --- HELPER: SLEEP ---
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
    console.log("==================================================");
    console.log("🚀 INICIANDO TESTE FULL CYCLE (SSI)");
    console.log("==================================================");

    const agent = new IndyAgent();

    try {
        // 0. PREPARAÇÃO DO AMBIENTE
        await ensureGenesis();

        if (fs.existsSync(DB_PATH)) {
            console.log("🧹 Removendo carteira antiga...");
            fs.rmSync(DB_PATH, { recursive: true, force: true });
        }

        console.log("💼 Criando e abrindo carteira...");
        await agent.walletCreate(DB_PATH, DB_PASS);
        await agent.walletOpen(DB_PATH, DB_PASS);

        console.log("🌐 Conectando ao Ledger...");
        await agent.connectNetwork(GENESIS_PATH);

        // =================================================================
        // FASE 1: CONFIGURAÇÃO DO EMISSOR (ISSUER)
        // =================================================================
        console.log("\n--- [FASE 1: ISSUER SETUP] ---");
        
        // Importar DID do Trustee
        const [issuerDid] = await agent.importDidFromSeed(TRUSTEE_SEED);
        console.log(`🔹 Issuer DID: ${issuerDid}`);

        // Criar Schema (Nome único para evitar colisão)
        const schemaName = "IdentitySchema";
        const schemaVersion = "1.0." + Date.now();
        const attrNames = ["nome", "idade", "cpf"];
        
        console.log(`🔹 Criando Schema (${schemaName} v${schemaVersion})...`);
        const schemaId = await agent.createAndRegisterSchema(
            GENESIS_PATH, 
            issuerDid, 
            schemaName, 
            schemaVersion, 
            attrNames
        );
        console.log(`✅ Schema ID: ${schemaId}`);

        // Criar Credential Definition
        console.log("🔹 Criando Credential Definition...");
        // Aguarda um pouco para garantir que o Ledger processou o Schema (opcional, mas bom)
        await sleep(1000); 
        const credDefId = await agent.createAndRegisterCredDef(
            GENESIS_PATH, 
            issuerDid, 
            schemaId, 
            "TAG_PROOF_V1"
        );
        console.log(`✅ CredDef ID: ${credDefId}`);

        // =================================================================
        // FASE 2: CONFIGURAÇÃO DO TITULAR (HOLDER)
        // =================================================================
        console.log("\n--- [FASE 2: HOLDER SETUP] ---");

        // Criar Link Secret (Master Secret)
        // IMPORTANTE: Usamos "default" como ID para compatibilidade com o Rust Lazy Load
        console.log("🔹 Criando Link Secret...");
        await agent.createLinkSecret(LINK_SECRET_ID);

        // Criar DID do Holder (novo DID aleatório)
        const [holderDid] = await agent.createOwnDid();
        console.log(`🔹 Holder DID: ${holderDid}`);

        // =================================================================
        // FASE 3: EMISSÃO DA CREDENCIAL
        // =================================================================
        console.log("\n--- [FASE 3: EMISSÃO] ---");

        // A. Issuer cria Oferta
        console.log("1️⃣ Issuer cria Oferta...");
        const offerJson = await agent.createCredentialOffer(credDefId, "offer-unique-123");
        
        // B. Holder cria Requisição
        console.log("2️⃣ Holder processa Oferta e cria Request...");
        // Holder precisa baixar a CredDef do Ledger para garantir que tem a chave correta
        const credDefJsonVdr = await agent.fetchCredDefFromLedger(GENESIS_PATH, credDefId);
        
        const reqJson = await agent.createCredentialRequest(
            LINK_SECRET_ID, 
            holderDid, 
            credDefJsonVdr, 
            offerJson
        );

        // C. Issuer cria Credencial
        console.log("3️⃣ Issuer assina e cria Credencial...");
        // Valores da credencial
        const credValues = JSON.stringify({
            "nome": "Yugi Muto",
            "idade": "25", // Strings numéricas são importantes para predicados (> 18)
            "cpf": "123.456.789-00"
        });

        const credJson = await agent.createCredential(credDefId, offerJson, reqJson, credValues);

        // D. Holder armazena Credencial
        console.log("4️⃣ Holder armazena Credencial...");
        const credIdInWallet = "cred-id-local-1";
        
        // IMPORTANTE: O ID do metadata gerado internamente pelo Rust no passo B
        // geralmente é o nonce da oferta. Vamos extrair:
        const offerObj = JSON.parse(offerJson);
        const reqMetaId = offerObj.nonce;

        await agent.storeCredential(
            credIdInWallet, 
            credJson, 
            reqMetaId, 
            credDefJsonVdr, 
            null // Revocation Registry Definition (null)
        );
        console.log("✅ Credencial Armazenada com Sucesso!");

        // =================================================================
        // FASE 4: SOLICITAÇÃO DE PROVA (VERIFIER)
        // =================================================================
        console.log("\n--- [FASE 4: PEDIDO DE PROVA (VERIFIER)] ---");

        const proofRequestNonce = "9876543210";
        const presentationRequest = {
            "nonce": proofRequestNonce,
            "name": "Prova de Maioridade",
            "version": "1.0",
            "requested_attributes": {
                "referente_nome": {
                    "name": "nome",
                    "restrictions": [{ "cred_def_id": credDefId }]
                }
            },
            "requested_predicates": {
                "referente_idade_maior_18": {
                    "name": "idade",
                    "p_type": ">=",
                    "p_value": 18,
                    "restrictions": [{ "cred_def_id": credDefId }]
                }
            }
        };
        const presReqJson = JSON.stringify(presentationRequest);
        console.log("👮 Pedido: Provar 'nome' E provar que 'idade >= 18' (sem revelar a idade exata).");

        // =================================================================
        // FASE 5: GERAÇÃO DA PROVA (HOLDER)
        // =================================================================
        console.log("\n--- [FASE 5: GERAR PROVA (HOLDER)] ---");

        // Preparar Schemas e CredDefs auxiliares para a matemática do ZKP
        console.log("🔹 Baixando dados atualizados do Ledger...");
        const schemaJsonLedger = await agent.fetchSchemaFromLedger(GENESIS_PATH, schemaId);
        
        const schemasMap = JSON.stringify({ 
            [schemaId]: JSON.parse(schemaJsonLedger) 
        });
        const credDefsMap = JSON.stringify({ 
            [credDefId]: JSON.parse(credDefJsonVdr) 
        });

        // Mapear quais credenciais satisfazem o pedido
        const requestedCredentials = {
            "self_attested_attributes": {},
            "requested_attributes": {
                "referente_nome": {
                    "cred_id": credIdInWallet,
                    "revealed": true // Mostra o valor "Yugi Muto"
                }
            },
            "requested_predicates": {
                "referente_idade_maior_18": {
                    "cred_id": credIdInWallet,
                    // Predicados ZKP são sempre revealed=true no sentido matemático (a prova é revelada),
                    // mas o valor (25) permanece oculto.
                }
            }
        };

        console.log("🔹 Calculando Prova Zero-Knowledge...");
        
        const presentationJson = await agent.createPresentation(
            presReqJson,
            JSON.stringify(requestedCredentials),
            schemasMap,
            credDefsMap
        );
        console.log(`✅ Prova calculada! Tamanho: ${presentationJson.length} bytes`);

        // =================================================================
        // FASE 6: VALIDAÇÃO (VERIFIER)
        // =================================================================
        console.log("\n--- [FASE 6: VALIDAÇÃO (VERIFIER)] ---");

        console.log("🔹 Verificando criptografia da prova...");
        const isValid = await agent.verifyPresentation(
            presReqJson,
            presentationJson,
            schemasMap,
            credDefsMap
        );

        console.log("\n--------------------------------------------------");
        if (isValid) {
            console.log("🟢 RESULTADO: SUCESSO! A PROVA É VÁLIDA.");
            console.log("   - O nome foi revelado: 'Yugi Muto'");
            console.log("   - A idade NÃO foi revelada, mas provou-se ser >= 18.");
        } else {
            console.log("🔴 RESULTADO: FALHA! A PROVA É INVÁLIDA.");
        }
        console.log("--------------------------------------------------");

    } catch (e) {
        console.error("\n❌ ERRO DURANTE O TESTE:");
        console.error(e);
        if (e.message && e.message.includes("Metadata")) {
            console.log("\n💡 DICA DE DEBUG: Verifique se o ID passado em 'storeCredential' (reqMetaId) corresponde ao nonce da oferta.");
        }
    } finally {
        console.log("\nFechando conexões...");
        try {
            await agent.walletClose();
            console.log("Wallet fechada.");
        } catch (e) {
            console.log("Erro ao fechar wallet (pode já estar fechada).");
        }
    }
}

main();