// RESET_WALLET=1 node ./teste-node/did/teste_did_07_register_updates_local_record.js

// teste-node/did/teste_did_07_register_updates_local_record.js
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

// Trustee padrão da Von-Network
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
  console.log("🚀 TESTE DID 07: registerDidOnLedger atualiza DidRecord local (PR-01)");

  const dbPath = "./wallet_did_07.db";
  const pass = "pass_did_07";
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

    // 3) Importar Trustee
    console.log("1) Importando Trustee...");
    const [trusteeDid, trusteeVerkey] = await agent.importDidFromSeed(TRUSTEE_SEED);
    console.log(`   Trustee: ${trusteeDid}`);
    assert(trusteeDid === TRUSTEE_DID, "Seed gerou DID Trustee incorreto!");
    assert(typeof trusteeVerkey === "string" && trusteeVerkey.length > 10, "Verkey Trustee inválida");

    // 4) Conectar Pool
    console.log("2) Conectando Pool...");
    await agent.connectNetwork(NETWORK_CONFIG.genesisFile);

    // 5) Criar DID target local (v2)
    console.log("3) Criando DID target (createDidV2 local)...");
    const alias = "DID-07 Target";
    const createOpts = {
      alias,
      public: false,
      role: "none",
    };
    const createdStr = await agent.createDidV2(JSON.stringify(createOpts));
    const created = safeJsonParse(createdStr, "createDidV2");
    assert(created.ok === true, "createDidV2: ok !== true");
    assert(typeof created.did === "string" && created.did.length > 5, "createDidV2: did inválido");
    assert(typeof created.verkey === "string" && created.verkey.length > 10, "createDidV2: verkey inválida");
    assert(created.isPublic === false, "createDidV2: isPublic deveria ser false");
    assert(typeof created.createdAt === "number", "createDidV2: createdAt inválido");

    const targetDid = created.did;
    const targetVerkey = created.verkey;

    // sanity do getDid antes do registro
    console.log("4) getDid antes do registro...");
    const beforeStr = await agent.getDid(targetDid);
    const before = safeJsonParse(beforeStr, "getDid(before)");
    assert(before.did === targetDid, "getDid(before): did diferente");
    assert(before.verkey === targetVerkey, "getDid(before): verkey diferente");
    assert(before.isPublic === false, "getDid(before): isPublic deveria ser false");
    // role deve ser null (PR-01)
    assert(before.role === null || before.role === undefined, "getDid(before): role deveria ser null");
    assert(before.alias === alias, "getDid(before): alias não preservado");

    // 6) Registrar no ledger
    console.log("5) Registrando no ledger (registerDidOnLedger)...");
    const role = "ENDORSER";
    const regResp = await agent.registerDidOnLedger(
      NETWORK_CONFIG.genesisFile, // compat
      TRUSTEE_DID,
      targetDid,
      targetVerkey,
      role
    );
    const regJson = safeJsonParse(regResp, "registerDidOnLedger");
    assert(regJson.op === "REPLY", "Ledger não retornou REPLY no registro");
    assert(regJson.result && regJson.result.txnMetadata, "Resposta de registro sem txnMetadata");

    // 7) Validar update local no DidRecord
    console.log("6) getDid depois do registro (deve estar isPublic=true + ledger.*)...");
    const afterStr = await agent.getDid(targetDid);
    const after = safeJsonParse(afterStr, "getDid(after)");

    assert(after.did === targetDid, "getDid(after): did diferente");
    assert(after.verkey === targetVerkey, "getDid(after): verkey diferente");
    assert(after.alias === alias, "getDid(after): alias não preservado");
    assert(typeof after.createdAt === "number", "getDid(after): createdAt inválido");

    // ✅ principal: update de publicação
    assert(after.isPublic === true, "getDid(after): isPublic deveria ser true");

    // role: quando registramos com ENDORSER, deve virar "ENDORSER"
    assert(after.role === "ENDORSER", `getDid(after): role esperado ENDORSER, veio ${after.role}`);

    // ledger metadata
    assert(after.ledger && typeof after.ledger === "object", "getDid(after): ledger ausente");
    assert(typeof after.ledger.registeredAt === "number", "getDid(after): ledger.registeredAt inválido");
    assert(after.ledger.submitterDid === TRUSTEE_DID, "getDid(after): ledger.submitterDid diferente");

    // hardening: seed nunca deve aparecer
    assert(after.seed === undefined, "getDid(after): vazou seed");
    assert(after.seedHex === undefined, "getDid(after): vazou seedHex");
    assert(after.seedB64 === undefined, "getDid(after): vazou seedB64");

    console.log("✅ OK: TESTE DID 07 passou.");
  } catch (e) {
    console.error("❌ ERRO:", e);
  } finally {
    console.log("🔒 Fechando wallet...");
    try { await agent.walletClose(); } catch (_) {}
    console.log("👋 Fim.");
  }
}

main();
