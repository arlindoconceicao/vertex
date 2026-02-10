/*
PARA RODAR ESTE TESTE:
TRUSTEE_SEED="000000000000000000000000Trustee1" \
TRUSTEE_DID="V4SGRU86Z58d6TV7PBUe6f" \
WALLET_PASS="minha_senha_teste" GENESIS_FILE=./genesis.txn \
node teste-node/presentations/teste_duas_credenciais_file_exchange_crypto_newdids.js

O QUE ESTE TESTE FAZ:
- NÃO usa ISSUER_SEED/HOLDER_SEED (DIDs criados via createOwnDid)
- Registra issuerDid/holderDid no ledger via Trustee
- Emite 2 credenciais (CPF e ENDERECO) com troca por ARQUIVOS CIFRADOS:
  Offer -> Request -> Credential -> Store receipt (para cada credencial)
- Depois cria Presentation com 2 credenciais e verifica (também via arquivos cifrados)
- Gera arquivos em: teste-node/presentations/exchange_2creds_newdids
*/

/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");

// ✅ index.node na raiz do projeto (teste-node/presentations -> ../../index.node)
const { IndyAgent } = require(path.join(__dirname, "..", "..", "index.node"));

// Remove artefatos da wallet (db + sidecar + wal/shm)
function rmIfExists(walletDbPath) {
  const sidecar = `${walletDbPath}.kdf.json`;
  try { fs.unlinkSync(walletDbPath); } catch (_) {}
  try { fs.unlinkSync(sidecar); } catch (_) {}
  try { fs.unlinkSync(`${sidecar}.tmp`); } catch (_) {}
  try { fs.unlinkSync(`${walletDbPath}-shm`); } catch (_) {}
  try { fs.unlinkSync(`${walletDbPath}-wal`); } catch (_) {}
}

