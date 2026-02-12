/*
PARA RODAR ESTE TESTE:
TRUSTEE_SEED="000000000000000000000000Trustee1" \
TRUSTEE_DID="V4SGRU86Z58d6TV7PBUe6f" \
WALLET_PASS="minha_senha_teste" GENESIS_FILE=./genesis.txn \
node teste-node/presentations/teste_or_emissores_schema_creddef_strict_files_3creds_zkp18.js

O QUE ESTE TESTE FAZ (STRICT FILE EXCHANGE + OR DE EMISSORES):
- Cria 3 participantes com wallets isoladas: Issuer A, Issuer B, Holder
- Cria DIDs próprios (createOwnDid) para Issuer A, Issuer B e Holder
- Registra os 3 DIDs no ledger via Trustee (usando Issuer A como "submitter" do NYM)
- Cada emissor cria 3 Schemas e 3 CredDefs no ledger: CPF, ENDERECO, CONTATO
- Holder recebe e armazena 6 credenciais no total (3 de cada emissor) via troca por ARQUIVOS cifrados:
  Offer -> Request -> Credential -> Store receipt
- Proof Request exige OR de emissores, mas com schema_id + cred_def_id estritos por alternativa:
  restrictions: [ {issuer_did:A, schema_id:A..., cred_def_id:A...}, {issuer_did:B, schema_id:B..., cred_def_id:B...} ]
- Cria apresentação com 3 credenciais (misturadas entre emissores) e ZKP idade>=18
- Verifica apresentação no verificador (Issuer A, só para simplificar o papel do verificador)
- Gera arquivos em: teste-node/presentations/exchange_or_2issuers_3creds_zkp18_strict_files

IMPORTANTE:
- Objetos sensíveis trafegam apenas em arquivos cifrados (authcrypt).
- Bootstrap público com (did, verkey) de cada parte é escrito em JSON sem cifrar
  porque decryptMessage exige senderVerkey e não há anoncrypt no binding.
*/

/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");

const { IndyAgent } = require(path.join(__dirname, "..", "..", "index.node"));

// -------------------------
// Helpers FS / ENV
// -------------------------
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

function writeJson(filePath, obj) {
  writeFileAtomic(filePath, JSON.stringify(obj, null, 2));
}

function readJson(filePath) {
  return JSON.parse(readFileUtf8(filePath));
}

function pExchange(exchangeDir, name) {
  return path.join(exchangeDir, name);
}

// -------------------------
// Crypto file exchange (AuthCrypt)
// -------------------------
async function encryptToFile(senderAgent, senderDid, recipientVerkey, plaintext, filePath) {
  const encryptedJson = await senderAgent.encryptMessage(senderDid, recipientVerkey, plaintext);
  writeFileAtomic(filePath, encryptedJson);
}

async function decryptFromFile(receiverAgent, receiverDid, senderVerkey, filePath) {
  const encryptedJson = readFileUtf8(filePath);
  const plaintext = await receiverAgent.decryptMessage(receiverDid, senderVerkey, encryptedJson);
  return plaintext;
}

// -------------------------
// Ledger: register DID (ignore if exists)
// -------------------------
async function tryRegisterDid(agent, GENESIS_FILE, submitterDid, did, verkey, role) {
  try {
    await agent.registerDidOnLedger(GENESIS_FILE, submitterDid, did, verkey, role);
  } catch (e) {
    const msg = e?.message || String(e);
    if (/already exists|exists|DID.*exist|NYM.*exist|Ledger/i.test(msg)) {
      console.log(`ℹ️ DID já estava no ledger, seguindo: ${did}`);
      return;
    }
    throw e;
  }
}

