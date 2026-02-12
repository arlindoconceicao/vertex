/*
PARA RODAR ESTE TESTE:
TRUSTEE_SEED="000000000000000000000000Trustee1" \
TRUSTEE_DID="V4SGRU86Z58d6TV7PBUe6f" \
WALLET_PASS="minha_senha_teste" GENESIS_FILE=./genesis.txn \
node teste-node/presentations/teste_tres_credenciais_envelope_exchange_zkp18_strict_files.js

O QUE ESTE TESTE FAZ (STRICT FILE EXCHANGE COM ENVELOPES):
- Mesmo fluxo do teste original (3 credenciais + ZKP idade>=18)
- Substitui encryptToFile/decryptFromFile por:
  - envelopePackAuthcrypt(...) -> grava EnvelopeV1 JSON no arquivo
  - envelopeUnpackAuto(...) -> lê EnvelopeV1 e devolve plaintext
- Ainda mantém arquivos públicos com DID/verkey (bootstrap) para permitir o emissor
  cifrar para o holder (recipient_verkey). Mas o receiver NÃO precisa do sender_verkey.
- Gera arquivos em: teste-node/presentations/exchange_3creds_zkp18_envelope_strict_files
*/

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

function pExchange(exchangeDir, name) {
  return path.join(exchangeDir, name);
}

function writeJson(filePath, obj) {
  writeFileAtomic(filePath, JSON.stringify(obj, null, 2));
}

function readJson(filePath) {
  return JSON.parse(readFileUtf8(filePath));
}

// -------------------------
// Envelope file exchange (AuthCrypt)
// -------------------------
// OBS: requer que a lib exporte envelopePackAuthcrypt e envelopeUnpackAuto
async function packEnvelopeToFile(
  senderAgent,
  senderDid,
  recipientVerkey,
  kind,
  threadIdOpt,
  plaintext,
  expiresAtMsOpt,
  metaObjOpt,
  filePath
) {
  const metaJson = metaObjOpt ? JSON.stringify(metaObjOpt) : null;

  const envelopeJson = await senderAgent.envelopePackAuthcrypt(
    senderDid,
    recipientVerkey,
    kind,
    threadIdOpt ?? null,
    plaintext,
    expiresAtMsOpt ?? null,
    metaJson
  );

  writeFileAtomic(filePath, envelopeJson);
}

