// teste_von_schema.js
// Tenta importar a lib
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
const http = require('http'); // Von-Network local usa HTTP

// =============================================================================
// CONFIGURAÇÃO: VON-NETWORK (LOCAL)
// =============================================================================
const NETWORK_CONFIG = {
    name: "Von-Network Local",
    genesisUrl: "http://localhost:9000/genesis",
    genesisFile: "./von_genesis.txn",
    // Trustee padrão da Von-Network (tem permissão para criar Schemas)
    trusteeSeed: "000000000000000000000000Trustee1",
    trusteeDid:  "V4SGRU86Z58d6TV7PBUe6f"
};

// =============================================================================
// UTILITÁRIOS
// =============================================================================
function downloadGenesisHttp(url, dest) {
    return new Promise((resolve, reject) => {
        // Se já existe, pula (para agilizar testes repetitivos)
        if (fs.existsSync(dest)) {
            console.log("📂 Genesis já existe, pulando download.");
            return resolve(true);
        }

        const file = fs.createWriteStream(dest);
        console.log(`⏳ Baixando Genesis de: ${url}...`);
        
        http.get(url, (res) => {
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
    console.log(`🚀 INICIANDO TESTE: SCHEMA NA VON-NETWORK`);
    
    // Usamos o mesmo DB 'wallet.db' para manter a consistência com os outros testes
    const dbPath = "./wallet.db";
    const pass = "indicio_key_secure";
    const agent = new IndyAgent();

    try {
        // 1. Baixar Genesis
        await downloadGenesisHttp(NETWORK_CONFIG.genesisUrl, NETWORK_CONFIG.genesisFile);

        // 2. Wallet (Lógica de Persistência)
        if (fs.existsSync(dbPath)) {
            console.log("1️⃣  Carteira encontrada. Abrindo...");
        } else {
            console.log("1️⃣  Carteira não encontrada. Criando nova...");
            await agent.walletCreate(dbPath, pass);
        }
        await agent.walletOpen(dbPath, pass);

        // 3. Conectar na Rede
        console.log("2️⃣  Conectando ao Pool...");
        await agent.connectNetwork(NETWORK_CONFIG.genesisFile);

        // 4. Garantir Identidade (Trustee)
        // Precisamos de alguém com permissão de escrita. O Trustee1 é o ideal na Von.
        console.log("3️⃣  Verificando Identidade (Trustee)...");
        
        // Se já foi importado antes, o Rust retorna os dados sem erro (Idempotência)
        const [myDid, myVerkey] = await agent.importDidFromSeed(NETWORK_CONFIG.trusteeSeed);
        console.log(`    Issuer DID: ${myDid}`);

        if (myDid !== NETWORK_CONFIG.trusteeDid) {
            throw new Error(`DID incorreto! Esperado: ${NETWORK_CONFIG.trusteeDid}, Obtido: ${myDid}`);
        }

        // 5. Definir Schema
        // IMPORTANTE: Nome + Versão deve ser único. Usamos timestamp na versão.
        const name = "CrachaCorporativo";
        const version = `1.${Math.floor(Date.now() / 1000)}`; 
        const attrs = ["nome", "email", "departamento", "nivel_acesso"];

        console.log(`\n4️⃣  Registrando Schema: ${name} v${version}...`);
        console.log(`    Atributos: [${attrs.join(", ")}]`);
        
        // Chamada Rust
        // O código Rust tentará buscar TAA. Na Von-Network, receberá null e prosseguirá sem TAA.
        const schemaId = await agent.createAndRegisterSchema(
            NETWORK_CONFIG.genesisFile,
            myDid,      // Issuer (Trustee)
            name,       // Nome
            version,    // Versão
            attrs       // Atributos
        );

        console.log("\n✅ SUCESSO! Schema Registrado na Von-Network.");
        console.log("--------------------------------------------------");
        console.log(`🆔 Schema ID: ${schemaId}`);
        console.log("--------------------------------------------------");
        console.log("💡 O Ledger local não exige TAA, então o fluxo seguiu direto.");

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