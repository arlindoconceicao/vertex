// teste_rede.js
const { IndyAgent } = require('./index.node');
const fs = require('fs');
const http = require('http');

// Função auxiliar para baixar o arquivo Genesis
function downloadGenesis(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        console.log(`⏳ Baixando Genesis de: ${url}...`);
        
        http.get(url, (response) => {
            if (response.statusCode !== 200) {
                reject(new Error(`Falha ao baixar: Status Code ${response.statusCode}`));
                return;
            }
            response.pipe(file);
            file.on('finish', () => {
                file.close(() => {
                    console.log("✅ Download concluído!");
                    resolve(true);
                });
            });
        }).on('error', (err) => {
            fs.unlink(dest, () => {}); // Apaga arquivo corrompido
            reject(err);
        });
    });
}

async function main() {
    console.log("🚀 Teste de Conexão com Ledger (Von-Network)...");
    
    // URL Padrão da Von-Network local
    const genesisUrl = "http://localhost:9000/genesis";
    const genesisFilePath = "./genesis.txn"; // Onde vamos salvar no disco

    try {
        // 1. Verifica se precisamos baixar o arquivo
        if (!fs.existsSync(genesisFilePath)) {
            await downloadGenesis(genesisUrl, genesisFilePath);
        } else {
            console.log("📂 Arquivo genesis.txn já existe no disco.");
        }

        const agent = new IndyAgent();

        // 2. Conectando à rede (Agora passando o CAMINHO DO ARQUIVO)
        console.log("1. Conectando ao Pool Indy...");
        await agent.connectNetwork(genesisFilePath);
        console.log("   ✅ Conectado com sucesso!");

        // 3. Teste de Leitura (Resolve DID)
        // DID do Trustee padrão da Von-Network
        const targetDid = "V4SGRU86Z58d6TV7PBUe6f"; 
        
        console.log(`2. Buscando DID ${targetDid} no Ledger...`);
        const res = await agent.resolveDidOnLedger(targetDid);
        
        console.log("   ✅ Resposta do Ledger (NYM):");
        const jsonRes = JSON.parse(res);
        console.log(JSON.stringify(jsonRes, null, 2));

    } catch (e) {
        console.error("❌ Erro:", e);
        if (e.message && e.message.includes("ECONNREFUSED")) {
            console.log("\nDICA: Verifique se a von-network está rodando (./manage start)!");
        }
    }
}

main();