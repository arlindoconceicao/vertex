// teste_wallet_backup.js
// Fase 1: backup/recovery de senha da wallet (AES-256-GCM + Argon2id)

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
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssi-backup-'));
  const walletPath = path.join(tmpDir, 'wallet2.db');
  const backupFile = path.join(tmpDir, 'wallet2.pass.bak.json');

  const PASS_WALLET = 'senha principal da wallet';
  const PASS_BACKUP = 'frase secundaria para backup';

  const agent = new IndyAgent();

  console.log('📁 tmpDir:', tmpDir);
  console.log('1) walletCreate');
  await agent.walletCreate(walletPath, PASS_WALLET);

  console.log('2) walletBackupCreate');
  const ok = await agent.walletBackupCreate(PASS_WALLET, PASS_BACKUP, backupFile);
  if (ok !== true) throw new Error('walletBackupCreate não retornou true');
  if (!fs.existsSync(backupFile)) throw new Error('arquivo de backup não foi criado');

  console.log('3) walletBackupRecover');
  const recovered = await agent.walletBackupRecover(PASS_BACKUP, backupFile);
  if (recovered !== PASS_WALLET) {
    throw new Error('senha recuperada não bate com a original');
  }

  console.log('4) walletOpen com senha recuperada');
  await agent.walletOpen(walletPath, recovered);
  await agent.walletClose();

  console.log('5) walletBackupRecover com senha errada (deve falhar)');
  try {
    await agent.walletBackupRecover('senha errada', backupFile);
    throw new Error('esperado falhar, mas recuperou com senha errada');
  } catch (e) {
    const err = parseNapiJsonError(e);
    console.log('   ✅ erro capturado:', err);
    if (!err.code) throw new Error('erro não tem code');
  }

  console.log('✅ OK: teste_wallet_backup.js');
}

main().catch((e) => {
  console.error('❌ Falhou:', e);
  process.exitCode = 1;
});
