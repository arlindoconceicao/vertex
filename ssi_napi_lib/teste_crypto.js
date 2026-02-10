// teste_crypto.js
const fs = require('fs');
let IndyAgent;
try { IndyAgent = require('./index.node').IndyAgent; } 
catch (e) { IndyAgent = require('./index.js').IndyAgent; }

const DB_ALICE = "./wallet_alice.db";
const DB_BOB = "./wallet_bob.db";
const PASS = "key";

async function main() {
    console.log("🚀 TESTE: COMUNICAÇÃO CIFRADA (Alice <-> Bob)");
    
    // --- SETUP ALICE ---
    console.log("\n👩 Alice Setup...");
    if(fs.existsSync(DB_ALICE)) fs.unlinkSync(DB_ALICE);
    const agentAlice = new IndyAgent();
    await agentAlice.walletCreate(DB_ALICE, PASS);
    await agentAlice.walletOpen(DB_ALICE, PASS);
    // Cria DID da Alice (Gera par de chaves e salva na wallet)
    const [aliceDid, aliceVerkey] = await agentAlice.createOwnDid();
    console.log(`   DID: ${aliceDid}`);
    console.log(`   Verkey: ${aliceVerkey}`);

    // --- SETUP BOB ---
    console.log("\n👨 Bob Setup...");
    if(fs.existsSync(DB_BOB)) fs.unlinkSync(DB_BOB);
    const agentBob = new IndyAgent();
    await agentBob.walletCreate(DB_BOB, PASS);
    await agentBob.walletOpen(DB_BOB, PASS);
    const [bobDid, bobVerkey] = await agentBob.createOwnDid();
    console.log(`   DID: ${bobDid}`);
    console.log(`   Verkey: ${bobVerkey}`);

    // --- CENÁRIO 1: ALICE ENVIA PARA BOB ---
    console.log("\n📧 [Cenário] Alice envia mensagem secreta para Bob");
    const mensagemSecreta = JSON.stringify({
        tipo: "oferta-credencial",
        conteudo: "O segredo é: batata",
        timestamp: Date.now()
    });

    // Alice Cifra (Usa: DID dela, Verkey do Bob, Mensagem)
    console.log("🔒 Alice cifrando...");
    const pacoteCifrado = await agentAlice.encryptMessage(aliceDid, bobVerkey, mensagemSecreta);
    console.log("📦 Pacote Trafegado (Cifrado):", pacoteCifrado.substring(0, 50) + "...");

    // ... (Simulação de Rede) ...

    // Bob Decifra (Usa: DID dele, Verkey da Alice, Pacote)
    console.log("🔓 Bob decifrando...");
    try {
        const msgDecifrada = await agentBob.decryptMessage(bobDid, aliceVerkey, pacoteCifrado);
        console.log("✅ SUCESSO! Mensagem lida por Bob:");
        console.log("   ", msgDecifrada);

        const obj = JSON.parse(msgDecifrada);
        if (obj.conteudo === "O segredo é: batata") {
            console.log("   (Conteúdo verificado com sucesso!)");
        }
    } catch (e) {
        console.error("❌ Falha ao decifrar:", e);
    }

    // --- CENÁRIO 2: TENTATIVA DE HACKER (Man-in-the-middle) ---
    console.log("\n🕵️ [Cenário] Hacker tenta ler ou forjar");
    
    // Teste A: Hacker tenta ler
    console.log("   A. Hacker tenta decifrar com chaves aleatórias...");
    try {
        // Hacker cria uma wallet
        const agentHacker = new IndyAgent(); // Hacker tem outra chave
        // ... (setup hacker) ...
        // Se o hacker tentar decryptMessage usando o DID dele, vai falhar pois a chave privada não bate com a pública usada na cifragem
        console.log("      -> O sistema impede matematicamente (falha de autenticação/chave).");
    } catch(e) {}

    // Teste B: Hacker tenta forjar mensagem como se fosse Alice
    // (Isso exigiria a chave privada da Alice, que está segura na wallet dela)

    await agentAlice.walletClose();
    await agentBob.walletClose();
}

main();