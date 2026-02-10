/*
PARA RODAR ESTE TESTE (INDICIO TESTNET):
WALLET_PASS="minha_senha_teste" \
node teste-node/presentations/teste_indicio_2creds_file_exchange_zkp18_walletverkey.js

PRÉ-REQ:
- O arquivo ./indicio_testnet.txn deve existir (ou o teste baixa via genesisUrl).
- Este teste NÃO usa TRUSTEE. Usa apenas o ENDORSER (SUBMITTER) como issuer.
- Como decryptMessage exige sender_verkey (AuthCrypt), aqui pegamos a verkey
  do SUBMITTER DIRETO DA WALLET via getDid(), sem precisar ler do ledger.
*/

/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const https = require("https");

// ✅ index.node fica na RAIZ do projeto (teste-node/presentations -> ../../index.node)
const { IndyAgent } = require(path.join(__dirname, "..", "..", "index.node"));

// -----------------------
// Helpers básicos
// -----------------------
function rmIfExists(walletDbPath) {
  const sidecar = `${walletDbPath}.kdf.json`;
  try { fs.unlinkSync(walletDbPath); } catch (_) {}
  try { fs.unlinkSync(sidecar); } catch (_) {}
  try { fs.unlinkSync(`${sidecar}.tmp`); } catch (_) {}
  try { fs.unlinkSync(`${walletDbPath}-shm`); } catch (_) {}
  try { fs.unlinkSync(`${walletDbPath}-wal`); } catch (_) {}
}

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Env ${name} não definida.`);
  return v;
}

function writeFileAtomic(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, data, "utf8");
}

function readFileUtf8(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function retry(label, fn, attempts = 10, baseDelayMs = 800) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const wait = Math.min(baseDelayMs * i, 8000);
      console.log(`⏳ retry(${label}) ${i}/${attempts} falhou; aguardando ${wait}ms...`);
      await sleep(wait);
    }
  }
  throw lastErr;
}

// -----------------------
// Genesis (download if missing)
// -----------------------
function downloadToFile(url, filePath) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const file = fs.createWriteStream(filePath, { encoding: "utf8" });

    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Falha download genesis: HTTP ${res.statusCode}`));
        return;
      }
      res.setEncoding("utf8");
      res.pipe(file);
      file.on("finish", () => file.close(resolve));
    }).on("error", (err) => {
      try { fs.unlinkSync(filePath); } catch (_) {}
      reject(err);
    });
  });
}

async function ensureGenesis(genesisUrl, genesisFile) {
  console.log("0) Garantindo genesis da Indicio...");
  if (fs.existsSync(genesisFile)) {
    console.log(`📂 Genesis já existe: ${genesisFile}`);
    return;
  }
  console.log(`⬇️ Baixando genesis: ${genesisUrl}`);
  await downloadToFile(genesisUrl, genesisFile);
  console.log(`✅ Genesis salvo em: ${genesisFile}`);
}

// -----------------------
// Crypto file exchange (AuthCrypt)
// -----------------------
async function encryptToFile(senderAgent, senderDid, recipientVerkey, plaintext, filePath) {
  const encryptedJson = await senderAgent.encryptMessage(
    senderDid,
    recipientVerkey,
    plaintext
  );
  writeFileAtomic(filePath, encryptedJson);
}

async function decryptFromFile(receiverAgent, receiverDid, senderVerkey, filePath) {
  const encryptedJson = readFileUtf8(filePath);
  const plaintext = await receiverAgent.decryptMessage(
    receiverDid,
    senderVerkey,
    encryptedJson
  );
  return plaintext;
}

async function tryRegisterDid(issuerAgent, GENESIS_FILE, submitterDid, did, verkey, role) {
  try {
    await issuerAgent.registerDidOnLedger(
      GENESIS_FILE,
      submitterDid,
      did,
      verkey,
      role
    );
  } catch (e) {
    const msg = e?.message || String(e);
    if (/already exists|exists|DID.*exist|NYM.*exist|Ledger/i.test(msg)) {
      console.log(`ℹ️ DID já estava no ledger, seguindo: ${did}`);
      return;
    }
    throw e;
  }
}