async function unpackEnvelopeFromFile(receiverAgent, receiverDid, filePath) {
  const envelopeJson = readFileUtf8(filePath);
  const plaintext = await receiverAgent.envelopeUnpackAuto(receiverDid, envelopeJson);
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

  const exchangeDir = path.join(
    __dirname,
    "exchange_3creds_zkp18_envelope_strict_files"
  );
  fs.mkdirSync(exchangeDir, { recursive: true });

  // Wallets (reset)
  const issuerWalletPath = path.join(walletsDir, "issuer_3creds_zkp18_envelope.db");
  const holderWalletPath = path.join(walletsDir, "holder_3creds_zkp18_envelope.db");
  rmIfExists(issuerWalletPath);
  rmIfExists(holderWalletPath);

  // Agentes
  const issuer = new IndyAgent();
  const holder = new IndyAgent();

  // Bootstrap público (DID+verkey) para permitir pack (recipient_verkey)
  const issuerPubFile = pExchange(exchangeDir, "pub_issuer.json");
  const holderPubFile = pExchange(exchangeDir, "pub_holder.json");

  // IDs do ledger compartilhados por arquivo
  const ledgerIdsFile = pExchange(exchangeDir, "ledger_ids.json");

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
    const [issuerDid_local, issuerVerkey_local] = await issuer.createOwnDid();
    writeJson(issuerPubFile, { did: issuerDid_local, verkey: issuerVerkey_local });

    console.log("6) Holder criando DID (createOwnDid)...");
    const [holderDid_local, holderVerkey_local] = await holder.createOwnDid();
    writeJson(holderPubFile, { did: holderDid_local, verkey: holderVerkey_local });

    console.log("7) Registrando DIDs no ledger (NYM) via Trustee...");
    await tryRegisterDid(
      issuer, GENESIS_FILE, TRUSTEE_DID, issuerDid_local, issuerVerkey_local, "ENDORSER"
    );
    await tryRegisterDid(
      issuer, GENESIS_FILE, TRUSTEE_DID, holderDid_local, holderVerkey_local, null
    );

    // ============================================================
    // 2) Criar 3 Schemas + 3 CredDefs e gravar IDs em arquivo
    // ============================================================
    console.log("8) Issuer criando+registrando Schema CPF...");
    const schemaCpfVer = `1.0.${Date.now()}`;
    const schemaCpfId_local = await issuer.createAndRegisterSchema(
      GENESIS_FILE,
      issuerDid_local,
      "cpf",
      schemaCpfVer,
      ["nome", "cpf", "idade"]
    );

    console.log("9) Issuer criando+registrando Schema ENDERECO...");
    const schemaEndVer = `1.0.${Date.now()}`;
    const schemaEndId_local = await issuer.createAndRegisterSchema(
      GENESIS_FILE,
      issuerDid_local,
      "endereco",
      schemaEndVer,
      ["nome", "endereco", "cidade", "estado"]
    );

    console.log("10) Issuer criando+registrando Schema CONTATO...");
    const schemaContatoVer = `1.0.${Date.now()}`;
    const schemaContatoId_local = await issuer.createAndRegisterSchema(
      GENESIS_FILE,
      issuerDid_local,
      "contato",
      schemaContatoVer,
      ["nome", "email", "telefone"]
    );

    console.log("11) Issuer criando+registrando CredDef CPF...");
    const credDefCpfTag = `TAG_CPF_${Date.now()}`;
    const credDefCpfId_local = await issuer.createAndRegisterCredDef(
      GENESIS_FILE,
      issuerDid_local,
      schemaCpfId_local,
      credDefCpfTag
    );

    console.log("12) Issuer criando+registrando CredDef ENDERECO...");
    const credDefEndTag = `TAG_END_${Date.now()}`;
    const credDefEndId_local = await issuer.createAndRegisterCredDef(
      GENESIS_FILE,
      issuerDid_local,
      schemaEndId_local,
      credDefEndTag
    );

    console.log("13) Issuer criando+registrando CredDef CONTATO...");
    const credDefContatoTag = `TAG_CONTATO_${Date.now()}`;
    const credDefContatoId_local = await issuer.createAndRegisterCredDef(
      GENESIS_FILE,
      issuerDid_local,
      schemaContatoId_local,
      credDefContatoTag
    );

    writeJson(ledgerIdsFile, {
      schemaCpfId: schemaCpfId_local,
      schemaEndId: schemaEndId_local,
      schemaContatoId: schemaContatoId_local,
      credDefCpfId: credDefCpfId_local,
      credDefEndId: credDefEndId_local,
      credDefContatoId: credDefContatoId_local
    });

    console.log("14) Garantindo Link Secret no holder...");
    try { await holder.createLinkSecret("default"); } catch (_) {}

    // ============================================================
    // FLUXO 1: CPF
    // ============================================================
    console.log("15) Fluxo CPF (ENVELOPES em arquivos)...");
    const issuerPub = readJson(issuerPubFile);
    const holderPub = readJson(holderPubFile);
    const ids = readJson(ledgerIdsFile);

    console.log("15.1) Issuer criando Offer CPF e gravando envelope (authcrypt)...");
    const offerCpfId = `offer-cpf-${Date.now()}`;
    const offerCpfJson = await issuer.createCredentialOffer(ids.credDefCpfId, offerCpfId);

    // Aqui criamos o arquivo de troca de mensagens e depois escrevemos o conteúdo do envelope nele.
    const cpfOfferFile = pExchange(exchangeDir, "cpf_01_offer.env.json");
    await packEnvelopeToFile(
      issuer,
      issuerPub.did,
      holderPub.verkey,
      "cred_offer",
      null,
      offerCpfJson,
      null,
      { step: "cpf_offer" },
      cpfOfferFile
    );

    // Aqui o Holder decifra o arquivo recebido do Issuer
    console.log("15.2) Holder lendo Offer CPF via envelope e criando Request...");
    const offerCpfPlain = await unpackEnvelopeFromFile(holder, holderPub.did, cpfOfferFile);
    const offerCpfObj = JSON.parse(offerCpfPlain);
    const reqMetaCpfId = offerCpfObj?.nonce;
    if (!reqMetaCpfId) throw new Error("CPF: Offer sem nonce (reqMetaId).");

    // Buscando informações da credencial CPF no ledger
    const credDefCpfJsonLedger = await holder.fetchCredDefFromLedger(GENESIS_FILE, ids.credDefCpfId);

    // Aqui o Holder cria o "aceite da credencial"
    const reqCpfJson = await holder.createCredentialRequest(
      "default",
      holderPub.did,
      credDefCpfJsonLedger,
      offerCpfPlain
    );

    // Holder faz o empacotamento do aceite da credencial para enviar para o Issuer
    const cpfReqFile = pExchange(exchangeDir, "cpf_02_request.env.json");
    await packEnvelopeToFile(
      holder,
      holderPub.did,
      issuerPub.verkey,
      "cred_request",
      null,
      reqCpfJson,
      null,
      { step: "cpf_request" },
      cpfReqFile
    );

    // Aqui o Emissor faz a decifragem do arquivo recebido do Holder
    console.log("15.3) Issuer lendo Request CPF via envelope e emitindo Credential...");
    const reqCpfPlain = await unpackEnvelopeFromFile(issuer, issuerPub.did, cpfReqFile);

    // NESTA PARTE O EMISSOR COMEÇA A PREENCHER OS DADOS DA CREDENCIAL

    // ⚠️ Para predicado/ZKP: idade deve ser "string numérica" (ex: "35"), não número.
    const valuesCpf = { nome: "Edimar Veríssimo", cpf: "123.456.789-09", idade: "35" };

    const credCpfJson = await issuer.createCredential(
      ids.credDefCpfId,  // ID da credencial no ledger
      offerCpfJson,      // Oferta enviada ao Holder 
      reqCpfPlain,       // Request recebido do Holder
      JSON.stringify(valuesCpf)   // Dados da credencial
    );

    // Neste passo o Emissor envia o arquivo para o Holder
    const cpfCredFile = pExchange(exchangeDir, "cpf_03_credential.env.json");
    await packEnvelopeToFile(
      issuer,
      issuerPub.did,
      holderPub.verkey,
      "credential",
      null,
      credCpfJson,
      null,
      { step: "cpf_credential" },
      cpfCredFile
    );

    // Aqui o Holder recebe e armazena a credencial
    console.log("15.4) Holder lendo Credential CPF via envelope e fazendo Store + receipt...");
    const credCpfPlain = await unpackEnvelopeFromFile(holder, holderPub.did, cpfCredFile);

    const credCpfIdInWallet = "cred-cpf-envelope";
    await holder.storeCredential(
      credCpfIdInWallet,
      credCpfPlain,
      reqMetaCpfId,
      credDefCpfJsonLedger,
      null
    );

    // O Holder faz um recibo para o Emissor
    const cpfReceipt = JSON.stringify({
      ok: true,
      step: "storeCredential",
      kind: "cpf",
      cred_id: credCpfIdInWallet,
      cred_def_id: ids.credDefCpfId
    });

    // Enviando o recibo via arquivo
    const cpfReceiptFile = pExchange(exchangeDir, "cpf_04_store_receipt.env.json");
    await packEnvelopeToFile(
      holder,
      holderPub.did,
      issuerPub.verkey,
      "store_receipt",
      null,
      cpfReceipt,
      null,
      { step: "cpf_store_receipt" },
      cpfReceiptFile
    );

    // Emissor confere o recibo
    console.log("15.5) Issuer lendo receipt CPF via envelope...");
    const cpfReceiptPlain = await unpackEnvelopeFromFile(issuer, issuerPub.did, cpfReceiptFile);
    if (!JSON.parse(cpfReceiptPlain)?.ok) throw new Error("CPF: receipt inválido.");
    console.log("✅ Store OK (CPF).");

    // Os fluxos de credenciaispara Endereço e Contato são similares.

    // ============================================================
    // FLUXO 2: ENDERECO
    // ============================================================
    console.log("16) Fluxo ENDERECO (ENVELOPES em arquivos)...");

    console.log("16.1) Issuer criando Offer END e gravando envelope...");
    const offerEndId = `offer-end-${Date.now()}`;
    const offerEndJson = await issuer.createCredentialOffer(ids.credDefEndId, offerEndId);

    const endOfferFile = pExchange(exchangeDir, "end_01_offer.env.json");
    await packEnvelopeToFile(
      issuer,
      issuerPub.did,
      holderPub.verkey,
      "cred_offer",
      null,
      offerEndJson,
      null,
      { step: "end_offer" },
      endOfferFile
    );

    console.log("16.2) Holder lendo Offer END via envelope e criando Request...");
    const offerEndPlain = await unpackEnvelopeFromFile(holder, holderPub.did, endOfferFile);
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

    const endReqFile = pExchange(exchangeDir, "end_02_request.env.json");
    await packEnvelopeToFile(
      holder,
      holderPub.did,
      issuerPub.verkey,
      "cred_request",
      null,
      reqEndJson,
      null,
      { step: "end_request" },
      endReqFile
    );

    console.log("16.3) Issuer lendo Request END via envelope e emitindo Credential...");
    const reqEndPlain = await unpackEnvelopeFromFile(issuer, issuerPub.did, endReqFile);

    const valuesEnd = {
      nome: "Edimar Veríssimo",
      endereco: "Rua Exemplo, 123",
      cidade: "São Paulo",
      estado: "SP"
    };

    const credEndJson = await issuer.createCredential(
      ids.credDefEndId,
      offerEndJson,
      reqEndPlain,
      JSON.stringify(valuesEnd)
    );

    const endCredFile = pExchange(exchangeDir, "end_03_credential.env.json");
    await packEnvelopeToFile(
      issuer,
      issuerPub.did,
      holderPub.verkey,
      "credential",
      null,
      credEndJson,
      null,
      { step: "end_credential" },
      endCredFile
    );

    console.log("16.4) Holder lendo Credential END via envelope e fazendo Store + receipt...");
    const credEndPlain = await unpackEnvelopeFromFile(holder, holderPub.did, endCredFile);

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
      kind: "end",
      cred_id: credEndIdInWallet,
      cred_def_id: ids.credDefEndId
    });

    const endReceiptFile = pExchange(exchangeDir, "end_04_store_receipt.env.json");
    await packEnvelopeToFile(
      holder,
      holderPub.did,
      issuerPub.verkey,
      "store_receipt",
      null,
      endReceipt,
      null,
      { step: "end_store_receipt" },
      endReceiptFile
    );

    console.log("16.5) Issuer lendo receipt END via envelope...");
    const endReceiptPlain = await unpackEnvelopeFromFile(issuer, issuerPub.did, endReceiptFile);
    if (!JSON.parse(endReceiptPlain)?.ok) throw new Error("END: receipt inválido.");
    console.log("✅ Store OK (END).");

    // ============================================================
    // FLUXO 3: CONTATO
    // ============================================================
    console.log("17) Fluxo CONTATO (ENVELOPES em arquivos)...");

    console.log("17.1) Issuer criando Offer CONTATO e gravando envelope...");
    const offerContatoId = `offer-contato-${Date.now()}`;
    const offerContatoJson = await issuer.createCredentialOffer(ids.credDefContatoId, offerContatoId);

    const contatoOfferFile = pExchange(exchangeDir, "contato_01_offer.env.json");
    await packEnvelopeToFile(
      issuer,
      issuerPub.did,
      holderPub.verkey,
      "cred_offer",
      null,
      offerContatoJson,
      null,
      { step: "contato_offer" },
      contatoOfferFile
    );

    console.log("17.2) Holder lendo Offer CONTATO via envelope e criando Request...");
    const offerContatoPlain = await unpackEnvelopeFromFile(holder, holderPub.did, contatoOfferFile);
    const offerContatoObj = JSON.parse(offerContatoPlain);
    const reqMetaContatoId = offerContatoObj?.nonce;
    if (!reqMetaContatoId) throw new Error("CONTATO: Offer sem nonce (reqMetaId).");

    const credDefContatoJsonLedger = await holder.fetchCredDefFromLedger(
      GENESIS_FILE, ids.credDefContatoId
    );

    const reqContatoJson = await holder.createCredentialRequest(
      "default",
      holderPub.did,
      credDefContatoJsonLedger,
      offerContatoPlain
    );

    const contatoReqFile = pExchange(exchangeDir, "contato_02_request.env.json");
    await packEnvelopeToFile(
      holder,
      holderPub.did,
      issuerPub.verkey,
      "cred_request",
      null,
      reqContatoJson,
      null,
      { step: "contato_request" },
      contatoReqFile
    );

    console.log("17.3) Issuer lendo Request CONTATO via envelope e emitindo Credential...");
    const reqContatoPlain = await unpackEnvelopeFromFile(issuer, issuerPub.did, contatoReqFile);

    const valuesContato = {
      nome: "Edimar Veríssimo",
      email: "edimar@example.com",
      telefone: "+55 11 99999-9999"
    };

    const credContatoJson = await issuer.createCredential(
      ids.credDefContatoId,
      offerContatoJson,
      reqContatoPlain,
      JSON.stringify(valuesContato)
    );

    const contatoCredFile = pExchange(exchangeDir, "contato_03_credential.env.json");
    await packEnvelopeToFile(
      issuer,
      issuerPub.did,
      holderPub.verkey,
      "credential",
      null,
      credContatoJson,
      null,
      { step: "contato_credential" },
      contatoCredFile
    );

    console.log("17.4) Holder lendo Credential CONTATO via envelope e fazendo Store + receipt...");
    const credContatoPlain = await unpackEnvelopeFromFile(holder, holderPub.did, contatoCredFile);

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
      cred_def_id: ids.credDefContatoId
    });

    const contatoReceiptFile = pExchange(exchangeDir, "contato_04_store_receipt.env.json");
    await packEnvelopeToFile(
      holder,
      holderPub.did,
      issuerPub.verkey,
      "store_receipt",
      null,
      contatoReceipt,
      null,
      { step: "contato_store_receipt" },
      contatoReceiptFile
    );

    console.log("17.5) Issuer lendo receipt CONTATO via envelope...");
    const contatoReceiptPlain = await unpackEnvelopeFromFile(
      issuer, issuerPub.did, contatoReceiptFile
    );
    if (!JSON.parse(contatoReceiptPlain)?.ok) throw new Error("CONTATO: receipt inválido.");
    console.log("✅ Store OK (CONTATO).");

    // ============================================================
    // PROVA (3 credenciais + ZKP idade>=18) via ENVELOPES em arquivos
    // ============================================================
    console.log("18) Issuer criando Proof Request e gravando envelope...");

    // Aqui é montada a requisição de prova, com os atributos necessários e também
    // quais credenciais devem ser usadas para cada atributo, além de exigir uma prova
    // ZKP (sem revelação do atributo) onde é necessário provar que se tem mais de 18 anos.

    const presReq = {
      nonce: String(Date.now()),
      name: "proof-3creds-zkp18",
      version: "1.0",
      requested_attributes: {
        attr_nome: { name: "nome", restrictions: [{ cred_def_id: ids.credDefCpfId }] },
        attr_cpf: { name: "cpf", restrictions: [{ cred_def_id: ids.credDefCpfId }] },
        attr_endereco: { name: "endereco", restrictions: [{ cred_def_id: ids.credDefEndId }] },
        attr_email: { name: "email", restrictions: [{ cred_def_id: ids.credDefContatoId }] },
        attr_telefone: { name: "telefone", restrictions: [{ cred_def_id: ids.credDefContatoId }] }
      },
      requested_predicates: {
        pred_idade_ge_18: {
          name: "idade",
          p_type: ">=",
          p_value: 18,
          restrictions: [{ cred_def_id: ids.credDefCpfId }]
        }
      }
    };

    // Aqui o Emissor (que neste caso está fazendo o papel de verificador) envia o 
    // pedido de prova para o Holder via arquivo criptografado.
    const proofReqFile = pExchange(exchangeDir, "proof_01_request.env.json");
    await packEnvelopeToFile(
      issuer,
      issuerPub.did,
      holderPub.verkey,
      "proof_request",
      null,
      JSON.stringify(presReq),
      null,
      { step: "proof_request" },
      proofReqFile
    );

    // Holder recebe o arquivo de prova
    console.log("19) Holder lendo Proof Request via envelope e criando Presentation...");
    const presReqPlain = await unpackEnvelopeFromFile(holder, holderPub.did, proofReqFile);
    const presReqObj = JSON.parse(presReqPlain);

    // Buscando Schemas no ledger
    const schemaCpfJsonLedger = await holder.fetchSchemaFromLedger(GENESIS_FILE, ids.schemaCpfId);
    const schemaEndJsonLedger = await holder.fetchSchemaFromLedger(GENESIS_FILE, ids.schemaEndId);
    const schemaContatoJsonLedger = await holder.fetchSchemaFromLedger(
      GENESIS_FILE, ids.schemaContatoId
    );

    // Buscando informações de credenciais no ledger
    const credDefCpfJsonLedger2 = await holder.fetchCredDefFromLedger(GENESIS_FILE, ids.credDefCpfId);
    const credDefEndJsonLedger2 = await holder.fetchCredDefFromLedger(GENESIS_FILE, ids.credDefEndId);
    const credDefContatoJsonLedger2 = await holder.fetchCredDefFromLedger(
      GENESIS_FILE, ids.credDefContatoId
    );

    // Seleção de credenciais para cada atributo/predicado
    // Os nomes que aparecem como "cred-cpf-envelope" e "cred-end-envelope" são os nomes que o Holder
    // salvou as credenciais em sua carteira
    const requestedCreds = {
      requested_attributes: {
        attr_nome: { cred_id: "cred-cpf-envelope", revealed: true },
        attr_cpf: { cred_id: "cred-cpf-envelope", revealed: true },
        attr_endereco: { cred_id: "cred-end-envelope", revealed: true },
        attr_email: { cred_id: "cred-contato-envelope", revealed: true },
        attr_telefone: { cred_id: "cred-contato-envelope", revealed: true }
      },
      requested_predicates: {
        pred_idade_ge_18: { cred_id: "cred-cpf-envelope" }
      }
    };

    // O Holder deve montar 2 mapas com dados dos schemas e credenciais que ele obteve do ledger
    const schemasMap = JSON.stringify({
      [ids.schemaCpfId]: JSON.parse(schemaCpfJsonLedger),
      [ids.schemaEndId]: JSON.parse(schemaEndJsonLedger),
      [ids.schemaContatoId]: JSON.parse(schemaContatoJsonLedger)
    });

    const credDefsMap = JSON.stringify({
      [ids.credDefCpfId]: JSON.parse(credDefCpfJsonLedger2),
      [ids.credDefEndId]: JSON.parse(credDefEndJsonLedger2),
      [ids.credDefContatoId]: JSON.parse(credDefContatoJsonLedger2)
    });

    // Agora o Holder pode criar a apresentação
    const presJson = await holder.createPresentation(
      JSON.stringify(presReqObj),
      JSON.stringify(requestedCreds),
      schemasMap,
      credDefsMap
    );

    // O Holder encripta a apresentação com a chave pública do Holder e envia via arquivo
    const presFile = pExchange(exchangeDir, "proof_02_presentation.env.json");
    await packEnvelopeToFile(
      holder,
      holderPub.did,
      issuerPub.verkey,
      "presentation",
      null,
      presJson,
      null,
      { step: "presentation" },
      presFile
    );

    // Finalmente o Issuer (que neste caso está funcionando como verificador)
    // pode decifrar o arquivo e verificar a apresentação
    // É necessário ter os SchemasMap e credDefsMap que foram lidos do ledger
    console.log("20) Issuer lendo Presentation via envelope e verificando...");
    const presPlain = await unpackEnvelopeFromFile(issuer, issuerPub.did, presFile);

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