// -------------------------
// Fluxo padrão Offer -> Request -> Credential -> Store (tudo por arquivo cifrado)
// -------------------------
async function issueAndStoreCredentialStrictFiles({
  kind,
  prefix,
  GENESIS_FILE,
  exchangeDir,
  issuerAgent,
  issuerPub,
  holderAgent,
  holderPub,
  credDefId,
  valuesObj,
  holderCredIdInWallet
}) {
  // 1) Offer (issuer -> holder)
  console.log(`${prefix}.1) Issuer criando Offer ${kind} e gravando (cifrado)...`);
  const offerId = `offer-${kind}-${Date.now()}`;
  const offerJson = await issuerAgent.createCredentialOffer(credDefId, offerId);

  const offerFile = pExchange(exchangeDir, `${kind}_01_offer_${prefix}.enc.json`);
  await encryptToFile(issuerAgent, issuerPub.did, holderPub.verkey, offerJson, offerFile);

  // 2) Request (holder -> issuer)
  console.log(`${prefix}.2) Holder lendo Offer ${kind} e criando Request (cifrado)...`);
  const offerPlain = await decryptFromFile(holderAgent, holderPub.did, issuerPub.verkey, offerFile);

  const offerObj = JSON.parse(offerPlain);
  const reqMetaId = offerObj?.nonce;
  if (!reqMetaId) throw new Error(`${kind}: Offer sem nonce (reqMetaId).`);

  const credDefJsonLedger = await holderAgent.fetchCredDefFromLedger(GENESIS_FILE, credDefId);

  const reqJson = await holderAgent.createCredentialRequest(
    "default",
    holderPub.did,
    credDefJsonLedger,
    offerPlain
  );

  const reqFile = pExchange(exchangeDir, `${kind}_02_request_${prefix}.enc.json`);
  await encryptToFile(holderAgent, holderPub.did, issuerPub.verkey, reqJson, reqFile);

  // 3) Credential (issuer -> holder)
  console.log(`${prefix}.3) Issuer lendo Request ${kind} e emitindo Credential (cifrado)...`);
  const reqPlain = await decryptFromFile(issuerAgent, issuerPub.did, holderPub.verkey, reqFile);

  const credJson = await issuerAgent.createCredential(
    credDefId,
    offerJson,
    reqPlain,
    JSON.stringify(valuesObj)
  );

  const credFile = pExchange(exchangeDir, `${kind}_03_credential_${prefix}.enc.json`);
  await encryptToFile(issuerAgent, issuerPub.did, holderPub.verkey, credJson, credFile);

  // 4) Store + receipt (holder -> issuer)
  console.log(`${prefix}.4) Holder lendo Credential ${kind} e fazendo Store + receipt (cifrado)...`);
  const credPlain = await decryptFromFile(holderAgent, holderPub.did, issuerPub.verkey, credFile);

  await holderAgent.storeCredential(
    holderCredIdInWallet,
    credPlain,
    reqMetaId,
    credDefJsonLedger,
    null
  );

  const receipt = JSON.stringify({
    ok: true,
    step: "storeCredential",
    kind,
    cred_id: holderCredIdInWallet,
    cred_def_id: credDefId
  });

  const receiptFile = pExchange(exchangeDir, `${kind}_04_store_receipt_${prefix}.enc.json`);
  await encryptToFile(holderAgent, holderPub.did, issuerPub.verkey, receipt, receiptFile);

  // Confirma receipt no issuer
  console.log(`${prefix}.5) Issuer lendo receipt ${kind} (cifrado)...`);
  const receiptPlain = await decryptFromFile(issuerAgent, issuerPub.did, holderPub.verkey, receiptFile);
  if (!JSON.parse(receiptPlain)?.ok) throw new Error(`${kind}: receipt inválido.`);

  console.log(`✅ Store OK (${kind}) [${prefix}] -> cred_id=${holderCredIdInWallet}`);
  return { reqMetaId, credDefJsonLedger };
}