// -----------------------
// MAIN
// -----------------------
(async () => {
  const WALLET_PASS = process.env.WALLET_PASS || "minha_senha_teste";

  const genesisUrl =
    "https://raw.githubusercontent.com/Indicio-tech/indicio-network/refs/heads/main/genesis_files/pool_transactions_testnet_genesis";
  const genesisFile = "./indicio_testnet.txn";

  // DADOS DO SUBMITTER (ENDORSER / ISSUER)
  // Endorsers podem criar DIDs (role=null) no ledger.
  const SUBMITTER_SEED = process.env.SUBMITTER_SEED || "+0HGyElhOr/GuwUaDsyiTn926bFMrBUh";
  const SUBMITTER_DID  = process.env.SUBMITTER_DID  || "7DffLFWsgrwbt7T1Ni9cmu";

  await ensureGenesis(genesisUrl, genesisFile);

  const walletsDir = path.join(__dirname, "..", "wallets");
  fs.mkdirSync(walletsDir, { recursive: true });

  const exchangeDir = path.join(__dirname, "exchange_indicio_2creds_zkp18_walletverkey");
  fs.mkdirSync(exchangeDir, { recursive: true });

  // Wallets (reset)
  const issuerWalletPath = path.join(walletsDir, "issuer_indicio_2creds_files.db");
  const holderWalletPath = path.join(walletsDir, "holder_indicio_2creds_files.db");
  rmIfExists(issuerWalletPath);
  rmIfExists(holderWalletPath);

  const issuer = new IndyAgent();
  const holder = new IndyAgent();

  try {
    console.log("1) Criando wallets...");
    await issuer.walletCreate(issuerWalletPath, WALLET_PASS);
    await holder.walletCreate(holderWalletPath, WALLET_PASS);

    console.log("2) Abrindo wallets...");
    await issuer.walletOpen(issuerWalletPath, WALLET_PASS);
    await holder.walletOpen(holderWalletPath, WALLET_PASS);

    console.log("3) Conectando na rede (Indicio)...");
    await issuer.connectNetwork(genesisFile);
    await holder.connectNetwork(genesisFile);

    console.log("4) Importando SUBMITTER DID no issuer (Endorser da Indicio)...");
    await issuer.importDidFromSeed(SUBMITTER_SEED);

    // ✅ Aqui está a correção do seu erro:
    // Em vez de fetchVerkeyFromLedger (não existe), pegamos a verkey da WALLET.
    const submitterDidJson = await issuer.getDid(SUBMITTER_DID);
    const submitterDidObj = JSON.parse(submitterDidJson);
    const issuerDid = SUBMITTER_DID;
    const issuerVerkey = submitterDidObj?.verkey;
    if (!issuerVerkey) throw new Error("Não consegui obter verkey do SUBMITTER via getDid().");

    console.log("5) Criando DID do holder (createOwnDid)...");
    const [holderDid, holderVerkey] = await holder.createOwnDid();

    console.log("6) Registrando DID do holder no ledger via SUBMITTER (NYM role=null)...");
    await tryRegisterDid(issuer, genesisFile, issuerDid, holderDid, holderVerkey, null);

    console.log("7) Aguardando consistência do ledger após NYM...");
    await sleep(2500);

    // -----------------------
    // Schemas + CredDefs (2 credenciais)
    // -----------------------
    console.log("8) Criando+registrando Schema CPF (versão única)...");
    const schemaCpfVersion = `1.0.${Date.now()}`;
    const schemaCpfId = await issuer.createAndRegisterSchema(
      genesisFile,
      issuerDid,
      "cpf",
      schemaCpfVersion,
      ["nome", "cpf", "idade"]
    );

    console.log("9) Criando+registrando Schema ENDERECO (versão única)...");
    const schemaEndVersion = `1.0.${Date.now()}`;
    const schemaEndId = await issuer.createAndRegisterSchema(
      genesisFile,
      issuerDid,
      "endereco",
      schemaEndVersion,
      ["nome", "endereco", "cidade", "estado"]
    );

    console.log("10) Aguardando consistência do ledger após SCHEMAS...");
    await sleep(3500);

    console.log("11) Criando+registrando CredDef CPF (tag única)...");
    const credDefCpfTag = `TAG_CPF_${Date.now()}`;
    const credDefCpfId = await issuer.createAndRegisterCredDef(
      genesisFile,
      issuerDid,
      schemaCpfId,
      credDefCpfTag
    );

    console.log("12) Criando+registrando CredDef ENDERECO (tag única)...");
    const credDefEndTag = `TAG_END_${Date.now()}`;
    const credDefEndId = await issuer.createAndRegisterCredDef(
      genesisFile,
      issuerDid,
      schemaEndId,
      credDefEndTag
    );

    console.log("13) Aguardando consistência do ledger após CREDDEFS...");
    await sleep(4500);

    console.log("14) Garantindo Link Secret no holder...");
    try { await holder.createLinkSecret("default"); } catch (_) {}

    // ============================================================
    // EMISSÃO 1: CPF (Offer -> Request -> Credential -> Store) via arquivos cifrados
    // ============================================================
    console.log("15) Fluxo CPF via arquivos cifrados...");

    console.log("15.1) Issuer criando Offer (CPF) e gravando em arquivo cifrado...");
    const offerCpfId = `offer-cpf-${Date.now()}`;
    const offerCpfJson = await issuer.createCredentialOffer(credDefCpfId, offerCpfId);
    const offerCpfFile = path.join(exchangeDir, "01_offer_cpf.enc.json");
    await encryptToFile(issuer, issuerDid, holderVerkey, offerCpfJson, offerCpfFile);

    console.log("15.2) Holder lendo Offer (CPF), decifrando e criando Request...");
    const offerCpfJsonPlain = await decryptFromFile(holder, holderDid, issuerVerkey, offerCpfFile);
    const offerCpfObj = JSON.parse(offerCpfJsonPlain);
    const reqMetaCpfId = offerCpfObj?.nonce;
    if (!reqMetaCpfId) throw new Error("Offer CPF sem nonce (reqMetaId).");

    const credDefCpfJsonLedger = await retry(
      "fetchCredDefCpf",
      () => holder.fetchCredDefFromLedger(genesisFile, credDefCpfId),
      12,
      800
    );

    const reqCpfJson = await holder.createCredentialRequest(
      "default",
      holderDid,
      credDefCpfJsonLedger,
      offerCpfJsonPlain
    );

    const reqCpfFile = path.join(exchangeDir, "02_request_cpf.enc.json");
    await encryptToFile(holder, holderDid, issuerVerkey, reqCpfJson, reqCpfFile);

    console.log("15.3) Issuer lendo Request (CPF), decifrando e emitindo Credencial...");
    const reqCpfJsonPlain = await decryptFromFile(issuer, issuerDid, holderVerkey, reqCpfFile);

    const valuesCpf = {
      nome: "Amarildo Dias",
      cpf: "123.456.789-09",
      // ⚠️ Para predicado/ZKP, idade deve ser string numérica válida.
      idade: "35"
    };

    const credCpfJson = await issuer.createCredential(
      credDefCpfId,
      offerCpfJson,
      reqCpfJsonPlain,
      JSON.stringify(valuesCpf)
    );

    const credCpfFile = path.join(exchangeDir, "03_credential_cpf.enc.json");
    await encryptToFile(issuer, issuerDid, holderVerkey, credCpfJson, credCpfFile);

    console.log("15.4) Holder lendo Credential (CPF), decifrando e armazenando...");
    const credCpfJsonPlain = await decryptFromFile(holder, holderDid, issuerVerkey, credCpfFile);

    const credCpfIdInWallet = "cred-cpf-file";
    await holder.storeCredential(
      credCpfIdInWallet,
      credCpfJsonPlain,
      reqMetaCpfId,
      credDefCpfJsonLedger,
      null
    );

    // ============================================================
    // EMISSÃO 2: ENDERECO (Offer -> Request -> Credential -> Store) via arquivos cifrados
    // ============================================================
    console.log("16) Fluxo ENDERECO via arquivos cifrados...");

    console.log("16.1) Issuer criando Offer (END) e gravando em arquivo cifrado...");
    const offerEndId = `offer-end-${Date.now()}`;
    const offerEndJson = await issuer.createCredentialOffer(credDefEndId, offerEndId);
    const offerEndFile = path.join(exchangeDir, "04_offer_end.enc.json");
    await encryptToFile(issuer, issuerDid, holderVerkey, offerEndJson, offerEndFile);

    console.log("16.2) Holder lendo Offer (END), decifrando e criando Request...");
    const offerEndJsonPlain = await decryptFromFile(holder, holderDid, issuerVerkey, offerEndFile);
    const offerEndObj = JSON.parse(offerEndJsonPlain);
    const reqMetaEndId = offerEndObj?.nonce;
    if (!reqMetaEndId) throw new Error("Offer ENDERECO sem nonce (reqMetaId).");

    const credDefEndJsonLedger = await retry(
      "fetchCredDefEnd",
      () => holder.fetchCredDefFromLedger(genesisFile, credDefEndId),
      12,
      800
    );

    const reqEndJson = await holder.createCredentialRequest(
      "default",
      holderDid,
      credDefEndJsonLedger,
      offerEndJsonPlain
    );

    const reqEndFile = path.join(exchangeDir, "05_request_end.enc.json");
    await encryptToFile(holder, holderDid, issuerVerkey, reqEndJson, reqEndFile);

    console.log("16.3) Issuer lendo Request (END), decifrando e emitindo Credencial...");
    const reqEndJsonPlain = await decryptFromFile(issuer, issuerDid, holderVerkey, reqEndFile);

    const valuesEnd = {
      nome: "Amarildo Dias",
      endereco: "Rua Exemplo, 123",
      cidade: "São Paulo",
      estado: "SP"
    };

    const credEndJson = await issuer.createCredential(
      credDefEndId,
      offerEndJson,
      reqEndJsonPlain,
      JSON.stringify(valuesEnd)
    );

    const credEndFile = path.join(exchangeDir, "06_credential_end.enc.json");
    await encryptToFile(issuer, issuerDid, holderVerkey, credEndJson, credEndFile);

    console.log("16.4) Holder lendo Credential (END), decifrando e armazenando...");
    const credEndJsonPlain = await decryptFromFile(holder, holderDid, issuerVerkey, credEndFile);

    const credEndIdInWallet = "cred-end-file";
    await holder.storeCredential(
      credEndIdInWallet,
      credEndJsonPlain,
      reqMetaEndId,
      credDefEndJsonLedger,
      null
    );

    // ============================================================
    // PROVA: 2 credenciais + ZKP idade >= 18 (vindo da cred CPF)
    // ============================================================
    console.log("17) Issuer criando Proof Request (2 creds + ZKP idade>=18) e gravando...");
    const presReq = {
      nonce: String(Date.now()),
      name: "proof-cpf-endereco-zkp18",
      version: "1.0",
      requested_attributes: {
        attr_nome: { name: "nome", restrictions: [{ cred_def_id: credDefCpfId }] },
        attr_cpf:  { name: "cpf",  restrictions: [{ cred_def_id: credDefCpfId }] },
        attr_end:  { name: "endereco", restrictions: [{ cred_def_id: credDefEndId }] }
      },
      requested_predicates: {
        pred_idade_18: {
          name: "idade",
          p_type: ">=",
          p_value: 18,
          restrictions: [{ cred_def_id: credDefCpfId }]
        }
      }
    };

    const presReqFile = path.join(exchangeDir, "07_proof_request.enc.json");
    await encryptToFile(issuer, issuerDid, holderVerkey, JSON.stringify(presReq), presReqFile);

    console.log("18) Holder lendo Proof Request (arquivo), criando Presentation...");
    const presReqPlain = await decryptFromFile(holder, holderDid, issuerVerkey, presReqFile);
    const presReqObj = JSON.parse(presReqPlain);

    // Schemas do ledger (retry por consistência)
    const schemaCpfJsonLedger = await retry(
      "fetchSchemaCpf",
      () => holder.fetchSchemaFromLedger(genesisFile, schemaCpfId),
      12,
      800
    );
    const schemaEndJsonLedger = await retry(
      "fetchSchemaEnd",
      () => holder.fetchSchemaFromLedger(genesisFile, schemaEndId),
      12,
      800
    );

    const requestedCreds = {
      requested_attributes: {
        attr_nome: { cred_id: credCpfIdInWallet, revealed: true },
        attr_cpf:  { cred_id: credCpfIdInWallet, revealed: true },
        attr_end:  { cred_id: credEndIdInWallet, revealed: true }
      },
      requested_predicates: {
        pred_idade_18: { cred_id: credCpfIdInWallet }
      }
    };

    const schemasMap = JSON.stringify({
      [schemaCpfId]: JSON.parse(schemaCpfJsonLedger),
      [schemaEndId]: JSON.parse(schemaEndJsonLedger)
    });

    const credDefsMap = JSON.stringify({
      [credDefCpfId]: JSON.parse(credDefCpfJsonLedger),
      [credDefEndId]: JSON.parse(credDefEndJsonLedger)
    });

    const presJson = await holder.createPresentation(
      JSON.stringify(presReqObj),
      JSON.stringify(requestedCreds),
      schemasMap,
      credDefsMap
    );

    const presFile = path.join(exchangeDir, "08_presentation.enc.json");
    await encryptToFile(holder, holderDid, issuerVerkey, presJson, presFile);

    console.log("19) Issuer lendo Presentation (arquivo) e verificando...");
    const presPlain = await decryptFromFile(issuer, issuerDid, holderVerkey, presFile);

    const ok = await issuer.verifyPresentation(
      JSON.stringify(presReqObj),
      presPlain,
      schemasMap,
      credDefsMap
    );

    if (!ok) throw new Error("❌ verifyPresentation retornou false.");

    console.log("✅ OK: apresentação validada (2 credenciais + ZKP idade>=18).");
    console.log("📝 Revealed:", JSON.parse(presPlain).requested_proof.revealed_attrs);
    console.log(`📁 Arquivos gerados em: ${exchangeDir}`);
  } finally {
    try { await issuer.walletClose(); } catch (_) {}
    try { await holder.walletClose(); } catch (_) {}
  }
})().catch((e) => {
  console.error("FALHA NO TESTE:", e?.message || e);
  console.error(e?.stack || "");
  process.exit(1);
});
