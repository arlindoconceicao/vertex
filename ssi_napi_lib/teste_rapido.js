// teste_rapido.js

const { IndyAgent } = require('./index.node');
const fs = require('fs');

async function main() {
  console.log("🚀 Teste de Classificação de DIDs...");
  const agent = new IndyAgent();
  const dbPath = "./wallet.db";
  const pass = "indicio_key_secure";

  // Lógica de Persistência
  if (fs.existsSync(dbPath)) {
    console.log("\n1️⃣  Carteira encontrada no disco. Abrindo...");
  } else {
    console.log("\n1️⃣  Carteira não encontrada. Criando nova...");
    await agent.walletCreate(dbPath, pass);
  }

  await agent.walletOpen(dbPath, pass);

  // 1. Criar MEU DID (CORREÇÃO: Destructuring do Array)
  const [myDid, myVerkey] = await agent.createOwnDid();
  console.log(`\n✅ Meu DID Criado: ${myDid}`);

  // 2. Gravar DID de Terceiro (Exemplo fictício)
  const externalDid = "DidDeTerceiroExemplo123";
  const externalVerkey = "VerkeyDeTerceiroExemplo123...";
  
  // Agora este método no Rust verifica duplicidade, então não vai quebrar na 2ª vez
  await agent.storeTheirDid(externalDid, externalVerkey, "Banco Central");
  console.log(`✅ DID de Terceiro Salvo: ${externalDid}`);

  // 3. Listar SOMENTE MEUS
  console.log("\n🔍 Buscando 'Meus DIDs' (type='own')...");
  const myDidsJson = await agent.listDids("own");
  const myDids = JSON.parse(myDidsJson);
  console.log(`   -> Encontrados: ${myDids.length}`);
  
  if (myDids.length === 0) {
      console.log("   ⚠️  AVISO: Nenhum DID próprio encontrado. Verifique as tags no Rust.");
  }
  
  myDids.forEach(d => console.log(`      - ${d.did} (${d.alias})`));

  // 4. Listar SOMENTE DELES
  console.log("\n🔍 Buscando 'DIDs Externos' (type='external')...");
  const theirDidsJson = await agent.listDids("external");
  const theirDids = JSON.parse(theirDidsJson);
  console.log(`   -> Encontrados: ${theirDids.length}`);
  theirDids.forEach(d => console.log(`      - ${d.did} (${d.alias})`));

  await agent.walletClose();
}

main();