// teste_indicio_register.js
// Tenta importar do index.js ou .node
let IndyAgent;
try {
    const binding = require('./index.js');
    IndyAgent = binding.IndyAgent;
} catch (e) {
    try {
        const binding = require('./index.node');
        IndyAgent = binding.IndyAgent;
    } catch (e2) {
        console.error("❌ Não foi possível carregar a biblioteca nativa.");
        process.exit(1);
    }
}

const fs = require('fs');
const https = require('https'); // ⚠️ Indicio usa HTTPS (GitHub)

// =============================================================================
// CONFIGURAÇÃO: INDICIO TESTNET
// =============================================================================
const NETWORK_CONFIG = {
    genesisUrl: "https://raw.githubusercontent.com/Indicio-tech/indicio-network/refs/heads/main/genesis_files/pool_transactions_testnet_genesis",
    genesisFile: "./indicio_testnet.txn"
};

// DADOS DO SUBMITTER (SEU ENDORSER)
// Endorsers podem criar novos DIDs (User comum), mas não podem dar cargos.
const SUBMITTER_SEED = "+0HGyElhOr/GuwUaDsyiTn926bFMrBUh";
const SUBMITTER_DID  = "7DffLFWsgrwbt7T1Ni9cmu";

// =============================================================================
// UTILITÁRIOS
// =============================================================================
function downloadGenesisHttps(url, dest) {
    return new Promise((resolve, reject) => {
        // Se já existe, não baixa de novo para ganhar tempo nos testes
        if (fs.existsSync(dest)) {
            console.log("📂 Genesis já existe, pulando download.");
            return resolve(true);
        }

        const file = fs.createWriteStream(dest);
        console.log(`⏳ Baixando Genesis de: ${url}...`);
        
        https.get(url, (res) => {
            if (res.statusCode !== 200) { 
                reject(new Error(`Erro HTTP: ${res.statusCode}`)); 
                return; 
            }
            res.pipe(file);
            file.on('finish', () => { 
                file.close(() => { 
                    console.log("✅ Genesis baixado."); 
                    resolve(true); 
                }); 
            });
        }).on('error', (err) => { 
            fs.unlink(dest, () => {}); 
            reject(err); 
        });
    });
}

// =============================================================================
// FLUXO PRINCIPAL
// =============================================================================
async function main() {
    console.log(`🚀 INICIANDO TESTE: REGISTRO DE DID (Indicio TestNet)`);
    
    // Usamos a mesma carteira padronizada para manter persistência
    const dbPath = "./wallet.db";
    const pass = "indicio_key_secure";
    const agent = new IndyAgent();

    try {
        // 1. Baixar Genesis
        await downloadGenesisHttps(NETWORK_CONFIG.genesisUrl, NETWORK_CONFIG.genesisFile);

        // 2. Wallet (Persistência)
        if (fs.existsSync(dbPath)) {
            console.log("\n1️⃣  Carteira encontrada no disco. Abrindo...");
        } else {
            console.log("\n1️⃣  Carteira não encontrada. Criando nova...");
            await agent.walletCreate(dbPath, pass);
        }

        await agent.walletOpen(dbPath, pass);

        // 3. Importar Submitter (Endorser)
        console.log("2️⃣  Importando Submitter (Endorser)...");
        // O Rust já trata duplicidade, então é seguro chamar sempre
        const [importedDid] = await agent.importDidFromSeed(SUBMITTER_SEED);
        console.log(`    Submitter: ${importedDid}`);

        if (importedDid !== SUBMITTER_DID) {
            throw new Error(`Seed gerou DID incorreto! Esperado: ${SUBMITTER_DID}, Obtido: ${importedDid}`);
        }

        // 4. Conectar na Rede
        console.log("3️⃣  Conectando ao Pool...");
        await agent.connectNetwork(NETWORK_CONFIG.genesisFile);

        // 5. Criar um NOVO DID (Target)
        console.log("4️⃣  Criando Novo DID (Target) Localmente...");
        const [newDid, newVerkey] = await agent.createOwnDid();
        console.log(`    🆔 Novo DID:    ${newDid}`);
        console.log(`    🔑 Nova Verkey: ${newVerkey}`);

        // 6. REGISTRAR NO LEDGER
        console.log("5️⃣  Enviando Transação NYM (Registro)...");
        
        // REGRAS:
        // - Submitter é Endorser -> Pode registrar NYM.
        // - Target Role deve ser NULL (User comum), pois Endorser não cria Trustee/Steward/Endorser.
        const targetRole = null; 

        const regResult = await agent.registerDidOnLedger(
            NETWORK_CONFIG.genesisFile, 
            SUBMITTER_DID, 
            newDid, 
            newVerkey, 
            targetRole // Passando null
        );

        console.log("    📨 Transação enviada!");
        console.log("    Resposta:", regResult);

        // 7. Validar Leitura
        console.log("6️⃣  Validando Registro (Leitura)...");
        
        // Pequeno delay para garantir que o ledger processou (opcional, mas bom em testnets públicas)
        await new Promise(r => setTimeout(r, 2000));

        const readRes = await agent.resolveDidOnLedger(newDid);
        const jsonRes = JSON.parse(readRes);

        if (jsonRes.result && jsonRes.result.data) {
            const data = JSON.parse(jsonRes.result.data);
            console.log("\n🎉 SUCESSO! REGISTRO CONFIRMADO NA INDICIO!");
            console.log(`    DID: ${data.dest}`);
            // Se role for null, o campo pode não existir ou vir como null
            console.log(`    Role: ${data.role || "User (None)"}`); 
            console.log(`    Verkey: ${data.verkey}`);
        } else {
            console.error("\n❌ Falha: O DID não foi encontrado após o registro.");
            console.error("    Nota: Algumas redes exigem TAA (Transaction Author Agreement).");
            console.error("    Se falhou com 'TxnAuthorAgreementRequired', precisamos atualizar o Rust.");
        }

    } catch (e) {
        console.error("\n❌ ERRO:", e);
    } finally {
        console.log("\n🔒 Fechando Wallet...");
        if (agent) {
            await agent.walletClose();
        }
        console.log("👋 Encerrando.");
    }
}

main();