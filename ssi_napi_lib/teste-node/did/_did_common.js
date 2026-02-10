// teste-node/did/_did_common.js
const fs = require("fs");
const path = require("path");

function loadIndyAgent() {
  const candidates = [
    // raiz do projeto (mais comum)
    path.resolve(__dirname, "../../index.js"),
    path.resolve(__dirname, "../../index.node"),

    // variações (caso você rode de outro lugar ou tenha cópias)
    path.resolve(__dirname, "../index.js"),
    path.resolve(__dirname, "../index.node"),
    path.resolve(__dirname, "./index.js"),
    path.resolve(__dirname, "./index.node"),
  ];

  let lastErr = null;
  for (const p of candidates) {
    try {
      const binding = require(p);
      if (!binding || !binding.IndyAgent) {
        throw new Error(`Binding sem IndyAgent em ${p}`);
      }
      return binding.IndyAgent;
    } catch (e) {
      lastErr = e;
    }
  }

  console.error("❌ Não foi possível carregar a biblioteca nativa (index.js/.node).");
  console.error("Paths tentados:\n" + candidates.map(x => ` - ${x}`).join("\n"));
  if (lastErr) console.error("Último erro:", lastErr.message || String(lastErr));
  process.exit(1);
}

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT FAIL: ${msg}`);
}

function removeIfExists(p) {
  try {
    if (fs.existsSync(p)) {
      const st = fs.lstatSync(p);
      if (st.isDirectory()) {
        fs.rmSync(p, { recursive: true, force: true });
      } else {
        fs.unlinkSync(p);
      }
    }
  } catch (_) {}
}

/**
 * Remove TODOS os artefatos do wallet associados ao caminho informado.
 * Resolve o caso clássico: db apagado mas sidecar ficou -> WalletAlreadyExists.
 */
function resetWalletArtifacts(dbPath) {
  try {
    const abs = path.resolve(dbPath);
    const dir = path.dirname(abs);
    const base = path.basename(abs);

    // 1) Remove dbPath direto e variações comuns
    const candidates = [
      abs,
      abs + "-shm",
      abs + "-wal",
      abs + "-journal",
      abs + ".sidecar",
      abs + ".sidecar.json",
      abs + ".sidecar.bin",
      abs + ".sidecar.key",
      abs + ".sidecar.pass",
      abs + ".json",
      abs + ".key",
      abs + ".pass",
    ];
    candidates.forEach(removeIfExists);

    // 2) Remove qualquer arquivo no diretório com o mesmo prefixo do wallet
    // (cobre nomes de sidecar inesperados)
    if (fs.existsSync(dir)) {
      for (const name of fs.readdirSync(dir)) {
        if (
          name === base ||
          name.startsWith(base + ".") ||
          name.startsWith(base + "-") ||
          name.startsWith(base + "_")
        ) {
          removeIfExists(path.join(dir, name));
        }
      }
    }
  } catch (_) {}
}

/**
 * Tenta criar e abrir. Se "WalletAlreadyExists", ignora e apenas abre.
 * Isso garante estabilidade mesmo quando o sidecar ficou no disco.
 */
async function openOrCreateWallet(agent, dbPath, pass) {
  // garante diretório pai
  const dir = path.dirname(path.resolve(dbPath));
  fs.mkdirSync(dir, { recursive: true });

  // tenta criar sempre (mais robusto do que depender do existsSync do .db)
  try {
    await agent.walletCreate(dbPath, pass);
    console.log(`🆕 Wallet criada: ${dbPath}`);
  } catch (e) {
    const msg = (e && e.message) ? String(e.message) : String(e);

    // tenta extrair {code:"..."} se vier como JSON string
    let code = "";
    try {
      const j = JSON.parse(msg);
      code = j.code || "";
    } catch (_) {}

    if (
      code === "WalletAlreadyExists" ||
      msg.includes("WalletAlreadyExists") ||
      msg.includes("wallet já existe")
    ) {
      console.log(`📦 Wallet já existe (db/sidecar). Abrindo: ${dbPath}`);
    } else {
      throw e; // erro real
    }
  }

  // sempre abre
  await agent.walletOpen(dbPath, pass);
  console.log(`✅ Wallet aberta: ${dbPath}`);
}

module.exports = {
  loadIndyAgent,
  resetWalletArtifacts,
  openOrCreateWallet,
  assert,
};
