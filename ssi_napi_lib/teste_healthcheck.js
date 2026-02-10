// teste_healthcheck.js
// Fase 1: networkHealthcheck
// - sempre valida o erro PoolNotConnected quando não conectou
// - opcional: se GENESIS_PATH estiver definido, conecta e executa healthcheck real

const { IndyAgent } = require('./index.node');
const fs = require('fs');

function parseNapiJsonError(e) {
  try {
    return JSON.parse(e?.message ?? String(e));
  } catch {
    return { ok: false, code: 'Unknown', message: e?.message ?? String(e) };
  }
}

async function main() {
  const agent = new IndyAgent();

  console.log('1) networkHealthcheck sem connectNetwork (deve falhar)');
  try {
    await agent.networkHealthcheck();
    throw new Error('esperado falhar, mas retornou ok');
  } catch (e) {
    const err = parseNapiJsonError(e);
    console.log('   ✅ erro capturado:', err);
    if (err.code !== 'PoolNotConnected') {
      throw new Error(`code inesperado: ${err.code}`);
    }
  }

  const genesisPath = process.env.GENESIS_PATH;
  if (!genesisPath) {
    console.log('ℹ️ GENESIS_PATH não definido; pulando healthcheck real.');
    console.log('✅ OK: teste_healthcheck.js');
    return;
  }

  if (!fs.existsSync(genesisPath)) {
    throw new Error(`GENESIS_PATH não existe: ${genesisPath}`);
  }

  console.log('2) connectNetwork + networkHealthcheck (real)');
  await agent.connectNetwork(genesisPath);
  const ok = await agent.networkHealthcheck();
  if (ok !== true) throw new Error('healthcheck não retornou true');

  console.log('✅ OK: teste_healthcheck.js (real)');
}

main().catch((e) => {
  console.error('❌ Falhou:', e);
  process.exitCode = 1;
});
