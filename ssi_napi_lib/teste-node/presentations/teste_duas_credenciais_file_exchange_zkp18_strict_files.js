/*
PARA RODAR ESTE TESTE:
TRUSTEE_SEED="000000000000000000000000Trustee1" \
TRUSTEE_DID="V4SGRU86Z58d6TV7PBUe6f" \
WALLET_PASS="minha_senha_teste" GENESIS_FILE=./genesis.txn \
node teste-node/presentations/teste_duas_credenciais_file_exchange_zkp18_strict_files.js

O QUE ESTE TESTE FAZ (STRICT FILE EXCHANGE):
- Cria DIDs do issuer e do holder via createOwnDid()
- Registra ambos no ledger via Trustee
- Emite 2 credenciais (CPF e ENDERECO) com troca somente por ARQUIVOS:
  Offer -> Request -> Credential -> Store receipt (cada item cifrado)
- Cria uma prova com 2 credenciais e predicado ZKP: idade >= 18 (sem revelar idade)
- Troca Proof Request e Presentation também por arquivos cifrados
- Gera arquivos em: teste-node/presentations/exchange_2creds_zkp18_strict_files

IMPORTANTE:
- Todos os objetos "sensíveis" (offer/request/credential/proof/presentation) trafegam apenas por arquivos cifrados.
- Exceção: arquivo público de bootstrap contendo (did, verkey) de cada parte,
  pois decryptMessage exige senderVerkey e não há anoncrypt no binding.
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
// Arquivos / "protocol frames"
// -------------------------
// Convenção simples para nomear arquivos de troca (poderia ser mais sofisticada, mas é só um teste)
function pExchange(exchangeDir, name) {
  return path.join(exchangeDir, name);
}

// Para objetos JSON simples (ex: DIDs públicos, IDs do ledger), sem necessidade de cifrar
function writeJson(filePath, obj) {
  writeFileAtomic(filePath, JSON.stringify(obj, null, 2));
}

// Lê um JSON de arquivo (ex: DIDs públicos, IDs do ledger)
function readJson(filePath) {
  return JSON.parse(readFileUtf8(filePath));
}

// -------------------------
// MAIN
// -------------------------
(async () => {
  const GENESIS_FILE = mustEnv("GENESIS_FILE");
  const WALLET_PASS = process.env.WALLET_PASS || "minha_senha_teste";

  // Trustee via ENV
  const TRUSTEE_SEED = mustEnv("TRUSTEE_SEED");
  const TRUSTEE_DID = mustEnv("TRUSTEE_DID");

  // Pastas
  const walletsDir = path.join(__dirname, "..", "wallets");
  fs.mkdirSync(walletsDir, { recursive: true });

  const exchangeDir = path.join(__dirname, "exchange_2creds_zkp18_strict_files");
  fs.mkdirSync(exchangeDir, { recursive: true });

  // Wallets (reset)
  const issuerWalletPath = path.join(walletsDir, "issuer_2creds_zkp18_strict_files.db");
  const holderWalletPath = path.join(walletsDir, "holder_2creds_zkp18_strict_files.db");
  rmIfExists(issuerWalletPath);
  rmIfExists(holderWalletPath);

  // Agentes
  const issuer = new IndyAgent();
  const holder = new IndyAgent();

  // Arquivos "contexto público" (bootstrap)
  const issuerPubFile = pExchange(exchangeDir, "pub_issuer.json"); // DID + verkey (público)
  const holderPubFile = pExchange(exchangeDir, "pub_holder.json"); // DID + verkey (público)

  // Arquivo de IDs do ledger para o holder (schema/creddef ids)
  const ledgerIdsFile = pExchange(exchangeDir, "ledger_ids.json");

  try {
    // ============================================================
    // SETUP INDEPENDENTE (cada lado mantém seus segredos na wallet)
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
    // 1) Criar DIDs (issuer + holder) e publicar (via Trustee)
    //    + publicar verkeys públicas via arquivo (bootstrap)
    // ============================================================
    console.log("5) Issuer criando DID (createOwnDid)...");
    const [issuerDid_local, issuerVerkey_local] = await issuer.createOwnDid();
    writeJson(issuerPubFile, { did: issuerDid_local, verkey: issuerVerkey_local });

    console.log("6) Holder criando DID (createOwnDid)...");
    const [holderDid_local, holderVerkey_local] = await holder.createOwnDid();
    writeJson(holderPubFile, { did: holderDid_local, verkey: holderVerkey_local });

    console.log("7) Registrando DIDs no ledger (NYM) via Trustee...");
    await tryRegisterDid(issuer, GENESIS_FILE, TRUSTEE_DID, issuerDid_local, issuerVerkey_local, "ENDORSER");
    await tryRegisterDid(issuer, GENESIS_FILE, TRUSTEE_DID, holderDid_local, holderVerkey_local, null);

    // ============================================================
    // 2) Criar Schema + CredDef (2 credenciais)
    //    e gravar IDs em arquivo para o holder (sem "compartilhar variável")
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

    console.log("10) Issuer criando+registrando CredDef CPF...");
    const credDefCpfTag = `TAG_CPF_${Date.now()}`;
    const credDefCpfId_local = await issuer.createAndRegisterCredDef(
      GENESIS_FILE,
      issuerDid_local,
      schemaCpfId_local,
      credDefCpfTag
    );

    console.log("11) Issuer criando+registrando CredDef ENDERECO...");
    const credDefEndTag = `TAG_END_${Date.now()}`;
    const credDefEndId_local = await issuer.createAndRegisterCredDef(
      GENESIS_FILE,
      issuerDid_local,
      schemaEndId_local,
      credDefEndTag
    );

    // IDs "públicos" necessários para o holder buscar do ledger
    writeJson(ledgerIdsFile, {
      schemaCpfId: schemaCpfId_local,
      schemaEndId: schemaEndId_local,
      credDefCpfId: credDefCpfId_local,
      credDefEndId: credDefEndId_local
    });

    console.log("12) Garantindo Link Secret no holder...");
    try { await holder.createLinkSecret("default"); } catch (_) {}

    // ============================================================
    // FLUXO 1: CPF via arquivos cifrados (Offer -> Request -> Credential -> Receipt)
    // ============================================================
    // (holder NÃO usa variáveis do issuer; lê tudo que precisar de arquivos/ledger)
    console.log("13) Fluxo CPF (arquivos cifrados)...");
    const issuerPub = readJson(issuerPubFile);
    const holderPub = readJson(holderPubFile);
    const ids = readJson(ledgerIdsFile);

    // 13.1 Issuer cria Offer CPF e grava cifrado p/ holder
    console.log("13.1) Issuer criando Offer CPF e gravando (cifrado)...");
    const offerCpfId = `offer-cpf-${Date.now()}`;
    const offerCpfJson = await issuer.createCredentialOffer(ids.credDefCpfId, offerCpfId);

    const cpfOfferFile = pExchange(exchangeDir, "cpf_01_offer.enc.json");
    await encryptToFile(issuer, issuerPub.did, holderPub.verkey, offerCpfJson, cpfOfferFile);

    // 13.2 Holder lê Offer CPF (decifra) e cria Request CPF, grava cifrado p/ issuer
    console.log("13.2) Holder lendo Offer CPF e criando Request (cifrado)...");
    const offerCpfPlain = await decryptFromFile(holder, holderPub.did, issuerPub.verkey, cpfOfferFile);

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

    const cpfReqFile = pExchange(exchangeDir, "cpf_02_request.enc.json");
    await encryptToFile(holder, holderPub.did, issuerPub.verkey, reqCpfJson, cpfReqFile);

    // 13.3 Issuer lê Request CPF (decifra) e emite Credential CPF, grava cifrado p/ holder
    console.log("13.3) Issuer lendo Request CPF e emitindo Credential (cifrado)...");
    const reqCpfPlain = await decryptFromFile(issuer, issuerPub.did, holderPub.verkey, cpfReqFile);

    // ⚠️ Para predicado/ZKP: idade deve ser "string numérica" (ex: "35"), não número 35.
    const valuesCpf = {
      nome: "Edimar Veríssimo",
      cpf: "123.456.789-09",
      idade: "35"
    };

    const credCpfJson = await issuer.createCredential(
      ids.credDefCpfId,
      offerCpfJson,           // issuer tem localmente (não vai para o holder por variável)
      reqCpfPlain,
      JSON.stringify(valuesCpf)
    );

    const cpfCredFile = pExchange(exchangeDir, "cpf_03_credential.enc.json");
    await encryptToFile(issuer, issuerPub.did, holderPub.verkey, credCpfJson, cpfCredFile);

    // 13.4 Holder lê Credential CPF (decifra), Store, e grava receipt cifrado p/ issuer
    console.log("13.4) Holder lendo Credential CPF e fazendo Store + receipt (cifrado)...");
    const credCpfPlain = await decryptFromFile(holder, holderPub.did, issuerPub.verkey, cpfCredFile);

    const credCpfIdInWallet = "cred-cpf-file";
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
      cred_def_id: ids.credDefCpfId
    });

    const cpfReceiptFile = pExchange(exchangeDir, "cpf_04_store_receipt.enc.json");
    await encryptToFile(holder, holderPub.did, issuerPub.verkey, cpfReceipt, cpfReceiptFile);

    console.log("13.5) Issuer lendo receipt CPF (cifrado)...");
    const cpfReceiptPlain = await decryptFromFile(issuer, issuerPub.did, holderPub.verkey, cpfReceiptFile);
    if (!JSON.parse(cpfReceiptPlain)?.ok) throw new Error("CPF: receipt inválido.");
    console.log("✅ Store OK (CPF).");

    // ============================================================
    // FLUXO 2: ENDERECO via arquivos cifrados
    // ============================================================
    console.log("14) Fluxo ENDERECO (arquivos cifrados)...");

    // 14.1 Issuer cria Offer END e grava cifrado p/ holder
    console.log("14.1) Issuer criando Offer END e gravando (cifrado)...");
    const offerEndId = `offer-end-${Date.now()}`;
    const offerEndJson = await issuer.createCredentialOffer(ids.credDefEndId, offerEndId);

    const endOfferFile = pExchange(exchangeDir, "end_01_offer.enc.json");
    await encryptToFile(issuer, issuerPub.did, holderPub.verkey, offerEndJson, endOfferFile);

    // 14.2 Holder lê Offer END (decifra) e cria Request END, grava cifrado p/ issuer
    console.log("14.2) Holder lendo Offer END e criando Request (cifrado)...");
    const offerEndPlain = await decryptFromFile(holder, holderPub.did, issuerPub.verkey, endOfferFile);

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

    const endReqFile = pExchange(exchangeDir, "end_02_request.enc.json");
    await encryptToFile(holder, holderPub.did, issuerPub.verkey, reqEndJson, endReqFile);

    // 14.3 Issuer lê Request END (decifra) e emite Credential END, grava cifrado p/ holder
    console.log("14.3) Issuer lendo Request END e emitindo Credential (cifrado)...");
    const reqEndPlain = await decryptFromFile(issuer, issuerPub.did, holderPub.verkey, endReqFile);

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

    const endCredFile = pExchange(exchangeDir, "end_03_credential.enc.json");
    await encryptToFile(issuer, issuerPub.did, holderPub.verkey, credEndJson, endCredFile);

    // 14.4 Holder lê Credential END, Store, receipt cifrado p/ issuer
    console.log("14.4) Holder lendo Credential END e fazendo Store + receipt (cifrado)...");
    const credEndPlain = await decryptFromFile(holder, holderPub.did, issuerPub.verkey, endCredFile);

    const credEndIdInWallet = "cred-end-file";
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

    const endReceiptFile = pExchange(exchangeDir, "end_04_store_receipt.enc.json");
    await encryptToFile(holder, holderPub.did, issuerPub.verkey, endReceipt, endReceiptFile);

    console.log("14.5) Issuer lendo receipt END (cifrado)...");
    const endReceiptPlain = await decryptFromFile(issuer, issuerPub.did, holderPub.verkey, endReceiptFile);
    if (!JSON.parse(endReceiptPlain)?.ok) throw new Error("END: receipt inválido.");
    console.log("✅ Store OK (END).");

    // ============================================================
    // PROVA (2 credenciais + ZKP idade>=18) via arquivos cifrados
    // ============================================================
    console.log("15) Issuer criando Proof Request (2 creds + ZKP idade>=18) e gravando (cifrado)...");
    const presReq = {
      nonce: String(Date.now()),
      name: "proof-2creds-zkp18",
      version: "1.0",
      requested_attributes: {
        attr_nome: { name: "nome", restrictions: [{ cred_def_id: ids.credDefCpfId }] },
        attr_cpf: { name: "cpf", restrictions: [{ cred_def_id: ids.credDefCpfId }] },
        attr_endereco: { name: "endereco", restrictions: [{ cred_def_id: ids.credDefEndId }] }
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

    const proofReqFile = pExchange(exchangeDir, "proof_01_request.enc.json");
    await encryptToFile(issuer, issuerPub.did, holderPub.verkey, JSON.stringify(presReq), proofReqFile);

    console.log("16) Holder lendo Proof Request (cifrado), criando Presentation (2 creds + ZKP)...");
    const presReqPlain = await decryptFromFile(holder, holderPub.did, issuerPub.verkey, proofReqFile);
    const presReqObj = JSON.parse(presReqPlain);

    // Holder busca schemas/creddefs do ledger (sem "variáveis comuns")
    const schemaCpfJsonLedger = await holder.fetchSchemaFromLedger(GENESIS_FILE, ids.schemaCpfId);
    const schemaEndJsonLedger = await holder.fetchSchemaFromLedger(GENESIS_FILE, ids.schemaEndId);

    const credDefCpfJsonLedger2 = await holder.fetchCredDefFromLedger(GENESIS_FILE, ids.credDefCpfId);
    const credDefEndJsonLedger2 = await holder.fetchCredDefFromLedger(GENESIS_FILE, ids.credDefEndId);

    // Holder decide quais credenciais atendem cada attr + predicate
    const requestedCreds = {
      requested_attributes: {
        attr_nome: { cred_id: credCpfIdInWallet, revealed: true },
        attr_cpf: { cred_id: credCpfIdInWallet, revealed: true },
        attr_endereco: { cred_id: credEndIdInWallet, revealed: true }
      },
      requested_predicates: {
        pred_idade_ge_18: { cred_id: credCpfIdInWallet } // não revela idade, só prova o predicado
      }
    };

    // JSON.stringify(...) converte um valor JavaScript (objeto, array, etc.) em uma string JSON.
    // JSON.parse(...) faz o inverso do JSON.stringify: ele pega uma string em formato JSON e converte para um objeto/valor JavaScript.
    const schemasMap = JSON.stringify({
      [ids.schemaCpfId]: JSON.parse(schemaCpfJsonLedger),
      [ids.schemaEndId]: JSON.parse(schemaEndJsonLedger)
    });

    const credDefsMap = JSON.stringify({
      [ids.credDefCpfId]: JSON.parse(credDefCpfJsonLedger2),
      [ids.credDefEndId]: JSON.parse(credDefEndJsonLedger2)
    });

    const presJson = await holder.createPresentation(
      JSON.stringify(presReqObj),
      JSON.stringify(requestedCreds),
      schemasMap,
      credDefsMap
    );

    const presFile = pExchange(exchangeDir, "proof_02_presentation.enc.json");
    await encryptToFile(holder, holderPub.did, issuerPub.verkey, presJson, presFile);

    console.log("17) Issuer lendo Presentation (cifrado) e verificando...");
    const presPlain = await decryptFromFile(issuer, issuerPub.did, holderPub.verkey, presFile);

    const ok = await issuer.verifyPresentation(
      JSON.stringify(presReqObj),
      presPlain,
      schemasMap,
      credDefsMap
    );

    if (!ok) throw new Error("❌ verifyPresentation retornou false.");

    console.log("✅ OK: apresentação validada (2 credenciais + ZKP idade>=18).");
    const presObj = JSON.parse(presPlain);

    // Mostrando toda a apresentação (JSON) + detalhes de atributos revelados e predicados (ZKP)
    console.log("📝 JSON:", presPlain);

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
