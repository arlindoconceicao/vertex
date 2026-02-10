// teste_delete_offer.js
const fs = require('fs');

// Carrega Lib
let IndyAgent;
try { IndyAgent = require('./index.node').IndyAgent; } 
catch (e) { IndyAgent = require('./index.js').IndyAgent; }

const DB_PATH = "./wallet.db";
const DB_PASS = "indicio_key_secure";

async function main() {
    console.log("🚀 TESTE: DELETAR OFERTA DE CREDENCIAL");
    const agent = new IndyAgent();

    try {
        if (!fs.existsSync(DB_PATH)) {
            console.error("❌ 'wallet.db' não encontrada. Crie ofertas primeiro.");
            return;
        }

        // 1. Abrir Wallet
        console.log("1️⃣  Abrindo Carteira...");
        await agent.walletOpen(DB_PATH, DB_PASS);

        // 2. Listar Ofertas (Antes)
        console.log("2️⃣  Buscando ofertas existentes...");
        let offersJson = await agent.listCredentialOffers();
        let offers = JSON.parse(offersJson);

        if (offers.length === 0) {
            console.warn("⚠️ Nenhuma oferta encontrada para deletar! Rode 'teste_offer.js' algumas vezes.");
            return;
        }

        console.log(`   📦 Total atual: ${offers.length}`);

        // 3. Selecionar o Alvo (O primeiro da lista)
        const target = offers[0];
        const targetId = target.id_local;
        
        console.log("=".repeat(60));
        console.log(`🎯 ALVO SELECIONADO: ${targetId}`);
        console.log(`   Criado em: ${target.created_at}`);
        console.log("=".repeat(60));

        // 4. Executar Deleção
        console.log(`3️⃣  Deletando oferta ${targetId}...`);
        const success = await agent.deleteCredentialOffer(targetId);

        if (success) {
            console.log("✅ Sucesso! O método retornou true.");
        } else {
            console.error("❌ Falha: O método retornou false.");
        }

        // 5. Verificar (Listar novamente)
        console.log("4️⃣  Verificando exclusão...");
        offersJson = await agent.listCredentialOffers();
        offers = JSON.parse(offersJson);

        // Busca se o ID ainda existe na lista
        const stillExists = offers.find(o => o.id_local === targetId);

        if (!stillExists) {
            console.log(`🎉 CONFIRMADO: A oferta ${targetId} não existe mais na carteira.`);
            console.log(`   📦 Total restante: ${offers.length}`);
        } else {
            console.error(`❌ ERRO: A oferta ${targetId} AINDA ESTÁ NA CARTEIRA!`);
        }

    } catch (e) {
        console.error("❌ ERRO:", e);
    } finally {
        await agent.walletClose();
        console.log("🔒 Wallet fechada.");
    }
}

main();