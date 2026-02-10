// teste_list_offers.js
const fs = require('fs');

// Carrega Lib
let IndyAgent;
try { IndyAgent = require('./index.node').IndyAgent; } 
catch (e) { IndyAgent = require('./index.js').IndyAgent; }

const DB_PATH = "./wallet.db";
const DB_PASS = "indicio_key_secure";

async function main() {
    console.log("🚀 TESTE: LISTAR OFERTAS DE CREDENCIAIS (COM DATA)");
    const agent = new IndyAgent();

    try {
        if (!fs.existsSync(DB_PATH)) {
            console.error("❌ 'wallet.db' não encontrada. Rode 'teste_offer_existing.js' primeiro.");
            return;
        }

        // 1. Abrir Wallet
        console.log("1️⃣  Abrindo Carteira...");
        await agent.walletOpen(DB_PATH, DB_PASS);

        // 2. Listar Ofertas
        console.log("2️⃣  Buscando ofertas salvas...");
        const offersJson = await agent.listCredentialOffers();
        const offers = JSON.parse(offersJson);

        console.log(`\n📦 Total de Ofertas encontradas: ${offers.length}`);
        console.log("=".repeat(70));

        offers.forEach((offer, i) => {
            // Conversão de Timestamp (segundos -> milissegundos) para Data Legível
            let dateStr = "Desconhecida (Legado)";
            if (offer.created_at && offer.created_at !== "0") {
                const date = new Date(parseInt(offer.created_at) * 1000);
                dateStr = date.toLocaleString('pt-BR'); // Formato local
            }

            console.log(`\n📄 [Oferta #${i + 1}]`);
            console.log(`   🆔 ID Local:    ${offer.id_local}`);
            console.log(`   📅 Criado em:   ${dateStr} (Timestamp: ${offer.created_at})`);
            console.log(`   🔗 CredDef ID:  ${offer.cred_def_id}`);
            console.log(`   📜 Schema ID:   ${offer.schema_id}`);
            console.log(`   🔑 Nonce:       ${offer.nonce.substring(0, 20)}...`); // Nonce resumido
        });
        console.log("\n" + "=".repeat(70));

    } catch (e) {
        console.error("❌ ERRO:", e);
    } finally {
        await agent.walletClose();
        console.log("🔒 Wallet fechada.");
    }
}

main();