// -------------------------
// MAIN
// -------------------------
(async () => {
  const GENESIS_FILE = mustEnv("GENESIS_FILE");
  const WALLET_PASS = process.env.WALLET_PASS || "minha_senha_teste";

  const TRUSTEE_SEED = mustEnv("TRUSTEE_SEED");
  const TRUSTEE_DID = mustEnv("TRUSTEE_DID");

  const walletsDir = path.join(__dirname, "..", "wallets");
  fs.mkdirSync(walletsDir, { recursive: true });

  const exchangeDir = path.join(__dirname, "exchange_or_2issuers_3creds_zkp18_strict_files");
  fs.mkdirSync(exchangeDir, { recursive: true });

  // Wallets (reset)
  const issuerAWalletPath = path.join(walletsDir, "issuerA_or_2issuers_3creds.db");
  const issuerBWalletPath = path.join(walletsDir, "issuerB_or_2issuers_3creds.db");
  const holderWalletPath  = path.join(walletsDir, "holder_or_2issuers_3creds.db");
  rmIfExists(issuerAWalletPath);
  rmIfExists(issuerBWalletPath);
  rmIfExists(holderWalletPath);

  // Agentes
  const issuerA = new IndyAgent();
  const issuerB = new IndyAgent();
  const holder  = new IndyAgent();

  // Bootstrap público (DID+verkey)
  const issuerAPubFile = pExchange(exchangeDir, "pub_issuerA.json");
  const issuerBPubFile = pExchange(exchangeDir, "pub_issuerB.json");
  const holderPubFile  = pExchange(exchangeDir, "pub_holder.json");

  // IDs do ledger (schemas/creddefs)
  const ledgerIdsFile   = pExchange(exchangeDir, "ledger_ids.json");

  try {
    // ============================================================
    // SETUP
    // ============================================================
    console.log("1) Criando wallets...");
    await issuerA.walletCreate(issuerAWalletPath, WALLET_PASS);
    await issuerB.walletCreate(issuerBWalletPath, WALLET_PASS);
    await holder.walletCreate(holderWalletPath, WALLET_PASS);

    console.log("2) Abrindo wallets...");
    await issuerA.walletOpen(issuerAWalletPath, WALLET_PASS);
    await issuerB.walletOpen(issuerBWalletPath, WALLET_PASS);
    await holder.walletOpen(holderWalletPath, WALLET_PASS);

    console.log("3) Conectando na rede...");
    await issuerA.connectNetwork(GENESIS_FILE);
    await issuerB.connectNetwork(GENESIS_FILE);
    await holder.connectNetwork(GENESIS_FILE);

    console.log("4) Importando Trustee DID no Issuer A (para registrar NYMs)...");
    await issuerA.importDidFromSeed(TRUSTEE_SEED);

    // ============================================================
    // DIDs próprios
    // ============================================================
    console.log("5) Issuer A criando DID (createOwnDid)...");
    const [issuerADid, issuerAVerkey] = await issuerA.createOwnDid();
    writeJson(issuerAPubFile, { did: issuerADid, verkey: issuerAVerkey });

    console.log("6) Issuer B criando DID (createOwnDid)...");
    const [issuerBDid, issuerBVerkey] = await issuerB.createOwnDid();
    writeJson(issuerBPubFile, { did: issuerBDid, verkey: issuerBVerkey });

    console.log("7) Holder criando DID (createOwnDid)...");
    const [holderDid, holderVerkey] = await holder.createOwnDid();
    writeJson(holderPubFile, { did: holderDid, verkey: holderVerkey });

    // ============================================================
    // Registrar NYMs via Trustee (usando issuerA como submitter do ledger)
    // ============================================================
    console.log("8) Registrando DIDs no ledger (NYM) via Trustee...");
    await tryRegisterDid(issuerA, GENESIS_FILE, TRUSTEE_DID, issuerADid, issuerAVerkey, "ENDORSER");
    await tryRegisterDid(issuerA, GENESIS_FILE, TRUSTEE_DID, issuerBDid, issuerBVerkey, "ENDORSER");
    await tryRegisterDid(issuerA, GENESIS_FILE, TRUSTEE_DID, holderDid,  holderVerkey,  null);

    // ============================================================
    // Schemas + CredDefs para cada emissor (3 tipos)
    // ============================================================
    console.log("9) Issuer A criando Schemas+CredDefs (CPF/END/CONTATO)...");
    const aSchemaCpfId = await issuerA.createAndRegisterSchema(GENESIS_FILE, issuerADid, "cpf",      `1.0.${Date.now()}`, ["nome", "cpf", "idade"]);
    const aSchemaEndId = await issuerA.createAndRegisterSchema(GENESIS_FILE, issuerADid, "endereco", `1.0.${Date.now()}`, ["nome", "endereco", "cidade", "estado"]);
    const aSchemaConId = await issuerA.createAndRegisterSchema(GENESIS_FILE, issuerADid, "contato",  `1.0.${Date.now()}`, ["nome", "email", "telefone"]);

    const aCredDefCpfId = await issuerA.createAndRegisterCredDef(GENESIS_FILE, issuerADid, aSchemaCpfId, `A_TAG_CPF_${Date.now()}`);
    const aCredDefEndId = await issuerA.createAndRegisterCredDef(GENESIS_FILE, issuerADid, aSchemaEndId, `A_TAG_END_${Date.now()}`);
    const aCredDefConId = await issuerA.createAndRegisterCredDef(GENESIS_FILE, issuerADid, aSchemaConId, `A_TAG_CON_${Date.now()}`);

    console.log("10) Issuer B criando Schemas+CredDefs (CPF/END/CONTATO)...");
    const bSchemaCpfId = await issuerB.createAndRegisterSchema(GENESIS_FILE, issuerBDid, "cpf",      `1.0.${Date.now()}`, ["nome", "cpf", "idade"]);
    const bSchemaEndId = await issuerB.createAndRegisterSchema(GENESIS_FILE, issuerBDid, "endereco", `1.0.${Date.now()}`, ["nome", "endereco", "cidade", "estado"]);
    const bSchemaConId = await issuerB.createAndRegisterSchema(GENESIS_FILE, issuerBDid, "contato",  `1.0.${Date.now()}`, ["nome", "email", "telefone"]);

    const bCredDefCpfId = await issuerB.createAndRegisterCredDef(GENESIS_FILE, issuerBDid, bSchemaCpfId, `B_TAG_CPF_${Date.now()}`);
    const bCredDefEndId = await issuerB.createAndRegisterCredDef(GENESIS_FILE, issuerBDid, bSchemaEndId, `B_TAG_END_${Date.now()}`);
    const bCredDefConId = await issuerB.createAndRegisterCredDef(GENESIS_FILE, issuerBDid, bSchemaConId, `B_TAG_CON_${Date.now()}`);

    writeJson(ledgerIdsFile, {
      issuerA: {
        did: issuerADid,
        schemaCpfId: aSchemaCpfId, schemaEndId: aSchemaEndId, schemaContatoId: aSchemaConId,
        credDefCpfId: aCredDefCpfId, credDefEndId: aCredDefEndId, credDefContatoId: aCredDefConId
      },
      issuerB: {
        did: issuerBDid,
        schemaCpfId: bSchemaCpfId, schemaEndId: bSchemaEndId, schemaContatoId: bSchemaConId,
        credDefCpfId: bCredDefCpfId, credDefEndId: bCredDefEndId, credDefContatoId: bCredDefConId
      }
    });

    console.log("11) Garantindo Link Secret no holder...");
    try { await holder.createLinkSecret("default"); } catch (_) {}

    // ============================================================
    // Bootstrap pub
    // ============================================================
    const pubA = readJson(issuerAPubFile);
    const pubB = readJson(issuerBPubFile);
    const pubH = readJson(holderPubFile);
    const ids  = readJson(ledgerIdsFile);

    // ============================================================
    // Emitir 6 credenciais (3 por emissor) - STRICT FILE EXCHANGE
    // ============================================================
    console.log("12) Emitindo 3 credenciais do Issuer A...");
    // ⚠️ idade como string numérica para ZKP
    await issueAndStoreCredentialStrictFiles({
      kind: "cpf",
      prefix: "A15",
      GENESIS_FILE,
      exchangeDir,
      issuerAgent: issuerA,
      issuerPub: pubA,
      holderAgent: holder,
      holderPub: pubH,
      credDefId: ids.issuerA.credDefCpfId,
      valuesObj: { nome: "Edimar Veríssimo", cpf: "123.456.789-09", idade: "35" },
      holderCredIdInWallet: "credA-cpf"
    });

    await issueAndStoreCredentialStrictFiles({
      kind: "end",
      prefix: "A16",
      GENESIS_FILE,
      exchangeDir,
      issuerAgent: issuerA,
      issuerPub: pubA,
      holderAgent: holder,
      holderPub: pubH,
      credDefId: ids.issuerA.credDefEndId,
      valuesObj: { nome: "Edimar Veríssimo", endereco: "Rua Exemplo, 123", cidade: "São Paulo", estado: "SP" },
      holderCredIdInWallet: "credA-end"
    });

    await issueAndStoreCredentialStrictFiles({
      kind: "contato",
      prefix: "A17",
      GENESIS_FILE,
      exchangeDir,
      issuerAgent: issuerA,
      issuerPub: pubA,
      holderAgent: holder,
      holderPub: pubH,
      credDefId: ids.issuerA.credDefContatoId,
      valuesObj: { nome: "Edimar Veríssimo", email: "edimar@example.com", telefone: "+55 11 99999-9999" },
      holderCredIdInWallet: "credA-contato"
    });

    console.log("13) Emitindo 3 credenciais do Issuer B...");
    await issueAndStoreCredentialStrictFiles({
      kind: "cpf",
      prefix: "B18",
      GENESIS_FILE,
      exchangeDir,
      issuerAgent: issuerB,
      issuerPub: pubB,
      holderAgent: holder,
      holderPub: pubH,
      credDefId: ids.issuerB.credDefCpfId,
      valuesObj: { nome: "Edimar Veríssimo", cpf: "123.456.789-09", idade: "35" },
      holderCredIdInWallet: "credB-cpf"
    });

    await issueAndStoreCredentialStrictFiles({
      kind: "end",
      prefix: "B19",
      GENESIS_FILE,
      exchangeDir,
      issuerAgent: issuerB,
      issuerPub: pubB,
      holderAgent: holder,
      holderPub: pubH,
      credDefId: ids.issuerB.credDefEndId,
      valuesObj: { nome: "Edimar Veríssimo", endereco: "Rua Exemplo, 123", cidade: "São Paulo", estado: "SP" },
      holderCredIdInWallet: "credB-end"
    });

    await issueAndStoreCredentialStrictFiles({
      kind: "contato",
      prefix: "B20",
      GENESIS_FILE,
      exchangeDir,
      issuerAgent: issuerB,
      issuerPub: pubB,
      holderAgent: holder,
      holderPub: pubH,
      credDefId: ids.issuerB.credDefContatoId,
      valuesObj: { nome: "Edimar Veríssimo", email: "edimar@example.com", telefone: "+55 11 99999-9999" },
      holderCredIdInWallet: "credB-contato"
    });

    // ============================================================
    // PROOF REQUEST com OR de emissores (2 alternativas por attr/pred)
    // mantendo schema_id + cred_def_id estritos em cada alternativa
    // ============================================================
    console.log("14) Verificador (Issuer A) criando Proof Request com OR de emissores e gravando (cifrado)...");

    // Restrição estrita por alternativa (A ou B)
    const rA_CPF = { issuer_did: ids.issuerA.did, schema_id: ids.issuerA.schemaCpfId, cred_def_id: ids.issuerA.credDefCpfId };
    const rB_CPF = { issuer_did: ids.issuerB.did, schema_id: ids.issuerB.schemaCpfId, cred_def_id: ids.issuerB.credDefCpfId };

    const rA_END = { issuer_did: ids.issuerA.did, schema_id: ids.issuerA.schemaEndId, cred_def_id: ids.issuerA.credDefEndId };
    const rB_END = { issuer_did: ids.issuerB.did, schema_id: ids.issuerB.schemaEndId, cred_def_id: ids.issuerB.credDefEndId };

    const rA_CON = { issuer_did: ids.issuerA.did, schema_id: ids.issuerA.schemaContatoId, cred_def_id: ids.issuerA.credDefContatoId };
    const rB_CON = { issuer_did: ids.issuerB.did, schema_id: ids.issuerB.schemaContatoId, cred_def_id: ids.issuerB.credDefContatoId };

    const presReq = {
      nonce: String(Date.now()),
      name: "proof-or-2issuers-3creds-zkp18",
      version: "1.0",
      requested_attributes: {
        // CPF (aceita Issuer A OU Issuer B)
        attr_nome:     { name: "nome",     restrictions: [rA_CPF, rB_CPF] },
        attr_cpf:      { name: "cpf",      restrictions: [rA_CPF, rB_CPF] },

        // END (aceita Issuer A OU Issuer B)
        attr_endereco: { name: "endereco", restrictions: [rA_END, rB_END] },

        // CONTATO (aceita Issuer A OU Issuer B)
        attr_email:    { name: "email",    restrictions: [rA_CON, rB_CON] },
        attr_telefone: { name: "telefone", restrictions: [rA_CON, rB_CON] }
      },
      requested_predicates: {
        pred_idade_ge_18: {
          name: "idade",
          p_type: ">=",
          p_value: 18,
          restrictions: [rA_CPF, rB_CPF]
        }
      }
    };

    const proofReqFile = pExchange(exchangeDir, "proof_01_request.enc.json");
    // verificador é issuerA só por conveniência do teste
    await encryptToFile(issuerA, pubA.did, pubH.verkey, JSON.stringify(presReq), proofReqFile);

    // ============================================================
    // Holder cria Presentation misturando emissores (prova do OR)
    // - CPF: Issuer B
    // - ENDERECO: Issuer A
    // - CONTATO: Issuer B
    // ============================================================
    console.log("15) Holder lendo Proof Request (cifrado), criando Presentation (OR de emissores + ZKP)...");
    const presReqPlain = await decryptFromFile(holder, pubH.did, pubA.verkey, proofReqFile);
    const presReqObj = JSON.parse(presReqPlain);

    const requestedCreds = {
      requested_attributes: {
        // CPF do Issuer B
        attr_nome:     { cred_id: "credB-cpf", revealed: true },
        attr_cpf:      { cred_id: "credB-cpf", revealed: true },

        // END do Issuer A
        attr_endereco: { cred_id: "credA-end", revealed: true },

        // CONTATO do Issuer B
        attr_email:    { cred_id: "credB-contato", revealed: true },
        attr_telefone: { cred_id: "credB-contato", revealed: true }
      },
      requested_predicates: {
        pred_idade_ge_18: { cred_id: "credB-cpf" }
      }
    };

    // Holder precisa fornecer TODOS os schemas/creddefs referenciáveis (A e B),
    // porque o verificador pode validar qualquer uma das alternativas.
    const schemaCpfA = await holder.fetchSchemaFromLedger(GENESIS_FILE, ids.issuerA.schemaCpfId);
    const schemaEndA = await holder.fetchSchemaFromLedger(GENESIS_FILE, ids.issuerA.schemaEndId);
    const schemaConA = await holder.fetchSchemaFromLedger(GENESIS_FILE, ids.issuerA.schemaContatoId);

    const schemaCpfB = await holder.fetchSchemaFromLedger(GENESIS_FILE, ids.issuerB.schemaCpfId);
    const schemaEndB = await holder.fetchSchemaFromLedger(GENESIS_FILE, ids.issuerB.schemaEndId);
    const schemaConB = await holder.fetchSchemaFromLedger(GENESIS_FILE, ids.issuerB.schemaContatoId);

    const credDefCpfA = await holder.fetchCredDefFromLedger(GENESIS_FILE, ids.issuerA.credDefCpfId);
    const credDefEndA = await holder.fetchCredDefFromLedger(GENESIS_FILE, ids.issuerA.credDefEndId);
    const credDefConA = await holder.fetchCredDefFromLedger(GENESIS_FILE, ids.issuerA.credDefContatoId);

    const credDefCpfB = await holder.fetchCredDefFromLedger(GENESIS_FILE, ids.issuerB.credDefCpfId);
    const credDefEndB = await holder.fetchCredDefFromLedger(GENESIS_FILE, ids.issuerB.credDefEndId);
    const credDefConB = await holder.fetchCredDefFromLedger(GENESIS_FILE, ids.issuerB.credDefContatoId);

    const schemasMap = JSON.stringify({
      [ids.issuerA.schemaCpfId]: JSON.parse(schemaCpfA),
      [ids.issuerA.schemaEndId]: JSON.parse(schemaEndA),
      [ids.issuerA.schemaContatoId]: JSON.parse(schemaConA),

      [ids.issuerB.schemaCpfId]: JSON.parse(schemaCpfB),
      [ids.issuerB.schemaEndId]: JSON.parse(schemaEndB),
      [ids.issuerB.schemaContatoId]: JSON.parse(schemaConB)
    });

    const credDefsMap = JSON.stringify({
      [ids.issuerA.credDefCpfId]: JSON.parse(credDefCpfA),
      [ids.issuerA.credDefEndId]: JSON.parse(credDefEndA),
      [ids.issuerA.credDefContatoId]: JSON.parse(credDefConA),

      [ids.issuerB.credDefCpfId]: JSON.parse(credDefCpfB),
      [ids.issuerB.credDefEndId]: JSON.parse(credDefEndB),
      [ids.issuerB.credDefContatoId]: JSON.parse(credDefConB)
    });

    const presJson = await holder.createPresentation(
      JSON.stringify(presReqObj),
      JSON.stringify(requestedCreds),
      schemasMap,
      credDefsMap
    );

    const presFile = pExchange(exchangeDir, "proof_02_presentation.enc.json");
    await encryptToFile(holder, pubH.did, pubA.verkey, presJson, presFile);

    // ============================================================
    // Verificação (no verificador/issuerA)
    // ============================================================
    console.log("16) Verificador (Issuer A) lendo Presentation (cifrado) e verificando...");
    const presPlain = await decryptFromFile(issuerA, pubA.did, pubH.verkey, presFile);

    const ok = await issuerA.verifyPresentation(
      JSON.stringify(presReqObj),
      presPlain,
      schemasMap,
      credDefsMap
    );

    if (!ok) throw new Error("❌ verifyPresentation retornou false.");

    console.log("✅ OK: apresentação validada (OR de emissores + schema_id+cred_def_id estritos + ZKP idade>=18).");

    const presObj = JSON.parse(presPlain);
    console.log("📝 Revealed:", presObj.requested_proof?.revealed_attrs);
    console.log("🧮 Predicates:", presObj.requested_proof?.predicates);
    console.log("🔎 Identifiers (sub_proofs):", presObj.identifiers);
    console.log(`📁 Arquivos gerados em: ${exchangeDir}`);

  } finally {
    try { await issuerA.walletClose(); } catch (_) {}
    try { await issuerB.walletClose(); } catch (_) {}
    try { await holder.walletClose(); } catch (_) {}
  }
})().catch((e) => {
  console.error("FALHA NO TESTE:", e?.message || e);
  console.error(e?.stack || "");
  process.exit(1);
});
