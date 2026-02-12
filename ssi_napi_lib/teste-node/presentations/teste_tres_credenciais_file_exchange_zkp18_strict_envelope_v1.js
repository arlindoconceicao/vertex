/*
PARA RODAR ESTE TESTE:
TRUSTEE_SEED="000000000000000000000000Trustee1" \
TRUSTEE_DID="V4SGRU86Z58d6TV7PBUe6f" \
WALLET_PASS="minha_senha_teste" GENESIS_FILE=./genesis.txn \
node teste-node/presentations/teste_tres_credenciais_file_exchange_zkp18_strict_envelope_v1.js

O QUE ESTE TESTE FAZ (STRICT FILE EXCHANGE COM ENVELOPE v1):
- Cria DIDs do issuer e do holder via createOwnDid()
- Registra ambos no ledger via Trustee
- Emite 3 credenciais (CPF, ENDERECO, CONTATO) com troca somente por ARQUIVOS:
  Offer -> Request -> Credential -> Store receipt
- Cria uma prova com 3 credenciais e predicado ZKP: idade >= 18 (sem revelar idade)
- Troca Proof Request e Presentation também por arquivos

IMPORTANTE:
- Objetos sensíveis trafegam como Envelope v1 com authcrypt:
  Offer/Request/Credential/ProofRequest/Presentation/Receipts
- Objetos públicos (bootstrap did+verkey e ledger_ids) trafegam como Envelope v1 mode=none.
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

// -------------------------
// Envelope FS exchange
// -------------------------
function pExchange(exchangeDir, name) {
  return path.join(exchangeDir, name);
}

async function writeEnvNone(agent, kind, threadId, objOrString, filePath, meta) {
  const plaintext = typeof objOrString === "string" ? objOrString : JSON.stringify(objOrString);
  const envJson = agent.envelopePackNone(
    kind,
    threadId || null,
    plaintext,
    null,
    meta ? JSON.stringify(meta) : null
  );
  writeFileAtomic(filePath, envJson);
  return envJson;
}

async function readEnvNone(agent, filePath) {
  const envJson = readFileUtf8(filePath);
  // mode=none não precisa wallet; receiver_did é irrelevante
  const plaintext = await agent.envelopeUnpackAuto("DUMMY_DID_NOT_USED_IN_NONE", envJson);
  return plaintext;
}

async function sendAuthcryptToFile(agent, senderDid, recipientVerkey, kind, threadId, plaintext, filePath, meta, expiresAtMs) {
  const envJson = await agent.envelopePackAuthcrypt(
    senderDid,
    recipientVerkey,
    kind,
    threadId || null,
    plaintext,
    expiresAtMs ?? null,
    meta ? JSON.stringify(meta) : null
  );
  writeFileAtomic(filePath, envJson);
  return envJson;
}

async function recvFromFile(agent, receiverDid, filePath) {
  const envJson = readFileUtf8(filePath);
  const plaintext = await agent.envelopeUnpackAuto(receiverDid, envJson);
  return plaintext;
}

// -------------------------
// Ledger: register DID (ignore if exists)
// -------------------------
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

  const exchangeRoot = path.join(__dirname, "exchange_3creds_zkp18_strict_envelope_v1");
  fs.mkdirSync(exchangeRoot, { recursive: true });

  // Um threadId por sessão (fica fácil de inspecionar)
  const threadId = `th_3creds_zkp18_${Date.now()}`;
  const exchangeDir = path.join(exchangeRoot, threadId);
  fs.mkdirSync(exchangeDir, { recursive: true });

  // Wallets (reset)
  const issuerWalletPath = path.join(walletsDir, "issuer_3creds_zkp18_strict_envelope_v1.db");
  const holderWalletPath = path.join(walletsDir, "holder_3creds_zkp18_strict_envelope_v1.db");
  rmIfExists(issuerWalletPath);
  rmIfExists(holderWalletPath);

  // Agentes
  const issuer = new IndyAgent();
  const holder = new IndyAgent();

  // Bootstrap público (Envelope none)
  const issuerPubEnvFile = pExchange(exchangeDir, "00_pub_issuer.env.json");
  const holderPubEnvFile = pExchange(exchangeDir, "00_pub_holder.env.json");
  const ledgerIdsEnvFile = pExchange(exchangeDir, "00_ledger_ids.env.json");

  try {
    // ============================================================
    // SETUP INDEPENDENTE
    // ============================================================
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

    // ============================================================
    // 1) DIDs (issuer + holder) + registrar no ledger
    // ============================================================
    console.log("5) Issuer criando DID (createOwnDid)...");
    const [issuerDid, issuerVerkey] = await issuer.createOwnDid();
    await writeEnvNone(
      issuer,
      "pub/bootstrap",
      threadId,
      { did: issuerDid, verkey: issuerVerkey },
      issuerPubEnvFile,
      { role: "issuer" }
    );

    console.log("6) Holder criando DID (createOwnDid)...");
    const [holderDid, holderVerkey] = await holder.createOwnDid();
    await writeEnvNone(
      holder,
      "pub/bootstrap",
      threadId,
      { did: holderDid, verkey: holderVerkey },
      holderPubEnvFile,
      { role: "holder" }
    );

    console.log("7) Registrando DIDs no ledger (NYM) via Trustee...");
    await tryRegisterDid(issuer, GENESIS_FILE, TRUSTEE_DID, issuerDid, issuerVerkey, "ENDORSER");
    await tryRegisterDid(issuer, GENESIS_FILE, TRUSTEE_DID, holderDid, holderVerkey, null);

    // ============================================================
    // 2) Criar 3 Schemas + 3 CredDefs e gravar IDs em envelope none
    // ============================================================
    console.log("8) Issuer criando+registrando Schema CPF...");
    const schemaCpfVer = `1.0.${Date.now()}`;
    const schemaCpfId = await issuer.createAndRegisterSchema(
      GENESIS_FILE,
      issuerDid,
      "cpf",
      schemaCpfVer,
      ["nome", "cpf", "idade"]
    );

    console.log("9) Issuer criando+registrando Schema ENDERECO...");
    const schemaEndVer = `1.0.${Date.now()}`;
    const schemaEndId = await issuer.createAndRegisterSchema(
      GENESIS_FILE,
      issuerDid,
      "endereco",
      schemaEndVer,
      ["nome", "endereco", "cidade", "estado"]
    );

    console.log("10) Issuer criando+registrando Schema CONTATO...");
    const schemaContatoVer = `1.0.${Date.now()}`;
    const schemaContatoId = await issuer.createAndRegisterSchema(
      GENESIS_FILE,
      issuerDid,
      "contato",
      schemaContatoVer,
      ["nome", "email", "telefone"]
    );

    console.log("11) Issuer criando+registrando CredDef CPF...");
    const credDefCpfTag = `TAG_CPF_${Date.now()}`;
    const credDefCpfId = await issuer.createAndRegisterCredDef(
      GENESIS_FILE,
      issuerDid,
      schemaCpfId,
      credDefCpfTag
    );

    console.log("12) Issuer criando+registrando CredDef ENDERECO...");
    const credDefEndTag = `TAG_END_${Date.now()}`;
    const credDefEndId = await issuer.createAndRegisterCredDef(
      GENESIS_FILE,
      issuerDid,
      schemaEndId,
      credDefEndTag
    );

    console.log("13) Issuer criando+registrando CredDef CONTATO...");
    const credDefContatoTag = `TAG_CONTATO_${Date.now()}`;
    const credDefContatoId = await issuer.createAndRegisterCredDef(
      GENESIS_FILE,
      issuerDid,
      schemaContatoId,
      credDefContatoTag
    );

    await writeEnvNone(
      issuer,
      "ledger/ids",
      threadId,
      {
        schemaCpfId,
        schemaEndId,
        schemaContatoId,
        credDefCpfId,
        credDefEndId,
        credDefContatoId,
      },
      ledgerIdsEnvFile,
      { note: "IDs de schema/creddef usados na sessão" }
    );

    console.log("14) Garantindo Link Secret no holder...");
    try { await holder.createLinkSecret("default"); } catch (_) {}

    // Lê bootstrap público e IDs do ledger (por envelope none)
    const issuerPub = JSON.parse(await readEnvNone(issuer, issuerPubEnvFile));
    const holderPub = JSON.parse(await readEnvNone(holder, holderPubEnvFile));
    const ids = JSON.parse(await readEnvNone(issuer, ledgerIdsEnvFile));

    // ============================================================
    // FLUXO 1: CPF
    // ============================================================
    console.log("15) Fluxo CPF (Envelope authcrypt via arquivos)...");

    console.log("15.1) Issuer criando Offer CPF e gravando (env authcrypt)...");
    const offerCpfId = `offer-cpf-${Date.now()}`;
    const offerCpfJson = await issuer.createCredentialOffer(ids.credDefCpfId, offerCpfId);
    const cpfOfferFile = pExchange(exchangeDir, "15_01_cpf_offer.env.json");
    await sendAuthcryptToFile(
      issuer,
      issuerPub.did,
      holderPub.verkey,
      "anoncreds/credential_offer",
      threadId,
      offerCpfJson,
      cpfOfferFile,
      { kind: "cpf" }
    );

    console.log("15.2) Holder lendo Offer CPF (env), criando Request (env)...");
    const offerCpfPlain = await recvFromFile(holder, holderPub.did, cpfOfferFile);
    const offerCpfObj = JSON.parse(offerCpfPlain);
    const reqMetaCpfId = offerCpfObj?.nonce;
    if (!reqMetaCpfId) throw new Error("CPF: Offer sem nonce (reqMetaId).");

    const credDefCpfJsonLedger = await holder.fetchCredDefFromLedger(GENESIS_FILE, ids.credDefCpfId);
    const reqCpfJson = await holder.createCredentialRequest(
      "default",
      holderPub.did,
      credDefCpfJsonLedger,
      offerCpfPlain
    );

    const cpfReqFile = pExchange(exchangeDir, "15_02_cpf_request.env.json");
    await sendAuthcryptToFile(
      holder,
      holderPub.did,
      issuerPub.verkey,
      "anoncreds/credential_request",
      threadId,
      reqCpfJson,
      cpfReqFile,
      { kind: "cpf" }
    );

    console.log("15.3) Issuer lendo Request CPF (env) e emitindo Credential (env)...");
    const reqCpfPlain = await recvFromFile(issuer, issuerPub.did, cpfReqFile);

    // ⚠️ Para predicado/ZKP: idade deve ser "string numérica"
    const valuesCpf = {
      nome: "Edimar Veríssimo",
      cpf: "123.456.789-09",
      idade: "35",
    };

    const credCpfJson = await issuer.createCredential(
      ids.credDefCpfId,
      offerCpfJson,
      reqCpfPlain,
      JSON.stringify(valuesCpf)
    );

    const cpfCredFile = pExchange(exchangeDir, "15_03_cpf_credential.env.json");
    await sendAuthcryptToFile(
      issuer,
      issuerPub.did,
      holderPub.verkey,
      "anoncreds/credential",
      threadId,
      credCpfJson,
      cpfCredFile,
      { kind: "cpf" }
    );

    console.log("15.4) Holder lendo Credential CPF (env) e fazendo Store + receipt (env)...");
    const credCpfPlain = await recvFromFile(holder, holderPub.did, cpfCredFile);

    const credCpfIdInWallet = "cred-cpf-envelope";
    await holder.storeCredential(
      credCpfIdInWallet,
      credCpfPlain,
      reqMetaCpfId,
      credDefCpfJsonLedger,
      null
    );

    const cpfReceipt = JSON.stringify({
      ok: true,
      step: "storeCredential",
      kind: "cpf",
      cred_id: credCpfIdInWallet,
      cred_def_id: ids.credDefCpfId,
    });

    const cpfReceiptFile = pExchange(exchangeDir, "15_04_cpf_store_receipt.env.json");
    await sendAuthcryptToFile(
      holder,
      holderPub.did,
      issuerPub.verkey,
      "anoncreds/store_receipt",
      threadId,
      cpfReceipt,
      cpfReceiptFile,
      { kind: "cpf" }
    );

    console.log("15.5) Issuer lendo receipt CPF (env)...");
    const cpfReceiptPlain = await recvFromFile(issuer, issuerPub.did, cpfReceiptFile);
    if (!JSON.parse(cpfReceiptPlain)?.ok) throw new Error("CPF: receipt inválido.");
    console.log("✅ Store OK (CPF).");

    // ============================================================
    // FLUXO 2: ENDERECO
    // ============================================================
    console.log("16) Fluxo ENDERECO (Envelope authcrypt via arquivos)...");

    console.log("16.1) Issuer criando Offer END (env)...");
    const offerEndId = `offer-end-${Date.now()}`;
    const offerEndJson = await issuer.createCredentialOffer(ids.credDefEndId, offerEndId);
    const endOfferFile = pExchange(exchangeDir, "16_01_end_offer.env.json");
    await sendAuthcryptToFile(
      issuer,
      issuerPub.did,
      holderPub.verkey,
      "anoncreds/credential_offer",
      threadId,
      offerEndJson,
      endOfferFile,
      { kind: "endereco" }
    );

    console.log("16.2) Holder lendo Offer END (env) e criando Request (env)...");
    const offerEndPlain = await recvFromFile(holder, holderPub.did, endOfferFile);
    const offerEndObj = JSON.parse(offerEndPlain);
    const reqMetaEndId = offerEndObj?.nonce;
    if (!reqMetaEndId) throw new Error("END: Offer sem nonce (reqMetaId).");

    const credDefEndJsonLedger = await holder.fetchCredDefFromLedger(GENESIS_FILE, ids.credDefEndId);

    const reqEndJson = await holder.createCredentialRequest(
      "default",
      holderPub.did,
      credDefEndJsonLedger,
      offerEndPlain
    );

    const endReqFile = pExchange(exchangeDir, "16_02_end_request.env.json");
    await sendAuthcryptToFile(
      holder,
      holderPub.did,
      issuerPub.verkey,
      "anoncreds/credential_request",
      threadId,
      reqEndJson,
      endReqFile,
      { kind: "endereco" }
    );

    console.log("16.3) Issuer lendo Request END (env) e emitindo Credential (env)...");
    const reqEndPlain = await recvFromFile(issuer, issuerPub.did, endReqFile);

    const valuesEnd = {
      nome: "Edimar Veríssimo",
      endereco: "Rua Exemplo, 123",
      cidade: "São Paulo",
      estado: "SP",
    };

    const credEndJson = await issuer.createCredential(
      ids.credDefEndId,
      offerEndJson,
      reqEndPlain,
      JSON.stringify(valuesEnd)
    );

    const endCredFile = pExchange(exchangeDir, "16_03_end_credential.env.json");
    await sendAuthcryptToFile(
      issuer,
      issuerPub.did,
      holderPub.verkey,
      "anoncreds/credential",
      threadId,
      credEndJson,
      endCredFile,
      { kind: "endereco" }
    );

    console.log("16.4) Holder lendo Credential END (env) e Store + receipt (env)...");
    const credEndPlain = await recvFromFile(holder, holderPub.did, endCredFile);

    const credEndIdInWallet = "cred-end-envelope";
    await holder.storeCredential(
      credEndIdInWallet,
      credEndPlain,
      reqMetaEndId,
      credDefEndJsonLedger,
      null
    );

    const endReceipt = JSON.stringify({
      ok: true,
      step: "storeCredential",
      kind: "endereco",
      cred_id: credEndIdInWallet,
      cred_def_id: ids.credDefEndId,
    });

    const endReceiptFile = pExchange(exchangeDir, "16_04_end_store_receipt.env.json");
    await sendAuthcryptToFile(
      holder,
      holderPub.did,
      issuerPub.verkey,
      "anoncreds/store_receipt",
      threadId,
      endReceipt,
      endReceiptFile,
      { kind: "endereco" }
    );

    console.log("16.5) Issuer lendo receipt END (env)...");
    const endReceiptPlain = await recvFromFile(issuer, issuerPub.did, endReceiptFile);
    if (!JSON.parse(endReceiptPlain)?.ok) throw new Error("END: receipt inválido.");
    console.log("✅ Store OK (END).");

    // ============================================================
    // FLUXO 3: CONTATO
    // ============================================================
    console.log("17) Fluxo CONTATO (Envelope authcrypt via arquivos)...");

    console.log("17.1) Issuer criando Offer CONTATO (env)...");
    const offerContatoId = `offer-contato-${Date.now()}`;
    const offerContatoJson = await issuer.createCredentialOffer(ids.credDefContatoId, offerContatoId);
    const contatoOfferFile = pExchange(exchangeDir, "17_01_contato_offer.env.json");
    await sendAuthcryptToFile(
      issuer,
      issuerPub.did,
      holderPub.verkey,
      "anoncreds/credential_offer",
      threadId,
      offerContatoJson,
      contatoOfferFile,
      { kind: "contato" }
    );

    console.log("17.2) Holder lendo Offer CONTATO (env) e criando Request (env)...");
    const offerContatoPlain = await recvFromFile(holder, holderPub.did, contatoOfferFile);
    const offerContatoObj = JSON.parse(offerContatoPlain);
    const reqMetaContatoId = offerContatoObj?.nonce;
    if (!reqMetaContatoId) throw new Error("CONTATO: Offer sem nonce (reqMetaId).");

    const credDefContatoJsonLedger = await holder.fetchCredDefFromLedger(GENESIS_FILE, ids.credDefContatoId);

    const reqContatoJson = await holder.createCredentialRequest(
      "default",
      holderPub.did,
      credDefContatoJsonLedger,
      offerContatoPlain
    );

    const contatoReqFile = pExchange(exchangeDir, "17_02_contato_request.env.json");
    await sendAuthcryptToFile(
      holder,
      holderPub.did,
      issuerPub.verkey,
      "anoncreds/credential_request",
      threadId,
      reqContatoJson,
      contatoReqFile,
      { kind: "contato" }
    );

    console.log("17.3) Issuer lendo Request CONTATO (env) e emitindo Credential (env)...");
    const reqContatoPlain = await recvFromFile(issuer, issuerPub.did, contatoReqFile);

    const valuesContato = {
      nome: "Edimar Veríssimo",
      email: "edimar@example.com",
      telefone: "+55 11 99999-9999",
    };

    const credContatoJson = await issuer.createCredential(
      ids.credDefContatoId,
      offerContatoJson,
      reqContatoPlain,
      JSON.stringify(valuesContato)
    );

    const contatoCredFile = pExchange(exchangeDir, "17_03_contato_credential.env.json");
    await sendAuthcryptToFile(
      issuer,
      issuerPub.did,
      holderPub.verkey,
      "anoncreds/credential",
      threadId,
      credContatoJson,
      contatoCredFile,
      { kind: "contato" }
    );

    console.log("17.4) Holder lendo Credential CONTATO (env) e Store + receipt (env)...");
    const credContatoPlain = await recvFromFile(holder, holderPub.did, contatoCredFile);

    const credContatoIdInWallet = "cred-contato-envelope";
    await holder.storeCredential(
      credContatoIdInWallet,
      credContatoPlain,
      reqMetaContatoId,
      credDefContatoJsonLedger,
      null
    );

    const contatoReceipt = JSON.stringify({
      ok: true,
      step: "storeCredential",
      kind: "contato",
      cred_id: credContatoIdInWallet,
      cred_def_id: ids.credDefContatoId,
    });

    const contatoReceiptFile = pExchange(exchangeDir, "17_04_contato_store_receipt.env.json");
    await sendAuthcryptToFile(
      holder,
      holderPub.did,
      issuerPub.verkey,
      "anoncreds/store_receipt",
      threadId,
      contatoReceipt,
      contatoReceiptFile,
      { kind: "contato" }
    );

    console.log("17.5) Issuer lendo receipt CONTATO (env)...");
    const contatoReceiptPlain = await recvFromFile(issuer, issuerPub.did, contatoReceiptFile);
    if (!JSON.parse(contatoReceiptPlain)?.ok) throw new Error("CONTATO: receipt inválido.");
    console.log("✅ Store OK (CONTATO).");

    // ============================================================
    // PROVA (3 credenciais + ZKP idade>=18) via envelopes
    // ============================================================
    console.log("18) Issuer criando Proof Request e gravando (env authcrypt)...");

    const presReq = {
      nonce: String(Date.now()),
      name: "proof-3creds-zkp18",
      version: "1.0",
      requested_attributes: {
        attr_nome: { name: "nome", restrictions: [{ cred_def_id: ids.credDefCpfId }] },
        attr_cpf: { name: "cpf", restrictions: [{ cred_def_id: ids.credDefCpfId }] },

        attr_endereco: { name: "endereco", restrictions: [{ cred_def_id: ids.credDefEndId }] },

        attr_email: { name: "email", restrictions: [{ cred_def_id: ids.credDefContatoId }] },
        attr_telefone: { name: "telefone", restrictions: [{ cred_def_id: ids.credDefContatoId }] },
      },
      requested_predicates: {
        pred_idade_ge_18: {
          name: "idade",
          p_type: ">=",
          p_value: 18,
          restrictions: [{ cred_def_id: ids.credDefCpfId }],
        },
      },
    };

    const proofReqFile = pExchange(exchangeDir, "18_01_proof_request.env.json");
    await sendAuthcryptToFile(
      issuer,
      issuerPub.did,
      holderPub.verkey,
      "anoncreds/proof_request",
      threadId,
      JSON.stringify(presReq),
      proofReqFile,
      { phase: "proof_request" }
    );

    console.log("19) Holder lendo Proof Request (env), criando Presentation (env)...");
    const presReqPlain = await recvFromFile(holder, holderPub.did, proofReqFile);
    const presReqObj = JSON.parse(presReqPlain);

    // Busca schemas/creddefs do ledger
    const schemaCpfJsonLedger = await holder.fetchSchemaFromLedger(GENESIS_FILE, ids.schemaCpfId);
    const schemaEndJsonLedger = await holder.fetchSchemaFromLedger(GENESIS_FILE, ids.schemaEndId);
    const schemaContatoJsonLedger = await holder.fetchSchemaFromLedger(GENESIS_FILE, ids.schemaContatoId);

    const credDefCpfJsonLedger2 = await holder.fetchCredDefFromLedger(GENESIS_FILE, ids.credDefCpfId);
    const credDefEndJsonLedger2 = await holder.fetchCredDefFromLedger(GENESIS_FILE, ids.credDefEndId);
    const credDefContatoJsonLedger2 = await holder.fetchCredDefFromLedger(GENESIS_FILE, ids.credDefContatoId);

    const requestedCreds = {
      requested_attributes: {
        attr_nome: { cred_id: credCpfIdInWallet, revealed: true },
        attr_cpf: { cred_id: credCpfIdInWallet, revealed: true },

        attr_endereco: { cred_id: credEndIdInWallet, revealed: true },

        attr_email: { cred_id: credContatoIdInWallet, revealed: true },
        attr_telefone: { cred_id: credContatoIdInWallet, revealed: true },
      },
      requested_predicates: {
        pred_idade_ge_18: { cred_id: credCpfIdInWallet },
      },
    };

    const schemasMap = JSON.stringify({
      [ids.schemaCpfId]: JSON.parse(schemaCpfJsonLedger),
      [ids.schemaEndId]: JSON.parse(schemaEndJsonLedger),
      [ids.schemaContatoId]: JSON.parse(schemaContatoJsonLedger),
    });

    const credDefsMap = JSON.stringify({
      [ids.credDefCpfId]: JSON.parse(credDefCpfJsonLedger2),
      [ids.credDefEndId]: JSON.parse(credDefEndJsonLedger2),
      [ids.credDefContatoId]: JSON.parse(credDefContatoJsonLedger2),
    });

    const presJson = await holder.createPresentation(
      JSON.stringify(presReqObj),
      JSON.stringify(requestedCreds),
      schemasMap,
      credDefsMap
    );

    const presFile = pExchange(exchangeDir, "19_01_presentation.env.json");
    await sendAuthcryptToFile(
      holder,
      holderPub.did,
      issuerPub.verkey,
      "anoncreds/presentation",
      threadId,
      presJson,
      presFile,
      { phase: "presentation" }
    );

    console.log("20) Issuer lendo Presentation (env) e verificando...");
    const presPlain = await recvFromFile(issuer, issuerPub.did, presFile);

    const ok = await issuer.verifyPresentation(
      JSON.stringify(presReqObj),
      presPlain,
      schemasMap,
      credDefsMap
    );

    if (!ok) throw new Error("❌ verifyPresentation retornou false.");

    console.log("✅ OK: apresentação validada (3 credenciais + ZKP idade>=18).");

    const presObj = JSON.parse(presPlain);
    console.log("📝 Revealed:", presObj.requested_proof?.revealed_attrs);
    console.log("🧮 Predicates:", presObj.requested_proof?.predicates);
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
