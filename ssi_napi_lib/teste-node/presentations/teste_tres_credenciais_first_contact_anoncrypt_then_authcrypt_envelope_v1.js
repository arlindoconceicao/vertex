/*
PARA RODAR ESTE TESTE:
TRUSTEE_SEED="000000000000000000000000Trustee1" \
TRUSTEE_DID="V4SGRU86Z58d6TV7PBUe6f" \
WALLET_PASS="minha_senha_teste" GENESIS_FILE=./genesis.txn \
node teste-node/presentations/teste_tres_credenciais_first_contact_anoncrypt_then_authcrypt_envelope_v1.js

O QUE ESTE TESTE FAZ (FIRST CONTACT ANONCRYPT -> RESTO AUTHCRYPT):
- Cria DIDs do issuer e do holder via createOwnDid()
- Registra ambos no ledger via Trustee
- FIRST CONTACT: Holder -> Issuer via Envelope anoncrypt (sem sender_verkey)
  * Payload inclui holderDid + holderVerkey (para “bootstrap” seguro)
- A PARTIR DAÍ: TODOS os objetos SSI trafegam via Envelope authcrypt:
  Offer -> Request -> Credential -> Store receipt
  Proof Request -> Presentation
- 3 credenciais (CPF, ENDERECO, CONTATO) + prova ZKP idade>=18

IMPORTANTE:
- Não existe mais arquivo público separado (pub_issuer/pub_holder).
- O “bootstrap” do holder (did/verkey) vai dentro do 1º envelope anoncrypt.
- Em cenário real, o holder precisa conhecer o verkey do issuer por canal OOB (QR, convite, etc).
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

function pExchange(dir, name) {
  return path.join(dir, name);
}

// -------------------------
// Envelope file exchange
// -------------------------
// Ajuste se o nome/assinatura do método authcrypt estiver diferente.
// Compare com teste-node/envelope/test_env_03_authcrypt_roundtrip.js.
async function packAuthcrypt(agent, senderDid, recipientVerkey, kind, threadId, plaintext, expiresAtMs = null, meta = null) {
  // Assinatura esperada (padrão): (senderDid, recipientVerkey, kind, thread_id, plaintext, expires_at_ms, meta_json)
  return agent.envelopePackAuthcrypt(
    senderDid,
    recipientVerkey,
    kind,
    threadId,
    plaintext,
    expiresAtMs,
    meta ? JSON.stringify(meta) : null
  );
}

async function packAnoncrypt(agent, recipientVerkey, kind, threadId, plaintext, expiresAtMs = null, meta = null) {
  // Assinatura (já validada no env_05): (recipientVerkey, kind, thread_id, plaintext, expires_at_ms, meta_json)
  return agent.envelopePackAnoncrypt(
    recipientVerkey,
    kind,
    threadId,
    plaintext,
    expiresAtMs,
    meta ? JSON.stringify(meta) : null
  );
}

async function writeEnvFile(filePath, envJson) {
  writeFileAtomic(filePath, envJson);
}

async function readAndUnpackEnvFile(receiverAgent, receiverDid, filePath) {
  const envJson = readFileUtf8(filePath);
  const plaintext = await receiverAgent.envelopeUnpackAuto(receiverDid, envJson);
  return { envJson, plaintext };
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
// MAIN
// -------------------------
(async () => {
  const GENESIS_FILE = mustEnv("GENESIS_FILE");
  const WALLET_PASS = process.env.WALLET_PASS || "minha_senha_teste";

  const TRUSTEE_SEED = mustEnv("TRUSTEE_SEED");
  const TRUSTEE_DID = mustEnv("TRUSTEE_DID");

  const walletsDir = path.join(__dirname, "..", "wallets");
  fs.mkdirSync(walletsDir, { recursive: true });

  const rootExchangeDir = path.join(__dirname, "exchange_3creds_first_anon_then_auth_env_v1");
  fs.mkdirSync(rootExchangeDir, { recursive: true });

  const threadId = `th_first_anon_then_auth_${Date.now()}`;
  const exchangeDir = path.join(rootExchangeDir, threadId);
  fs.mkdirSync(exchangeDir, { recursive: true });

  // Wallets (reset)
  const issuerWalletPath = path.join(walletsDir, "issuer_first_anon_then_auth_env_v1.db");
  const holderWalletPath = path.join(walletsDir, "holder_first_anon_then_auth_env_v1.db");
  rmIfExists(issuerWalletPath);
  rmIfExists(holderWalletPath);

  // Agentes
  const issuer = new IndyAgent();
  const holder = new IndyAgent();

  // “Estado de contato” (aprendido no primeiro contato anoncrypt)
  let holderDidLearned = null;
  let holderVerkeyLearned = null;

  try {
    // ============================================================
    // SETUP
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
    // DIDs + registrar no ledger
    // ============================================================
    console.log("5) Issuer criando DID (createOwnDid)...");
    const [issuerDid, issuerVerkey] = await issuer.createOwnDid();

    console.log("6) Holder criando DID (createOwnDid)...");
    const [holderDid, holderVerkey] = await holder.createOwnDid();

    console.log("7) Registrando DIDs no ledger (NYM) via Trustee...");
    await tryRegisterDid(issuer, GENESIS_FILE, TRUSTEE_DID, issuerDid, issuerVerkey, "ENDORSER");
    await tryRegisterDid(issuer, GENESIS_FILE, TRUSTEE_DID, holderDid, holderVerkey, null);

    // ============================================================
    // FIRST CONTACT (anoncrypt): holder -> issuer
    // ============================================================
    console.log("8) First contact: Holder -> Issuer (anoncrypt envelope)...");
    const helloPayload = JSON.stringify({
      type: "hello/anoncrypt",
      holderDid,
      holderVerkey,
      note: "bootstrap de contato (para migrar para authcrypt)",
      ts: Date.now(),
    });

    const helloEnv = await packAnoncrypt(
      holder,
      issuerVerkey,                       // OOB knowledge do verkey do issuer (simulado)
      "contact/hello",
      threadId,
      helloPayload,
      null,
      { step: "hello", phase: "first-contact" }
    );

    const helloFile = pExchange(exchangeDir, "00_hello_anoncrypt.env.json");
    await writeEnvFile(helloFile, helloEnv);

    const { plaintext: helloPlain } = await readAndUnpackEnvFile(issuer, issuerDid, helloFile);
    const helloObj = JSON.parse(helloPlain);
    holderDidLearned = helloObj.holderDid;
    holderVerkeyLearned = helloObj.holderVerkey;

    if (!holderDidLearned || !holderVerkeyLearned) {
      throw new Error("First contact inválido: faltando holderDid/holderVerkey");
    }

    console.log("✅ First contact OK. Issuer aprendeu holderDid/verkey.");

    // ============================================================
    // 3 Schemas + 3 CredDefs
    // ============================================================
    console.log("9) Issuer criando+registrando Schemas...");
    const schemaCpfId = await issuer.createAndRegisterSchema(
      GENESIS_FILE, issuerDid, "cpf", `1.0.${Date.now()}`, ["nome", "cpf", "idade"]
    );
    const schemaEndId = await issuer.createAndRegisterSchema(
      GENESIS_FILE, issuerDid, "endereco", `1.0.${Date.now()}`, ["nome", "endereco", "cidade", "estado"]
    );
    const schemaContatoId = await issuer.createAndRegisterSchema(
      GENESIS_FILE, issuerDid, "contato", `1.0.${Date.now()}`, ["nome", "email", "telefone"]
    );

    console.log("10) Issuer criando+registrando CredDefs...");
    const credDefCpfId = await issuer.createAndRegisterCredDef(GENESIS_FILE, issuerDid, schemaCpfId, `TAG_CPF_${Date.now()}`);
    const credDefEndId = await issuer.createAndRegisterCredDef(GENESIS_FILE, issuerDid, schemaEndId, `TAG_END_${Date.now()}`);
    const credDefContatoId = await issuer.createAndRegisterCredDef(GENESIS_FILE, issuerDid, schemaContatoId, `TAG_CONTATO_${Date.now()}`);

    console.log("11) Garantindo Link Secret no holder...");
    try { await holder.createLinkSecret("default"); } catch (_) {}

    // ============================================================
    // FLUXO 1: CPF (authcrypt envelopes)
    // ============================================================
    console.log("12) Fluxo CPF (authcrypt via envelopes)...");

    // Offer
    const offerCpfId = `offer-cpf-${Date.now()}`;
    const offerCpfJson = await issuer.createCredentialOffer(credDefCpfId, offerCpfId);
    const cpfOfferEnv = await packAuthcrypt(
      issuer, issuerDid, holderVerkeyLearned,
      "ssi/cred/offer", threadId,
      offerCpfJson, null, { step: "cpf.offer" }
    );
    const cpfOfferFile = pExchange(exchangeDir, "cpf_01_offer.env.json");
    await writeEnvFile(cpfOfferFile, cpfOfferEnv);

    // Holder: unpack offer -> request
    const { plaintext: offerCpfPlain } = await readAndUnpackEnvFile(holder, holderDid, cpfOfferFile);
    const offerCpfObj = JSON.parse(offerCpfPlain);
    const reqMetaCpfId = offerCpfObj?.nonce;
    if (!reqMetaCpfId) throw new Error("CPF: Offer sem nonce (reqMetaId).");

    const credDefCpfJsonLedger = await holder.fetchCredDefFromLedger(GENESIS_FILE, credDefCpfId);

    const reqCpfJson = await holder.createCredentialRequest(
      "default",
      holderDid,
      credDefCpfJsonLedger,
      offerCpfPlain
    );

    const cpfReqEnv = await packAuthcrypt(
      holder, holderDid, issuerVerkey,
      "ssi/cred/request", threadId,
      reqCpfJson, null, { step: "cpf.request" }
    );
    const cpfReqFile = pExchange(exchangeDir, "cpf_02_request.env.json");
    await writeEnvFile(cpfReqFile, cpfReqEnv);

    // Issuer: unpack request -> credential
    const { plaintext: reqCpfPlain } = await readAndUnpackEnvFile(issuer, issuerDid, cpfReqFile);

    // ⚠️ Para predicado/ZKP: idade deve ser "string numérica"
    const valuesCpf = { nome: "Edimar Veríssimo", cpf: "123.456.789-09", idade: "35" };

    const credCpfJson = await issuer.createCredential(
      credDefCpfId,
      offerCpfJson,
      reqCpfPlain,
      JSON.stringify(valuesCpf)
    );

    const cpfCredEnv = await packAuthcrypt(
      issuer, issuerDid, holderVerkeyLearned,
      "ssi/cred/issue", threadId,
      credCpfJson, null, { step: "cpf.credential" }
    );
    const cpfCredFile = pExchange(exchangeDir, "cpf_03_credential.env.json");
    await writeEnvFile(cpfCredFile, cpfCredEnv);

    // Holder: store + receipt
    const { plaintext: credCpfPlain } = await readAndUnpackEnvFile(holder, holderDid, cpfCredFile);

    const credCpfIdInWallet = "cred-cpf-file";
    await holder.storeCredential(
      credCpfIdInWallet,
      credCpfPlain,
      reqMetaCpfId,
      credDefCpfJsonLedger,
      null
    );

    const cpfReceipt = JSON.stringify({ ok: true, step: "storeCredential", kind: "cpf", cred_id: credCpfIdInWallet, cred_def_id: credDefCpfId });
    const cpfReceiptEnv = await packAuthcrypt(
      holder, holderDid, issuerVerkey,
      "ssi/cred/store_receipt", threadId,
      cpfReceipt, null, { step: "cpf.receipt" }
    );
    const cpfReceiptFile = pExchange(exchangeDir, "cpf_04_store_receipt.env.json");
    await writeEnvFile(cpfReceiptFile, cpfReceiptEnv);

    const { plaintext: cpfReceiptPlain } = await readAndUnpackEnvFile(issuer, issuerDid, cpfReceiptFile);
    if (!JSON.parse(cpfReceiptPlain)?.ok) throw new Error("CPF: receipt inválido.");
    console.log("✅ Store OK (CPF).");

    // ============================================================
    // FLUXO 2: ENDERECO
    // ============================================================
    console.log("13) Fluxo ENDERECO (authcrypt via envelopes)...");

    const offerEndId = `offer-end-${Date.now()}`;
    const offerEndJson = await issuer.createCredentialOffer(credDefEndId, offerEndId);
    await writeEnvFile(
      pExchange(exchangeDir, "end_01_offer.env.json"),
      await packAuthcrypt(issuer, issuerDid, holderVerkeyLearned, "ssi/cred/offer", threadId, offerEndJson, null, { step: "end.offer" })
    );

    const { plaintext: offerEndPlain } = await readAndUnpackEnvFile(holder, holderDid, pExchange(exchangeDir, "end_01_offer.env.json"));
    const offerEndObj = JSON.parse(offerEndPlain);
    const reqMetaEndId = offerEndObj?.nonce;
    if (!reqMetaEndId) throw new Error("END: Offer sem nonce (reqMetaId).");

    const credDefEndJsonLedger = await holder.fetchCredDefFromLedger(GENESIS_FILE, credDefEndId);
    const reqEndJson = await holder.createCredentialRequest("default", holderDid, credDefEndJsonLedger, offerEndPlain);

    await writeEnvFile(
      pExchange(exchangeDir, "end_02_request.env.json"),
      await packAuthcrypt(holder, holderDid, issuerVerkey, "ssi/cred/request", threadId, reqEndJson, null, { step: "end.request" })
    );

    const { plaintext: reqEndPlain } = await readAndUnpackEnvFile(issuer, issuerDid, pExchange(exchangeDir, "end_02_request.env.json"));

    const valuesEnd = { nome: "Edimar Veríssimo", endereco: "Rua Exemplo, 123", cidade: "São Paulo", estado: "SP" };
    const credEndJson = await issuer.createCredential(credDefEndId, offerEndJson, reqEndPlain, JSON.stringify(valuesEnd));

    await writeEnvFile(
      pExchange(exchangeDir, "end_03_credential.env.json"),
      await packAuthcrypt(issuer, issuerDid, holderVerkeyLearned, "ssi/cred/issue", threadId, credEndJson, null, { step: "end.credential" })
    );

    const { plaintext: credEndPlain } = await readAndUnpackEnvFile(holder, holderDid, pExchange(exchangeDir, "end_03_credential.env.json"));

    const credEndIdInWallet = "cred-end-file";
    await holder.storeCredential(credEndIdInWallet, credEndPlain, reqMetaEndId, credDefEndJsonLedger, null);

    const endReceipt = JSON.stringify({ ok: true, step: "storeCredential", kind: "end", cred_id: credEndIdInWallet, cred_def_id: credDefEndId });
    await writeEnvFile(
      pExchange(exchangeDir, "end_04_store_receipt.env.json"),
      await packAuthcrypt(holder, holderDid, issuerVerkey, "ssi/cred/store_receipt", threadId, endReceipt, null, { step: "end.receipt" })
    );

    const { plaintext: endReceiptPlain } = await readAndUnpackEnvFile(issuer, issuerDid, pExchange(exchangeDir, "end_04_store_receipt.env.json"));
    if (!JSON.parse(endReceiptPlain)?.ok) throw new Error("END: receipt inválido.");
    console.log("✅ Store OK (END).");

    // ============================================================
    // FLUXO 3: CONTATO
    // ============================================================
    console.log("14) Fluxo CONTATO (authcrypt via envelopes)...");

    const offerContatoId = `offer-contato-${Date.now()}`;
    const offerContatoJson = await issuer.createCredentialOffer(credDefContatoId, offerContatoId);
    await writeEnvFile(
      pExchange(exchangeDir, "contato_01_offer.env.json"),
      await packAuthcrypt(issuer, issuerDid, holderVerkeyLearned, "ssi/cred/offer", threadId, offerContatoJson, null, { step: "contato.offer" })
    );

    const { plaintext: offerContatoPlain } = await readAndUnpackEnvFile(holder, holderDid, pExchange(exchangeDir, "contato_01_offer.env.json"));
    const offerContatoObj = JSON.parse(offerContatoPlain);
    const reqMetaContatoId = offerContatoObj?.nonce;
    if (!reqMetaContatoId) throw new Error("CONTATO: Offer sem nonce (reqMetaId).");

    const credDefContatoJsonLedger = await holder.fetchCredDefFromLedger(GENESIS_FILE, credDefContatoId);
    const reqContatoJson = await holder.createCredentialRequest("default", holderDid, credDefContatoJsonLedger, offerContatoPlain);

    await writeEnvFile(
      pExchange(exchangeDir, "contato_02_request.env.json"),
      await packAuthcrypt(holder, holderDid, issuerVerkey, "ssi/cred/request", threadId, reqContatoJson, null, { step: "contato.request" })
    );

    const { plaintext: reqContatoPlain } = await readAndUnpackEnvFile(issuer, issuerDid, pExchange(exchangeDir, "contato_02_request.env.json"));

    const valuesContato = { nome: "Edimar Veríssimo", email: "edimar@example.com", telefone: "+55 11 99999-9999" };
    const credContatoJson = await issuer.createCredential(credDefContatoId, offerContatoJson, reqContatoPlain, JSON.stringify(valuesContato));

    await writeEnvFile(
      pExchange(exchangeDir, "contato_03_credential.env.json"),
      await packAuthcrypt(issuer, issuerDid, holderVerkeyLearned, "ssi/cred/issue", threadId, credContatoJson, null, { step: "contato.credential" })
    );

    const { plaintext: credContatoPlain } = await readAndUnpackEnvFile(holder, holderDid, pExchange(exchangeDir, "contato_03_credential.env.json"));

    const credContatoIdInWallet = "cred-contato-file";
    await holder.storeCredential(credContatoIdInWallet, credContatoPlain, reqMetaContatoId, credDefContatoJsonLedger, null);

    const contatoReceipt = JSON.stringify({ ok: true, step: "storeCredential", kind: "contato", cred_id: credContatoIdInWallet, cred_def_id: credDefContatoId });
    await writeEnvFile(
      pExchange(exchangeDir, "contato_04_store_receipt.env.json"),
      await packAuthcrypt(holder, holderDid, issuerVerkey, "ssi/cred/store_receipt", threadId, contatoReceipt, null, { step: "contato.receipt" })
    );

    const { plaintext: contatoReceiptPlain } = await readAndUnpackEnvFile(issuer, issuerDid, pExchange(exchangeDir, "contato_04_store_receipt.env.json"));
    if (!JSON.parse(contatoReceiptPlain)?.ok) throw new Error("CONTATO: receipt inválido.");
    console.log("✅ Store OK (CONTATO).");

    // ============================================================
    // PROVA (3 credenciais + ZKP idade>=18) — authcrypt envelopes
    // ============================================================
    console.log("15) Issuer criando Proof Request (authcrypt)...");
    const presReq = {
      nonce: String(Date.now()),
      name: "proof-3creds-zkp18",
      version: "1.0",
      requested_attributes: {
        attr_nome: { name: "nome", restrictions: [{ cred_def_id: credDefCpfId }] },
        attr_cpf: { name: "cpf", restrictions: [{ cred_def_id: credDefCpfId }] },
        attr_endereco: { name: "endereco", restrictions: [{ cred_def_id: credDefEndId }] },
        attr_email: { name: "email", restrictions: [{ cred_def_id: credDefContatoId }] },
        attr_telefone: { name: "telefone", restrictions: [{ cred_def_id: credDefContatoId }] },
      },
      requested_predicates: {
        pred_idade_ge_18: {
          name: "idade",
          p_type: ">=",
          p_value: 18,
          restrictions: [{ cred_def_id: credDefCpfId }],
        },
      },
    };

    await writeEnvFile(
      pExchange(exchangeDir, "proof_01_request.env.json"),
      await packAuthcrypt(issuer, issuerDid, holderVerkeyLearned, "ssi/proof/request", threadId, JSON.stringify(presReq), null, { step: "proof.request" })
    );

    console.log("16) Holder criando Presentation (authcrypt)...");
    const { plaintext: presReqPlain } = await readAndUnpackEnvFile(holder, holderDid, pExchange(exchangeDir, "proof_01_request.env.json"));
    const presReqObj = JSON.parse(presReqPlain);

    const schemaCpfJsonLedger = await holder.fetchSchemaFromLedger(GENESIS_FILE, schemaCpfId);
    const schemaEndJsonLedger = await holder.fetchSchemaFromLedger(GENESIS_FILE, schemaEndId);
    const schemaContatoJsonLedger = await holder.fetchSchemaFromLedger(GENESIS_FILE, schemaContatoId);

    const credDefCpfJsonLedger2 = await holder.fetchCredDefFromLedger(GENESIS_FILE, credDefCpfId);
    const credDefEndJsonLedger2 = await holder.fetchCredDefFromLedger(GENESIS_FILE, credDefEndId);
    const credDefContatoJsonLedger2 = await holder.fetchCredDefFromLedger(GENESIS_FILE, credDefContatoId);

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
      [schemaCpfId]: JSON.parse(schemaCpfJsonLedger),
      [schemaEndId]: JSON.parse(schemaEndJsonLedger),
      [schemaContatoId]: JSON.parse(schemaContatoJsonLedger),
    });

    const credDefsMap = JSON.stringify({
      [credDefCpfId]: JSON.parse(credDefCpfJsonLedger2),
      [credDefEndId]: JSON.parse(credDefEndJsonLedger2),
      [credDefContatoId]: JSON.parse(credDefContatoJsonLedger2),
    });

    const presJson = await holder.createPresentation(
      JSON.stringify(presReqObj),
      JSON.stringify(requestedCreds),
      schemasMap,
      credDefsMap
    );

    await writeEnvFile(
      pExchange(exchangeDir, "proof_02_presentation.env.json"),
      await packAuthcrypt(holder, holderDid, issuerVerkey, "ssi/proof/presentation", threadId, presJson, null, { step: "proof.presentation" })
    );

    console.log("17) Issuer verificando Presentation...");
    const { plaintext: presPlain } = await readAndUnpackEnvFile(issuer, issuerDid, pExchange(exchangeDir, "proof_02_presentation.env.json"));

    const ok = await issuer.verifyPresentation(
      JSON.stringify(presReqObj),
      presPlain,
      schemasMap,
      credDefsMap
    );

    if (!ok) throw new Error("❌ verifyPresentation retornou false.");

    const presObj = JSON.parse(presPlain);
    console.log("✅ OK: apresentação validada (3 credenciais + ZKP idade>=18).");
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
