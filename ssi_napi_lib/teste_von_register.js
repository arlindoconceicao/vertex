function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

async function resolveWithRetry(agent, did, { tries = 10, delayMs = 500 } = {}) {
    let last = null;

    for (let i = 1; i <= tries; i++) {
        const resp = await agent.resolveDidOnLedger(did);
        last = resp;

        let j;
        try { j = JSON.parse(resp); } catch (_) { j = null; }

        if (j && j.result && j.result.data) {
            return j; // achou
        }

        console.log(`   ⏳ resolve retry ${i}/${tries}: ainda sem data, aguardando ${delayMs}ms...`);
        await sleep(delayMs);
    }

    return { __notFound: true, lastRaw: last };
}

// teste_von_register.js

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
const http = require('http');

// CONFIGURAÇÃO
const NETWORK_CONFIG = {
    genesisUrl: "http://localhost:9000/genesis",
    genesisFile: "/tmp/von_genesis.txn" // Usar /tmp para garantir permissão de escrita
};

// Dados do TRUSTEE padrão da Von-Network (Não altere se estiver usando o container padrão)
const TRUSTEE_SEED = "000000000000000000000000Trustee1";
const TRUSTEE_DID = "V4SGRU86Z58d6TV7PBUe6f";

function downloadGenesisHttp(url, dest) {
    return new Promise((resolve, reject) => {
        if (fs.existsSync(dest)) fs.unlinkSync(dest);
        const file = fs.createWriteStream(dest);
        console.log(`⏳ Baixando Genesis de: ${url}...`);
        http.get(url, (res) => {
            if (res.statusCode !== 200) { reject(new Error(`Erro HTTP: ${res.statusCode}`)); return; }
            res.pipe(file);
            file.on('finish', () => { file.close(() => { console.log("✅ Genesis baixado."); resolve(true); }); });
        }).on('error', (err) => { fs.unlink(dest, () => { }); reject(err); });
    });
}

async function main() {
    console.log(`🚀 INICIANDO TESTE: REGISTRO DE DID (Von-Network)`);

    const dbPath = "./wallet.db";
    const pass = "indicio_key_secure";
    const agent = new IndyAgent();

    try {
        // if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

        // 1. Preparar Ambiente
        await downloadGenesisHttp(NETWORK_CONFIG.genesisUrl, NETWORK_CONFIG.genesisFile);

        // 2. Wallet
        // Lógica de Persistência
        if (fs.existsSync(dbPath)) {
            console.log("\n1️⃣  Carteira encontrada no disco. Abrindo...");
        } else {
            console.log("\n1️⃣  Carteira não encontrada. Criando nova...");
            await agent.walletCreate(dbPath, pass);
        }

        await agent.walletOpen(dbPath, pass);

        // 3. Importar Trustee
        console.log("2️⃣  Importando Trustee...");
        // importDidFromSeed retorna [did, verkey]
        const [importedDid] = await agent.importDidFromSeed(TRUSTEE_SEED);
        console.log(`    Trustee: ${importedDid}`);

        if (importedDid !== TRUSTEE_DID) throw new Error("Seed gerou DID incorreto!");

        // 4. Conectar (Apenas para testar leitura depois)
        console.log("3️⃣  Conectando Pool...");
        await agent.connectNetwork(NETWORK_CONFIG.genesisFile);

        // 5. Criar Novo DID
        console.log("4️⃣  Criando Novo DID (Target)...");
        // createOwnDid retorna [did, verkey]
        const [newDid, newVerkey] = await agent.createOwnDid();
        console.log(`    Novo DID: ${newDid}`);

        // 6. Registrar no Ledger
        console.log("5️⃣  Registrando no Ledger...");
        const role = "ENDORSER"; // Pode ser null, "TRUSTEE", "STEWARD", "ENDORSER"

        const response = await agent.registerDidOnLedger(
            NETWORK_CONFIG.genesisFile, // Passamos o CAMINHO do arquivo, não a URL
            TRUSTEE_DID,                // Quem assina (Paga a taxa/tem permissão)
            newDid,                     // Quem é cadastrado
            newVerkey,                  // Chave pública do novo
            role
        );

        console.log("    ✅ Resposta do Ledger:", response);

        // 7. Verificar
        // 7. Verificar
        console.log("6️⃣  Verificando (Resolve DID) com retry...");
        const resolved = await resolveWithRetry(agent, newDid, { tries: 12, delayMs: 500 });

        if (resolved.__notFound) {
            console.error("    ❌ ERRO: DID não encontrado após retries.");
            console.error("    🔎 Última resposta bruta:", resolved.lastRaw);
        } else {
            // Indy costuma devolver data como string JSON
            const dataObj = typeof resolved.result.data === "string"
                ? JSON.parse(resolved.result.data)
                : resolved.result.data;

            console.log("    🎉 SUCESSO! Dados no Ledger:");
            console.log("       Role ID:", dataObj.role);
            console.log("       Verkey:", dataObj.verkey);
        }


    } catch (e) {
        console.error("❌ ERRO:", e);
    } finally {
        console.log("🔒 Fechando Wallet...");
        // O erro acontece porque o script termina sem fechar a conexão do banco
        if (agent) {
            await agent.walletClose();
        }
        console.log("👋 Encerrando.");
    }
}

main();