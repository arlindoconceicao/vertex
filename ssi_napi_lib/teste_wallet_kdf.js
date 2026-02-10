// teste_wallet_kdf.js
// Fase 1: validação de wallet (Argon2id + sidecar)

const { IndyAgent } = require('./index.node');
const fs = require('fs');
const path = require('path');
const os = require('os');

function parseNapiJsonError(e) {
  try {
    return JSON.parse(e?.message ?? String(e));
  } catch {
    return { ok: false, code: 'Unknown', message: e?.message ?? String(e) };
  }
}

async function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssi-wallet-'));
  const walletPath = path.join(tmpDir, 'wallet1.db');
  const sidecarPath = `${walletPath}.kdf.json`;

  const PASS_OK = 'minha frase-chave super secreta';
  const PASS_BAD = 'senha errada';

  const agent = new IndyAgent();

  console.log('📁 tmpDir:', tmpDir);
  console.log('1) walletCreate (argon2id + sidecar)');
  await agent.walletCreate(walletPath, PASS_OK);

  if (!fs.existsSync(walletPath)) {
    throw new Error('wallet DB não foi criado');
  }
  if (!fs.existsSync(sidecarPath)) {
    throw new Error('sidecar não foi criado');
  }

  console.log('2) walletOpen (senha correta)');
  await agent.walletOpen(walletPath, PASS_OK);

  console.log('3) walletClose');
  await agent.walletClose();

  console.log('4) walletOpen (senha errada) — deve falhar com code');
  try {
    await agent.walletOpen(walletPath, PASS_BAD);
    throw new Error('esperado falhar, mas abriu com senha errada');
  } catch (e) {
    const err = parseNapiJsonError(e);
    console.log('   ✅ erro capturado:', err);
    if (!err.code) throw new Error('erro não tem code');
  }

  console.log('✅ OK: teste_wallet_kdf.js');
}

main().catch((e) => {
  console.error('❌ Falhou:', e);
  process.exitCode = 1;
});
