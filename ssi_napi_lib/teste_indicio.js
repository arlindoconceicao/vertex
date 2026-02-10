// teste_indicio.js
// Tenta importar do index.js (padrão NAPI) ou direto do .node se necessário
let IndyAgent;
try {
    const binding = require('./index.js');
    IndyAgent = binding.IndyAgent;
} catch (e) {
    // Fallback caso esteja importando direto o binário
    const binding = require('./index.node');
    IndyAgent = binding.IndyAgent;
}

const fs = require('fs');
const https = require('https');

// =============================================================================
// CONFIGURAÇÃO
// =============================================================================

// O DID "7Dff..." é nativo da Indicio TestNet. Se usar DemoNet, ele não será achado.
const USE_TESTNET = true;

const NET_CONFIG = USE_TESTNET ? {
    name: "Indicio TestNet",
    url: "https://raw.githubusercontent.com/Indicio-tech/indicio-network/main/genesis_files/pool_transactions_testnet_genesis",
    file: "./indicio_testnet.txn"
} : {
    name: "Indicio DemoNet",
    url: "https://raw.githubusercontent.com/Indicio-tech/indicio-network/main/genesis_files/pool_transactions_demonet_genesis",
    file: "./indicio_demonet.txn"
};

// =============================================================================
// UTILITÁRIOS
// =============================================================================

function downloadGenesisHttps(url, dest) {
    return new Promise((resolve, reject) => {
        if (fs.existsSync(dest)) {
            console.log("📂 Arquivo Genesis já existe, pulando download.");
            return resolve(true);
        }

        const file = fs.createWriteStream(dest);
        console.log(`⏳ Baixando Genesis de: ${NET_CONFIG.name}...`);
        https.get(url, (res) => {
            if (res.statusCode !== 200) {
                reject(new Error(`Status do Download: ${res.statusCode}`));
                return;
            }
            res.pipe(file);
            file.on('finish', () => {
                file.close(() => {
                    console.log("✅ Download Concluído!");
                    resolve(true);
                });
            });
        }).on('error', (err) => {
            fs.unlink(dest, () => { });
            reject(err);
        });
    });
}

// =============================================================================
// EXECUÇÃO PRINCIPAL
// =============================================================================

async function main() {
    console.log(`🚀 INICIANDO TESTE: ${NET_CONFIG.name}`);
    console.log("==================================================");

    // DADOS DO ENDORSER DA INDICIO
    const submitterSeed = "+0HGyElhOr/GuwUaDsyiTn926bFMrBUh";
    const expectedDid = "7DffLFWsgrwbt7T1Ni9cmu";

    // SETUP ARQUIVOS
    const dbPath = "./wallet.db";
    const pass = "indicio_key_secure";

    // Limpeza de testes anteriores
    // if (fs.existsSync(dbPath)) {
    //     try { fs.unlinkSync(dbPath); } catch (e) { }
    // }

    // Instancia o Agente Rust
    const agent = new IndyAgent();

    try {
        // 1. Download do Genesis
        await downloadGenesisHttps(NET_CONFIG.url, NET_CONFIG.file);

        // 2. Lógica de Setup da Wallet (Verifica se existe antes de criar)
        if (fs.existsSync(dbPath)) {
            console.log("\n1️⃣  Carteira encontrada no disco. Abrindo...");
            // Se já existe, não chamamos walletCreate, pulamos direto para o open
        } else {
            console.log("\n1️⃣  Carteira não encontrada. Criando nova...");
            await agent.walletCreate(dbPath, pass);
        }

        // Independente de ter criado agora ou já existir, precisamos carregar na memória
        await agent.walletOpen(dbPath, pass);

        // 3. Importar DID (Cálculo Legacy)
        console.log(`\n2️⃣  Importando DID via Seed...`);

        // AGORA ESTA CHAMADA É SEGURA
        // Se o DID já existir, o Rust retorna os dados sem erro.
        // Se não existir, ele cria.
        const resultTuple = await agent.importDidFromSeed(submitterSeed);

        const myDid = resultTuple[0];
        const myVerkey = resultTuple[1];

        console.log(`    -> DID Ativo: ${myDid}`);

        // Validação
        if (myDid !== expectedDid) {
            throw new Error(`DID incorreto! Esperado: ${expectedDid}, Recebido: ${myDid}`);
        }

        // 4. Conectar na Rede
        console.log(`\n3️⃣  Conectando ao Pool (${NET_CONFIG.name})...`);
        await agent.connectNetwork(NET_CONFIG.file);
        console.log("    ✅ Conexão estabelecida!");

        // 5. Consultar no Ledger
        console.log(`\n4️⃣  Consultando DID no Ledger...`);
        const res = await agent.resolveDidOnLedger(myDid);

        console.log("    Resposta Crua:", res);

        const jsonRes = JSON.parse(res);

        // Verificação Lógica da Resposta
        // O formato padrão do Indy VDR para GET_NYM é: { op: "REPLY", result: { ... data: "JSON_STRING" ... } }
        if (jsonRes.op === "REPLY" && jsonRes.result && jsonRes.result.data) {
            const innerData = JSON.parse(jsonRes.result.data);
            console.log("\n🎉 SUCESSO! O DID EXISTE NA REDE!");
            console.log("----------------------------------------");
            console.log(`🆔 DID:    ${innerData.dest}`);
            console.log(`🎭 Role:   ${innerData.role === "0" ? "TRUSTEE" : (innerData.role === "101" ? "ENDORSER" : "USER/NONE")}`);
            console.log(`🔑 Verkey: ${innerData.verkey}`);
            console.log("----------------------------------------");
        } else {
            console.log("\n⚠️  O Ledger respondeu, mas não encontrou dados para este DID.");
            console.log("    Possíveis causas:");
            console.log("    1. Você está na rede errada (DemoNet vs TestNet).");
            console.log("    2. O DID nunca foi escrito no ledger.");
        }

    } catch (e) {
        console.error("\n❌ ERRO FATAL DURANTE O TESTE:");
        console.error(e);
    } finally {
        // 6. Fechamento Gracioso (Evita o erro do Tokio Panic)
        console.log("\n🔚 Encerrando...");
        try {
            await agent.walletClose();
            console.log("    Carteira fechada.");
        } catch (e) {
            console.log("    (Carteira já estava fechada ou erro ao fechar)");
        }
    }
}

main();