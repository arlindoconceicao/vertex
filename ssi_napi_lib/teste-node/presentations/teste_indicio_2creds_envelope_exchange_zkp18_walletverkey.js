/*
PARA RODAR ESTE TESTE (INDICIO TESTNET) — VERSÃO COM ENVELOPES:
WALLET_PASS="minha_senha_teste" \
node teste-node/presentations/teste_indicio_2creds_envelope_exchange_zkp18_walletverkey.js

PRÉ-REQ:
- O arquivo ./indicio_testnet.txn deve existir (ou o teste baixa via genesisUrl).
- Este teste NÃO usa TRUSTEE. Usa apenas o ENDORSER (SUBMITTER) como issuer.
- Troca offline-first por ARQUIVOS, mas agora usando ENVELOPES (EnvelopeV1):
  offer/request/credential/proof_request/presentation via envelopePackAuthcrypt +
  envelopeUnpackAuto (sem decryptMessage).
- Ainda precisamos da verkey do SUBMITTER (issuer) para o sentido Holder->Issuer
  (recipient_verkey no pack), e ela vem da WALLET via getDid().
*/

/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const https = require("https");

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
// Envelopes: file exchange (AuthCrypt)
// -----------------------
async function packEnvelopeToFile(
  senderAgent,
  senderDid,
  recipientVerkey,
  kind,
  threadIdOrNull,
  plaintext,
  filePath,
  metaObjOrNull
) {
  const metaJson = metaObjOrNull ? JSON.stringify(metaObjOrNull) : null;

  const envJson = await senderAgent.envelopePackAuthcrypt(
    senderDid,
    recipientVerkey,
    kind,
    threadIdOrNull,
    plaintext,
    null,      // expires_at_ms (null = sem expiração)
    metaJson   // meta_json
  );

  writeFileAtomic(filePath, envJson);
}

async function unpackEnvelopeFromFile(receiverAgent, receiverDid, filePath) {
  const envJson = readFileUtf8(filePath);
  const plaintext = await receiverAgent.envelopeUnpackAuto(receiverDid, envJson);
  return plaintext;
}