// Env obrigatória
function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Env ${name} não definida.`);
  return v;
}

// write
function writeFileAtomic(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, data, "utf8");
}

// read
function readFileUtf8(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

// AuthCrypt -> arquivo (senderDid com privkey na wallet; recipientVerkey pub)
async function encryptToFile(senderAgent, senderDid, recipientVerkey, plaintext, filePath) {
  const encryptedJson = await senderAgent.encryptMessage(senderDid, recipientVerkey, plaintext);
  writeFileAtomic(filePath, encryptedJson);
}

// AuthDecrypt <- arquivo (receiverDid com privkey na wallet; senderVerkey pub)
async function decryptFromFile(receiverAgent, receiverDid, senderVerkey, filePath) {
  const encryptedJson = readFileUtf8(filePath);
  const plaintext = await receiverAgent.decryptMessage(receiverDid, senderVerkey, encryptedJson);
  return plaintext;
}

// Registra DID; se já existir no ledger, segue
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

/**
 * Fluxo completo por arquivo cifrado:
 * - issuer cria offer -> arquivo p/ holder
 * - holder lê offer, cria request -> arquivo p/ issuer
 * - issuer lê request, emite cred -> arquivo p/ holder
 * - holder lê cred, store -> receipt cifrado p/ issuer
 *
 * Retorna: { credIdInWallet, reqMetaId, credDefJsonLedger }
 */
async function issueOneCredentialViaFiles(params) {
  const {
    label,
    GENESIS_FILE,
    exchangeDir,
    issuer,
    holder,
    issuerDid,
    issuerVerkey,
    holderDid,
    holderVerkey,
    credDefId,
    credIdInWallet,
    valuesObj,
    filePrefix // ex: "cpf" ou "end"
  } = params;

  console.log(`${label}) Issuer criando Offer e gravando (cifrado)...`);
  const offerId = `offer-${filePrefix}-${Date.now()}`;
  const offerJson = await issuer.createCredentialOffer(credDefId, offerId);

  const offerFile = path.join(exchangeDir, `${filePrefix}_01_offer.enc.json`);
  await encryptToFile(issuer, issuerDid, holderVerkey, offerJson, offerFile);

  console.log(`${label + 1}) Holder lendo Offer, criando Request e gravando (cifrado)...`);
  const offerPlain = await decryptFromFile(holder, holderDid, issuerVerkey, offerFile);

  const offerObj = JSON.parse(offerPlain);
  const reqMetaId = offerObj?.nonce;
  if (!reqMetaId) throw new Error(`${filePrefix}: Offer sem nonce (reqMetaId).`);

  const credDefJsonLedger = await holder.fetchCredDefFromLedger(GENESIS_FILE, credDefId);

  const reqJson = await holder.createCredentialRequest(
    "default",
    holderDid,
    credDefJsonLedger,
    offerPlain
  );

  const reqFile = path.join(exchangeDir, `${filePrefix}_02_request.enc.json`);
  await encryptToFile(holder, holderDid, issuerVerkey, reqJson, reqFile);

  console.log(`${label + 2}) Issuer lendo Request, emitindo Credential e gravando (cifrado)...`);
  const reqPlain = await decryptFromFile(issuer, issuerDid, holderVerkey, reqFile);

  const credJson = await issuer.createCredential(
    credDefId,
    offerJson, // issuer tem localmente
    reqPlain,
    JSON.stringify(valuesObj)
  );

  const credFile = path.join(exchangeDir, `${filePrefix}_03_credential.enc.json`);
  await encryptToFile(issuer, issuerDid, holderVerkey, credJson, credFile);

  console.log(`${label + 3}) Holder lendo Credential, fazendo Store e gravando receipt (cifrado)...`);
  const credPlain = await decryptFromFile(holder, holderDid, issuerVerkey, credFile);

  await holder.storeCredential(
    credIdInWallet,
    credPlain,
    reqMetaId,
    credDefJsonLedger,
    null
  );

  const receipt = JSON.stringify({
    ok: true,
    step: "storeCredential",
    kind: filePrefix,
    cred_id: credIdInWallet,
    cred_def_id: credDefId
  });

  const receiptFile = path.join(exchangeDir, `${filePrefix}_04_store_receipt.enc.json`);
  await encryptToFile(holder, holderDid, issuerVerkey, receipt, receiptFile);

  console.log(`${label + 4}) Issuer lendo receipt do store (cifrado)...`);
  const receiptPlain = await decryptFromFile(issuer, issuerDid, holderVerkey, receiptFile);
  const receiptObj = JSON.parse(receiptPlain);
  if (!receiptObj?.ok) throw new Error(`${filePrefix}: receipt inválido.`);
  console.log(`✅ Store OK (${filePrefix}): cred_id=${receiptObj.cred_id}`);

  return { credIdInWallet, reqMetaId, credDefJsonLedger };
}

(async () => {
  const GENESIS_FILE = mustEnv("GENESIS_FILE");
  const WALLET_PASS = process.env.WALLET_PASS || "minha_senha_teste";

  // Trustee via ENV (necessário registrar NYM)
  const TRUSTEE_SEED = mustEnv("TRUSTEE_SEED");
  const TRUSTEE_DID = mustEnv("TRUSTEE_DID");

  // Pastas
  const walletsDir = path.join(__dirname, "..", "wallets");
  fs.mkdirSync(walletsDir, { recursive: true });

  const exchangeDir = path.join(__dirname, "exchange_2creds_newdids");
  fs.mkdirSync(exchangeDir, { recursive: true });

  // Wallets (reset)
  const issuerWalletPath = path.join(walletsDir, "issuer_2creds_files_newdids.db");
  const holderWalletPath = path.join(walletsDir, "holder_2creds_files_newdids.db");
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

    console.log("3) Conectando na rede...");
    await issuer.connectNetwork(GENESIS_FILE);
    await holder.connectNetwork(GENESIS_FILE);

    console.log("4) Importando Trustee DID no issuer...");
    await issuer.importDidFromSeed(TRUSTEE_SEED);

    console.log("5) Criando DID do emissor (createOwnDid)...");
    const [issuerDid, issuerVerkey] = await issuer.createOwnDid();

    console.log("6) Criando DID do holder (createOwnDid)...");
    const [holderDid, holderVerkey] = await holder.createOwnDid();

    console.log("7) Registrando DIDs no ledger (NYM) via Trustee...");
    await tryRegisterDid(issuer, GENESIS_FILE, TRUSTEE_DID, issuerDid, issuerVerkey, "ENDORSER");
    await tryRegisterDid(issuer, GENESIS_FILE, TRUSTEE_DID, holderDid, holderVerkey, null);

    // ============================================================
    // Schema + CredDef (2 credenciais)
    // ============================================================
    console.log("8) Criando+registrando Schema CPF...");
    const schemaCpfVer = `1.0.${Date.now()}`;
    const schemaCpfId = await issuer.createAndRegisterSchema(
      GENESIS_FILE,
      issuerDid,
      "cpf",
      schemaCpfVer,
      ["nome", "cpf", "idade"]
    );

    console.log("9) Criando+registrando Schema ENDERECO...");
    const schemaEndVer = `1.0.${Date.now()}`;
    const schemaEndId = await issuer.createAndRegisterSchema(
      GENESIS_FILE,
      issuerDid,
      "endereco",
      schemaEndVer,
      ["nome", "endereco", "cidade", "estado"]
    );

    console.log("10) Criando+registrando CredDef CPF...");
    const credDefCpfTag = `TAG_CPF_${Date.now()}`;
    const credDefCpfId = await issuer.createAndRegisterCredDef(
      GENESIS_FILE,
      issuerDid,
      schemaCpfId,
      credDefCpfTag
    );

    console.log("11) Criando+registrando CredDef ENDERECO...");
    const credDefEndTag = `TAG_END_${Date.now()}`;
    const credDefEndId = await issuer.createAndRegisterCredDef(
      GENESIS_FILE,
      issuerDid,
      schemaEndId,
      credDefEndTag
    );

    console.log("12) Garantindo Link Secret no holder...");
    try { await holder.createLinkSecret("default"); } catch (_) {}

    // ============================================================
    // Emissão 1: CPF (via arquivos cifrados)
    // ============================================================
    const valuesCpf = {
      nome: "Edimar Veríssimo",
      cpf: "123.456.789-09",
      idade: "35"
    };

    const credCpfIdInWallet = "cred-cpf-file";
    await issueOneCredentialViaFiles({
      label: 13,
      GENESIS_FILE,
      exchangeDir,
      issuer,
      holder,
      issuerDid,
      issuerVerkey,
      holderDid,
      holderVerkey,
      credDefId: credDefCpfId,
      credIdInWallet: credCpfIdInWallet,
      valuesObj: valuesCpf,
      filePrefix: "cpf"
    });

    // ============================================================
    // Emissão 2: ENDERECO (via arquivos cifrados)
    // ============================================================
    const valuesEnd = {
      nome: "Edimar Veríssimo",
      endereco: "Rua Exemplo, 123",
      cidade: "São Paulo",
      estado: "SP"
    };

    const credEndIdInWallet = "cred-end-file";
    await issueOneCredentialViaFiles({
      label: 18,
      GENESIS_FILE,
      exchangeDir,
      issuer,
      holder,
      issuerDid,
      issuerVerkey,
      holderDid,
      holderVerkey,
      credDefId: credDefEndId,
      credIdInWallet: credEndIdInWallet,
      valuesObj: valuesEnd,
      filePrefix: "end"
    });

    // ============================================================
    // PROVA: 2 credenciais (via arquivos cifrados)
    //   - nome + cpf -> cred CPF
    //   - endereco -> cred ENDERECO
    // ============================================================
    console.log("23) Issuer criando Proof Request (2 credenciais) e gravando p/ Holder...");
    const presReq = {
      nonce: String(Date.now()),
      name: "proof-cpf-endereco-2creds",
      version: "1.0",
      requested_attributes: {
        attr_nome: { name: "nome", restrictions: [{ cred_def_id: credDefCpfId }] },
        attr_cpf: { name: "cpf", restrictions: [{ cred_def_id: credDefCpfId }] },
        attr_endereco: { name: "endereco", restrictions: [{ cred_def_id: credDefEndId }] }
      },
      requested_predicates: {}
    };

    const presReqFile = path.join(exchangeDir, "proof_01_request.enc.json");
    await encryptToFile(issuer, issuerDid, holderVerkey, JSON.stringify(presReq), presReqFile);

    console.log("24) Holder lendo Proof Request, criando Presentation (2 creds)...");
    const presReqPlain = await decryptFromFile(holder, holderDid, issuerVerkey, presReqFile);
    const presReqObj = JSON.parse(presReqPlain);

    const schemaCpfJsonLedger = await holder.fetchSchemaFromLedger(GENESIS_FILE, schemaCpfId);
    const schemaEndJsonLedger = await holder.fetchSchemaFromLedger(GENESIS_FILE, schemaEndId);

    const credDefCpfJsonLedger = await holder.fetchCredDefFromLedger(GENESIS_FILE, credDefCpfId);
    const credDefEndJsonLedger = await holder.fetchCredDefFromLedger(GENESIS_FILE, credDefEndId);

    const requestedCreds = {
      requested_attributes: {
        attr_nome: { cred_id: credCpfIdInWallet, revealed: true },
        attr_cpf: { cred_id: credCpfIdInWallet, revealed: true },
        attr_endereco: { cred_id: credEndIdInWallet, revealed: true }
      },
      requested_predicates: {}
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

    const presFile = path.join(exchangeDir, "proof_02_presentation.enc.json");
    await encryptToFile(holder, holderDid, issuerVerkey, presJson, presFile);

    console.log("25) Issuer lendo Presentation (arquivo) e verificando...");
    const presPlain = await decryptFromFile(issuer, issuerDid, holderVerkey, presFile);

    const ok = await issuer.verifyPresentation(
      JSON.stringify(presReqObj),
      presPlain,
      schemasMap,
      credDefsMap
    );

    if (!ok) throw new Error("❌ verifyPresentation retornou false.");

    console.log("✅ OK: apresentação validada (2 credenciais).");
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
