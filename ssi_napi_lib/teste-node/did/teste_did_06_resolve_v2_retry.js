// RESET_WALLET=1 node ./teste-node/did/teste_did_06_resolve_v2_retry.js
// teste-node/did/teste_did_06_resolve_v2_retry.js
const fs = require("fs");
const http = require("http");

const {
  loadIndyAgent,
  resetWalletArtifacts,
  openOrCreateWallet,
  assert,
} = require("./_did_common");

const IndyAgent = loadIndyAgent();

// CONFIG (Von-Network local)
const NETWORK_CONFIG = {
  genesisUrl: "http://localhost:9000/genesis",
  genesisFile: "/tmp/von_genesis.txn",
};

// Trustee padrão da von-network
const TRUSTEE_SEED = "000000000000000000000000Trustee1";
const TRUSTEE_DID = "V4SGRU86Z58d6TV7PBUe6f";

function downloadGenesisHttp(url, dest) {
  return new Promise((resolve, reject) => {
    try {
      if (fs.existsSync(dest)) fs.unlinkSync(dest);
    } catch (_) {}

    const file = fs.createWriteStream(dest);
    console.log(`⏳ Baixando Genesis de: ${url}...`);

    http
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`Erro HTTP: ${res.statusCode}`));
          return;
        }
        res.pipe(file);
        file.on("finish", () => {
          file.close(() => {
            console.log("✅ Genesis baixado.");
            resolve(true);
          });
        });
      })
      .on("error", (err) => {
        try {
          fs.unlinkSync(dest);
        } catch (_) {}
        reject(err);
      });
  });
}

function safeJsonParse(s, label = "json") {
  try {
    return JSON.parse(s);
  } catch (e) {
    throw new Error(`${label}: JSON inválido: ${String(e)} | raw=${String(s).slice(0, 300)}`);
  }
}

async function main() {
  console.log("🚀 TESTE DID 06: resolveDidOnLedgerV2 (retry embutido)");

  const dbPath = "./wallet_did_06.db";
  const pass = "pass_did_06";
  const agent = new IndyAgent();

  try {
    if (process.env.RESET_WALLET === "1") {
      console.log("🧹 RESET_WALLET=1: removendo wallet artifacts...");
      resetWalletArtifacts(dbPath);
    }

    // 1) Genesis
    await downloadGenesisHttp(NETWORK_CONFIG.genesisUrl, NETWORK_CONFIG.genesisFile);

    // 2) Wallet
    await openOrCreateWallet(agent, dbPath, pass);

    // 3) Trustee
    console.log("1) Importando Trustee...");
    const [importedDid, importedVerkey] = await agent.importDidFromSeed(TRUSTEE_SEED);
    console.log(`   Trustee: ${importedDid}`);
    assert(importedDid === TRUSTEE_DID, "Seed gerou DID Trustee incorreto!");
    assert(typeof importedVerkey === "string" && importedVerkey.length > 10, "Verkey Trustee inválida");

    // 4) Pool
    console.log("2) Conectando Pool...");
    await agent.connectNetwork(NETWORK_CONFIG.genesisFile);

    // 5) DID target
    console.log("3) Criando DID target (createOwnDid)...");
    const [newDid, newVerkey] = await agent.createOwnDid();
    console.log(`   Target DID: ${newDid}`);
    assert(typeof newDid === "string" && newDid.length > 5, "newDid inválido");
    assert(typeof newVerkey === "string" && newVerkey.length > 10, "newVerkey inválida");

    // 6) Registrar
    console.log("4) Registrando DID no ledger (NYM)...");
    const role = "ENDORSER";
    const regResp = await agent.registerDidOnLedger(
      NETWORK_CONFIG.genesisFile, // mantido por compat (não usado internamente)
      TRUSTEE_DID,
      newDid,
      newVerkey,
      role
    );
    const regJson = safeJsonParse(regResp, "registerDidOnLedger");
    assert(regJson.op === "REPLY", "Ledger não retornou REPLY no registro");
    assert(regJson.result && regJson.result.txnMetadata, "Resposta de registro sem txnMetadata");

    // 7) Resolve v2 (com retry embutido)
    console.log("5) resolveDidOnLedgerV2 (deve retornar found=true)...");
    const resolvedStr = await agent.resolveDidOnLedgerV2(newDid);
    const resolved = safeJsonParse(resolvedStr, "resolveDidOnLedgerV2");

    assert(resolved.ok === true, "resolveDidOnLedgerV2: ok !== true");
    assert(resolved.did === newDid, "resolveDidOnLedgerV2: did retornado diferente");
    assert(resolved.found === true, "resolveDidOnLedgerV2: found !== true");

    // verkey deve bater
    assert(resolved.verkey === newVerkey, `resolveDidOnLedgerV2: verkey diferente (esperado ${newVerkey}, veio ${resolved.verkey})`);

    // role pode vir como "101" ou como string "ENDORSER" dependendo do ledger
    // seu resolve_v2 mapeia roleName -> ENDORSER quando role == 101
    assert(typeof resolved.attempts === "number" && resolved.attempts >= 1, "resolveDidOnLedgerV2: attempts inválido");
    assert(typeof resolved.elapsedMs === "number" && resolved.elapsedMs >= 0, "resolveDidOnLedgerV2: elapsedMs inválido");

    if (resolved.role != null) {
      assert(typeof resolved.role === "string", "resolveDidOnLedgerV2: role não é string");
    }
    if (resolved.roleName != null) {
      assert(typeof resolved.roleName === "string", "resolveDidOnLedgerV2: roleName não é string");
    }

    // rawData e ledger devem existir quando found=true
    assert(resolved.rawData && typeof resolved.rawData === "object", "resolveDidOnLedgerV2: rawData ausente");
    assert(resolved.ledger && typeof resolved.ledger === "object", "resolveDidOnLedgerV2: ledger ausente");

    // sanity: rawData.verkey também deve bater (se presente)
    if (resolved.rawData.verkey) {
      assert(resolved.rawData.verkey === newVerkey, "rawData.verkey != newVerkey");
    }

    console.log(`✅ OK: TESTE DID 06 passou. (attempts=${resolved.attempts}, elapsedMs=${resolved.elapsedMs})`);
  } catch (e) {
    console.error("❌ ERRO:", e);
  } finally {
    console.log("🔒 Fechando wallet...");
    try { await agent.walletClose(); } catch (_) {}
    console.log("👋 Fim.");
  }
}

main();