// -----------------------
// Ledger: register DID (ignore if exists)
// -----------------------
async function tryRegisterDid(issuerAgent, GENESIS_FILE, submitterDid, did, verkey, role) {
  try {
    await issuerAgent.registerDidOnLedger(GENESIS_FILE, submitterDid, did, verkey, role);
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
  const SUBMITTER_SEED = process.env.SUBMITTER_SEED || "+0HGyElhOr/GuwUaDsyiTn926bFMrBUh";
  const SUBMITTER_DID  = process.env.SUBMITTER_DID  || "7DffLFWsgrwbt7T1Ni9cmu";

  await ensureGenesis(genesisUrl, genesisFile);

  const walletsDir = path.join(__dirname, "..", "wallets");
  fs.mkdirSync(walletsDir, { recursive: true });

  const exchangeDir = path.join(__dirname, "exchange_indicio_2creds_zkp18_envelope_walletverkey");
  fs.mkdirSync(exchangeDir, { recursive: true });

  // Wallets (reset)
  const issuerWalletPath = path.join(walletsDir, "issuer_indicio_2creds_envelopes.db");
  const holderWalletPath = path.join(walletsDir, "holder_indicio_2creds_envelopes.db");
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

    // issuer DID é o próprio SUBMITTER
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
    // EMISSÃO 1: CPF (Offer -> Request -> Credential -> Store) via ENVELOPES em arquivos
    // ============================================================
    console.log("15) Fluxo CPF via ENVELOPES em arquivos...");

    console.log("15.1) Issuer criando Offer (CPF) e gravando envelope...");
    const offerCpfId = `offer-cpf-${Date.now()}`;
    const offerCpfJson = await issuer.createCredentialOffer(credDefCpfId, offerCpfId);
    const offerCpfFile = path.join(exchangeDir, "01_offer_cpf.env.json");
    await packEnvelopeToFile(
      issuer, issuerDid, holderVerkey,
      "cred_offer_cpf", `th-cpf-${Date.now()}`,
      offerCpfJson, offerCpfFile,
      { step: "offer", kind: "cpf" }
    );

    console.log("15.2) Holder lendo Offer (CPF) via envelope e criando Request...");
    const offerCpfJsonPlain = await unpackEnvelopeFromFile(holder, holderDid, offerCpfFile);
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

    const reqCpfFile = path.join(exchangeDir, "02_request_cpf.env.json");
    await packEnvelopeToFile(
      holder, holderDid, issuerVerkey,
      "cred_req_cpf", `th-cpf-${Date.now()}`, // thread id pode ser novo; opcional
      reqCpfJson, reqCpfFile,
      { step: "request", kind: "cpf" }
    );

    console.log("15.3) Issuer lendo Request (CPF) via envelope e emitindo Credencial...");
    const reqCpfJsonPlain = await unpackEnvelopeFromFile(issuer, issuerDid, reqCpfFile);

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

    const credCpfFile = path.join(exchangeDir, "03_credential_cpf.env.json");
    await packEnvelopeToFile(
      issuer, issuerDid, holderVerkey,
      "cred_issue_cpf", `th-cpf-${Date.now()}`,
      credCpfJson, credCpfFile,
      { step: "credential", kind: "cpf" }
    );

    console.log("15.4) Holder lendo Credential (CPF) via envelope e armazenando...");
    const credCpfJsonPlain = await unpackEnvelopeFromFile(holder, holderDid, credCpfFile);

    const credCpfIdInWallet = "cred-cpf-env";
    await holder.storeCredential(
      credCpfIdInWallet,
      credCpfJsonPlain,
      reqMetaCpfId,
      credDefCpfJsonLedger,
      null
    );

    // ============================================================
    // EMISSÃO 2: ENDERECO (Offer -> Request -> Credential -> Store) via ENVELOPES em arquivos
    // ============================================================
    console.log("16) Fluxo ENDERECO via ENVELOPES em arquivos...");

    console.log("16.1) Issuer criando Offer (END) e gravando envelope...");
    const offerEndId = `offer-end-${Date.now()}`;
    const offerEndJson = await issuer.createCredentialOffer(credDefEndId, offerEndId);
    const offerEndFile = path.join(exchangeDir, "04_offer_end.env.json");
    await packEnvelopeToFile(
      issuer, issuerDid, holderVerkey,
      "cred_offer_end", `th-end-${Date.now()}`,
      offerEndJson, offerEndFile,
      { step: "offer", kind: "end" }
    );

    console.log("16.2) Holder lendo Offer (END) via envelope e criando Request...");
    const offerEndJsonPlain = await unpackEnvelopeFromFile(holder, holderDid, offerEndFile);
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

    const reqEndFile = path.join(exchangeDir, "05_request_end.env.json");
    await packEnvelopeToFile(
      holder, holderDid, issuerVerkey,
      "cred_req_end", `th-end-${Date.now()}`,
      reqEndJson, reqEndFile,
      { step: "request", kind: "end" }
    );

    console.log("16.3) Issuer lendo Request (END) via envelope e emitindo Credencial...");
    const reqEndJsonPlain = await unpackEnvelopeFromFile(issuer, issuerDid, reqEndFile);

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

    const credEndFile = path.join(exchangeDir, "06_credential_end.env.json");
    await packEnvelopeToFile(
      issuer, issuerDid, holderVerkey,
      "cred_issue_end", `th-end-${Date.now()}`,
      credEndJson, credEndFile,
      { step: "credential", kind: "end" }
    );

    console.log("16.4) Holder lendo Credential (END) via envelope e armazenando...");
    const credEndJsonPlain = await unpackEnvelopeFromFile(holder, holderDid, credEndFile);

    const credEndIdInWallet = "cred-end-env";
    await holder.storeCredential(
      credEndIdInWallet,
      credEndJsonPlain,
      reqMetaEndId,
      credDefEndJsonLedger,
      null
    );

    // ============================================================
    // PROVA: 2 credenciais + ZKP idade >= 18 (da cred CPF)
    // ============================================================
    console.log("17) Issuer criando Proof Request (2 creds + ZKP idade>=18) e gravando envelope...");
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

    const presReqFile = path.join(exchangeDir, "07_proof_request.env.json");
    await packEnvelopeToFile(
      issuer, issuerDid, holderVerkey,
      "proof_request", `th-proof-${Date.now()}`,
      JSON.stringify(presReq), presReqFile,
      { step: "proof_request" }
    );

    console.log("18) Holder lendo Proof Request via envelope e criando Presentation...");
    const presReqPlain = await unpackEnvelopeFromFile(holder, holderDid, presReqFile);
    const presReqObj = JSON.parse(presReqPlain);

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

    const presFile = path.join(exchangeDir, "08_presentation.env.json");
    await packEnvelopeToFile(
      holder, holderDid, issuerVerkey,
      "presentation", `th-proof-${Date.now()}`,
      presJson, presFile,
      { step: "presentation" }
    );

    console.log("19) Issuer lendo Presentation via envelope e verificando...");
    const presPlain = await unpackEnvelopeFromFile(issuer, issuerDid, presFile);

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
