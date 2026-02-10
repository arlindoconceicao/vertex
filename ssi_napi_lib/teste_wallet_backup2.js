// teste_wallet_backup.js
const { IndyAgent } = require("./index.node");
const fs = require("fs");
const path = require("path");

function parseNapiError(e) {
  const msg = (e && e.message) ? String(e.message) : String(e);

  try {
    const j = JSON.parse(msg);
    if (j && typeof j === "object") return j;
  } catch {}

  const start = msg.indexOf("{");
  const end = msg.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const maybe = msg.slice(start, end + 1);
    try {
      const j = JSON.parse(maybe);
      if (j && typeof j === "object") return j;
    } catch {}
  }

  return { ok: false, code: "GenericFailure", message: msg };
}

function removeIfExists(p) {
  try {
    if (fs.existsSync(p)) fs.rmSync(p, { force: true });
  } catch {}
}

function sidecarPathFor(walletPath) {
  return `${walletPath}.kdf.json`;
}

async function maybeAwait(x) {
  // caso algum binding resolva retornar Promise
  if (x && typeof x.then === "function") return await x;
  return x;
}

async function main() {
  const walletPath = process.env.WALLET_PATH || "./wallets/test_wallet_backup.db";
  const walletPass = process.env.WALLET_PASS || "minha_senha_wallet";
  const backupFile = process.env.BACKUP_FILE || "./wallets/test_wallet_backup.backup.json";
  const backupPass = process.env.BACKUP_PASS || "minha_senha_backup";

  // Reset determinístico
  fs.mkdirSync(path.dirname(walletPath), { recursive: true });
  removeIfExists(walletPath);
  removeIfExists(sidecarPathFor(walletPath));
  removeIfExists(`${walletPath}-wal`);
  removeIfExists(`${walletPath}-shm`);
  removeIfExists(backupFile);

  console.log("🚀 teste_wallet_backup");
  console.log("Config:", {
    walletPath,
    backupFile,
  });

  const agent = new IndyAgent();

  // 1) cria wallet
  console.log("1) Criando wallet...");
  await agent.walletCreate(walletPath, walletPass);
  console.log("✅ Wallet criada.");

  // 2) cria backup
  console.log("2) Criando backup...");
  try {
    const ok = await maybeAwait(agent.walletBackupCreate(walletPass, backupPass, backupFile));
    if (ok !== true) {
      console.log("❌ walletBackupCreate retornou:", ok);
      process.exit(1);
    }
  } catch (e) {
    const pe = parseNapiError(e);
    console.log("❌ Falha ao criar backup:", pe);
    process.exit(1);
  }
  console.log("✅ Backup criado:", backupFile);

  if (!fs.existsSync(backupFile)) {
    console.log("❌ Arquivo de backup não foi gerado no disco.");
    process.exit(1);
  }

  // 3) recupera senha do backup
  console.log("3) Recuperando senha do backup...");
  let recoveredPass;
  try {
    recoveredPass = await maybeAwait(agent.walletBackupRecover(backupPass, backupFile));
    if (typeof recoveredPass !== "string" || recoveredPass.length === 0) {
      console.log("❌ walletBackupRecover retornou valor inválido:", recoveredPass);
      process.exit(1);
    }
  } catch (e) {
    const pe = parseNapiError(e);
    console.log("❌ Falha ao recuperar backup:", pe);
    process.exit(1);
  }
  console.log("✅ Senha recuperada (tamanho):", recoveredPass.length);

  // 4) valida senha recuperada = original
  if (recoveredPass !== walletPass) {
    console.log("❌ Senha recuperada NÃO bate com a original.");
    console.log("original:", walletPass);
    console.log("recuperada:", recoveredPass);
    process.exit(1);
  }
  console.log("✅ Senha recuperada bate com a original.");

  // 5) valida abertura de wallet com senha recuperada
  console.log("4) Abrindo wallet com senha recuperada...");
  try {
    await agent.walletOpen(walletPath, recoveredPass);
    console.log("✅ Wallet abriu com senha recuperada.");
  } catch (e) {
    const pe = parseNapiError(e);
    console.log("❌ Wallet não abriu com senha recuperada:", pe);
    process.exit(1);
  }

  // fecha
  try { await agent.walletClose(); } catch {}

  // ==========================
  // Casos negativos
  // ==========================

  // N1) recover com senha de backup errada
  console.log("N1) Recover com backupPass errado (espera falhar)...");
  try {
    await maybeAwait(agent.walletBackupRecover(backupPass + "_ERRADA", backupFile));
    console.log("❌ Era esperado falhar, mas recuperou.");
    process.exit(1);
  } catch (e) {
    const pe = parseNapiError(e);
    console.log("✅ Falha esperada:", pe.code || "GenericFailure");
  }

  // N2) recover com arquivo inexistente
  console.log("N2) Recover com arquivo inexistente (espera falhar)...");
  try {
    await maybeAwait(agent.walletBackupRecover(backupPass, backupFile + ".nao_existe"));
    console.log("❌ Era esperado falhar, mas recuperou.");
    process.exit(1);
  } catch (e) {
    const pe = parseNapiError(e);
    console.log("✅ Falha esperada:", pe.code || "GenericFailure");
  }

  console.log("\nRESULT: OK (backup + recover + negativos)");
  process.exit(0);
}

main().catch((e) => {
  console.error("❌ Erro inesperado:", e);
  process.exit(1);
});
