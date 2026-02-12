/*
PARA RODAR ESTE TESTE (NEGATIVO: verifyPresentation deve falhar):
TRUSTEE_SEED="000000000000000000000000Trustee1" \
TRUSTEE_DID="V4SGRU86Z58d6TV7PBUe6f" \
WALLET_PASS="minha_senha_teste" GENESIS_FILE=./genesis.txn \
node teste-node/presentations/teste_or_emissores_negative_no_credB_contato_verify_must_fail.js

CENÁRIO:
- 2 emissores (A e B) + holder
- A emite CPF/END/CONTATO
- B emite CPF/END (⚠️ NÃO emite CONTATO)
- Proof Request:
  - CPF: OR(A|B) com issuer_did + schema_id + cred_def_id estritos
  - END: OR(A|B) idem
  - CONTATO: SOMENTE B (restrição única e estrita)
- Como holder não tem CONTATO B, a prova correta é IMPOSSÍVEL.
- Observação empírica: createPresentation pode não falhar e gerar uma apresentação inválida.
- Objetivo do teste: confirmar que verifyPresentation reprova (retorna false).
*/

/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const { IndyAgent } = require(path.join(__dirname, "..", "..", "index.node"));

function rmIfExists(walletDbPath) {
  const sidecar = `${walletDbPath}.kdf.json`;
  try { fs.unlinkSync(walletDbPath); } catch (_) { }
  try { fs.unlinkSync(sidecar); } catch (_) { }
  try { fs.unlinkSync(`${sidecar}.tmp`); } catch (_) { }
  try { fs.unlinkSync(`${walletDbPath}-shm`); } catch (_) { }
  try { fs.unlinkSync(`${walletDbPath}-wal`); } catch (_) { }
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

async function encryptToFile(senderAgent, senderDid, recipientVerkey, plaintext, filePath) {
  const encryptedJson = await senderAgent.encryptMessage(senderDid, recipientVerkey, plaintext);
  writeFileAtomic(filePath, encryptedJson);
}
async function decryptFromFile(receiverAgent, receiverDid, senderVerkey, filePath) {
  const encryptedJson = readFileUtf8(filePath);
  return receiverAgent.decryptMessage(receiverDid, senderVerkey, encryptedJson);
}

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
  console.log(`${prefix}.1) Issuer criando Offer ${kind} e gravando (cifrado)...`);
  const offerId = `offer-${kind}-${Date.now()}`;
  const offerJson = await issuerAgent.createCredentialOffer(credDefId, offerId);
  const offerFile = pExchange(exchangeDir, `${kind}_01_offer_${prefix}.enc.json`);
  await encryptToFile(issuerAgent, issuerPub.did, holderPub.verkey, offerJson, offerFile);

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

  console.log(`${prefix}.4) Holder lendo Credential ${kind} e fazendo Store...`);
  const credPlain = await decryptFromFile(holderAgent, holderPub.did, issuerPub.verkey, credFile);

  await holderAgent.storeCredential(holderCredIdInWallet, credPlain, reqMetaId, credDefJsonLedger, null);
  console.log(`✅ Store OK (${kind}) [${prefix}] -> cred_id=${holderCredIdInWallet}`);
}

(async () => {
  const GENESIS_FILE = mustEnv("GENESIS_FILE");
  const WALLET_PASS = process.env.WALLET_PASS || "minha_senha_teste";
  const TRUSTEE_SEED = mustEnv("TRUSTEE_SEED");
  const TRUSTEE_DID = mustEnv("TRUSTEE_DID");

  const walletsDir = path.join(__dirname, "..", "wallets");
  fs.mkdirSync(walletsDir, { recursive: true });

  const exchangeDir = path.join(__dirname, "exchange_or_2issuers_negative_no_b_contato_verify_fail");
  fs.mkdirSync(exchangeDir, { recursive: true });

  const issuerAWalletPath = path.join(walletsDir, "issuerA_or_neg_verify_fail.db");
  const issuerBWalletPath = path.join(walletsDir, "issuerB_or_neg_verify_fail.db");
  const holderWalletPath = path.join(walletsDir, "holder_or_neg_verify_fail.db");
  rmIfExists(issuerAWalletPath);
  rmIfExists(issuerBWalletPath);
  rmIfExists(holderWalletPath);

  const issuerA = new IndyAgent(); // verificador por conveniência
  const issuerB = new IndyAgent();
  const holder = new IndyAgent();

  const issuerAPubFile = pExchange(exchangeDir, "pub_issuerA.json");
  const issuerBPubFile = pExchange(exchangeDir, "pub_issuerB.json");
  const holderPubFile = pExchange(exchangeDir, "pub_holder.json");
  const ledgerIdsFile = pExchange(exchangeDir, "ledger_ids.json");

  try {
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

    console.log("4) Importando Trustee DID no Issuer A...");
    await issuerA.importDidFromSeed(TRUSTEE_SEED);

    console.log("5) Issuer A criando DID...");
    const [issuerADid, issuerAVerkey] = await issuerA.createOwnDid();
    writeJson(issuerAPubFile, { did: issuerADid, verkey: issuerAVerkey });

    console.log("6) Issuer B criando DID...");
    const [issuerBDid, issuerBVerkey] = await issuerB.createOwnDid();
    writeJson(issuerBPubFile, { did: issuerBDid, verkey: issuerBVerkey });

    console.log("7) Holder criando DID...");
    const [holderDid, holderVerkey] = await holder.createOwnDid();
    writeJson(holderPubFile, { did: holderDid, verkey: holderVerkey });

    console.log("8) Registrando DIDs no ledger via Trustee...");
    await tryRegisterDid(issuerA, GENESIS_FILE, TRUSTEE_DID, issuerADid, issuerAVerkey, "ENDORSER");
    await tryRegisterDid(issuerA, GENESIS_FILE, TRUSTEE_DID, issuerBDid, issuerBVerkey, "ENDORSER");
    await tryRegisterDid(issuerA, GENESIS_FILE, TRUSTEE_DID, holderDid, holderVerkey, null);

    console.log("9) Issuer A criando Schemas+CredDefs...");
    const aSchemaCpfId = await issuerA.createAndRegisterSchema(GENESIS_FILE, issuerADid, "cpf", `1.0.${Date.now()}`, ["nome", "cpf", "idade"]);
    const aSchemaEndId = await issuerA.createAndRegisterSchema(GENESIS_FILE, issuerADid, "endereco", `1.0.${Date.now()}`, ["nome", "endereco", "cidade", "estado"]);
    const aSchemaConId = await issuerA.createAndRegisterSchema(GENESIS_FILE, issuerADid, "contato", `1.0.${Date.now()}`, ["nome", "email", "telefone"]);

    const aCredDefCpfId = await issuerA.createAndRegisterCredDef(GENESIS_FILE, issuerADid, aSchemaCpfId, `A_TAG_CPF_${Date.now()}`);
    const aCredDefEndId = await issuerA.createAndRegisterCredDef(GENESIS_FILE, issuerADid, aSchemaEndId, `A_TAG_END_${Date.now()}`);
    const aCredDefConId = await issuerA.createAndRegisterCredDef(GENESIS_FILE, issuerADid, aSchemaConId, `A_TAG_CON_${Date.now()}`);

    console.log("10) Issuer B criando Schemas+CredDefs...");
    const bSchemaCpfId = await issuerB.createAndRegisterSchema(GENESIS_FILE, issuerBDid, "cpf", `1.0.${Date.now()}`, ["nome", "cpf", "idade"]);
    const bSchemaEndId = await issuerB.createAndRegisterSchema(GENESIS_FILE, issuerBDid, "endereco", `1.0.${Date.now()}`, ["nome", "endereco", "cidade", "estado"]);
    const bSchemaConId = await issuerB.createAndRegisterSchema(GENESIS_FILE, issuerBDid, "contato", `1.0.${Date.now()}`, ["nome", "email", "telefone"]);

    const bCredDefCpfId = await issuerB.createAndRegisterCredDef(GENESIS_FILE, issuerBDid, bSchemaCpfId, `B_TAG_CPF_${Date.now()}`);
    const bCredDefEndId = await issuerB.createAndRegisterCredDef(GENESIS_FILE, issuerBDid, bSchemaEndId, `B_TAG_END_${Date.now()}`);
    const bCredDefConId = await issuerB.createAndRegisterCredDef(GENESIS_FILE, issuerBDid, bSchemaConId, `B_TAG_CON_${Date.now()}`);

    writeJson(ledgerIdsFile, {
      issuerA: {
        did: issuerADid, schemaCpfId: aSchemaCpfId, schemaEndId: aSchemaEndId, schemaContatoId: aSchemaConId,
        credDefCpfId: aCredDefCpfId, credDefEndId: aCredDefEndId, credDefContatoId: aCredDefConId
      },
      issuerB: {
        did: issuerBDid, schemaCpfId: bSchemaCpfId, schemaEndId: bSchemaEndId, schemaContatoId: bSchemaConId,
        credDefCpfId: bCredDefCpfId, credDefEndId: bCredDefEndId, credDefContatoId: bCredDefConId
      }
    });

    console.log("11) Garantindo Link Secret no holder...");
    try { await holder.createLinkSecret("default"); } catch (_) { }

    const pubA = readJson(issuerAPubFile);
    const pubB = readJson(issuerBPubFile);
    const pubH = readJson(holderPubFile);
    const ids = readJson(ledgerIdsFile);

    console.log("12) Emitindo credenciais: A emite CPF/END/CONTATO, B emite CPF/END (sem CONTATO)...");
    // A emite 3
    await issueAndStoreCredentialStrictFiles({
      kind: "cpf", prefix: "A12", GENESIS_FILE, exchangeDir,
      issuerAgent: issuerA, issuerPub: pubA, holderAgent: holder, holderPub: pubH,
      credDefId: ids.issuerA.credDefCpfId,
      valuesObj: { nome: "Edimar Veríssimo", cpf: "123.456.789-09", idade: "35" },
      holderCredIdInWallet: "credA-cpf"
    });
    await issueAndStoreCredentialStrictFiles({
      kind: "end", prefix: "A13", GENESIS_FILE, exchangeDir,
      issuerAgent: issuerA, issuerPub: pubA, holderAgent: holder, holderPub: pubH,
      credDefId: ids.issuerA.credDefEndId,
      valuesObj: { nome: "Edimar Veríssimo", endereco: "Rua Exemplo, 123", cidade: "São Paulo", estado: "SP" },
      holderCredIdInWallet: "credA-end"
    });
    await issueAndStoreCredentialStrictFiles({
      kind: "contato", prefix: "A14", GENESIS_FILE, exchangeDir,
      issuerAgent: issuerA, issuerPub: pubA, holderAgent: holder, holderPub: pubH,
      credDefId: ids.issuerA.credDefContatoId,
      valuesObj: { nome: "Edimar Veríssimo", email: "edimar@example.com", telefone: "+55 11 99999-9999" },
      holderCredIdInWallet: "credA-contato"
    });

    // B emite apenas 2 (CPF/END). NÃO emitir contato B.
    await issueAndStoreCredentialStrictFiles({
      kind: "cpf", prefix: "B15", GENESIS_FILE, exchangeDir,
      issuerAgent: issuerB, issuerPub: pubB, holderAgent: holder, holderPub: pubH,
      credDefId: ids.issuerB.credDefCpfId,
      valuesObj: { nome: "Edimar Veríssimo", cpf: "123.456.789-09", idade: "35" },
      holderCredIdInWallet: "credB-cpf"
    });
    await issueAndStoreCredentialStrictFiles({
      kind: "end", prefix: "B16", GENESIS_FILE, exchangeDir,
      issuerAgent: issuerB, issuerPub: pubB, holderAgent: holder, holderPub: pubH,
      credDefId: ids.issuerB.credDefEndId,
      valuesObj: { nome: "Edimar Veríssimo", endereco: "Rua Exemplo, 123", cidade: "São Paulo", estado: "SP" },
      holderCredIdInWallet: "credB-end"
    });

    // ============================================================
    // Proof Request: CPF/END OR(A|B), CONTATO somente B
    // ============================================================
    console.log("13) Verificador criando Proof Request: CPF/END OR(A|B), CONTATO somente B...");
    const rA_CPF = { issuer_did: ids.issuerA.did, schema_id: ids.issuerA.schemaCpfId, cred_def_id: ids.issuerA.credDefCpfId };
    const rB_CPF = { issuer_did: ids.issuerB.did, schema_id: ids.issuerB.schemaCpfId, cred_def_id: ids.issuerB.credDefCpfId };

    const rA_END = { issuer_did: ids.issuerA.did, schema_id: ids.issuerA.schemaEndId, cred_def_id: ids.issuerA.credDefEndId };
    const rB_END = { issuer_did: ids.issuerB.did, schema_id: ids.issuerB.schemaEndId, cred_def_id: ids.issuerB.credDefEndId };

    const rB_CON = { issuer_did: ids.issuerB.did, schema_id: ids.issuerB.schemaContatoId, cred_def_id: ids.issuerB.credDefContatoId };

    const presReq = {
      nonce: String(Date.now()),
      name: "neg-create-ok-verify-must-fail-no-contato-b",
      version: "1.0",
      requested_attributes: {
        attr_nome: { name: "nome", restrictions: [rA_CPF, rB_CPF] },
        attr_cpf: { name: "cpf", restrictions: [rA_CPF, rB_CPF] },
        attr_endereco: { name: "endereco", restrictions: [rA_END, rB_END] },
        attr_email: { name: "email", restrictions: [rB_CON] },
        attr_telefone: { name: "telefone", restrictions: [rB_CON] }
      },
      requested_predicates: {
        pred_idade_ge_18: { name: "idade", p_type: ">=", p_value: 18, restrictions: [rA_CPF, rB_CPF] }
      }
    };

    // envia proof request cifrado (verificador=issuerA)
    const proofReqFile = pExchange(exchangeDir, "proof_01_request.enc.json");
    await encryptToFile(issuerA, pubA.did, pubH.verkey, JSON.stringify(presReq), proofReqFile);

    // ============================================================
    // Holder cria Presentation (mesmo que inválida)
    // ============================================================
    console.log("14) Holder criando Presentation (pode ser inválida)...");
    const presReqPlain = await decryptFromFile(holder, pubH.did, pubA.verkey, proofReqFile);
    const presReqObj = JSON.parse(presReqPlain);

    const requestedCreds = {
      requested_attributes: {
        attr_nome: { cred_id: "credB-cpf", revealed: true },
        attr_cpf: { cred_id: "credB-cpf", revealed: true },
        attr_endereco: { cred_id: "credA-end", revealed: true },
        // não existe credB-contato, força o holder a "tentar algo"
        attr_email: { cred_id: "credA-contato", revealed: true },
        attr_telefone: { cred_id: "credA-contato", revealed: true }
      },
      requested_predicates: {
        pred_idade_ge_18: { cred_id: "credB-cpf" }
      }
    };

    // Maps A e B completos
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

    const presObj = JSON.parse(presJson);
    console.log("🔎 Identifiers (sub_proofs) da presentation gerada:", presObj.identifiers);

    // Assert explícito: garantir que o CONTATO usado é do Issuer A (A_TAG_CON),
    // provando que o holder gerou uma apresentação incompatível com "CONTATO somente B".
    const idsList = presObj.identifiers || [];
    const hasContatoA = idsList.some((it) => /:contato:/.test(it.schema_id) && /A_TAG_CON_/i.test(it.cred_def_id));
    if (!hasContatoA) {
      console.error("❌ ERRO: esperado que a presentation usasse CONTATO do Issuer A (A_TAG_CON), mas não foi o caso.");
      console.error("🔎 Identifiers:", idsList);
      process.exit(1);
    }
    console.log("✅ Assert OK: presentation usou CONTATO do Issuer A (incompatível), como esperado no cenário negativo.");


    // ============================================================
    // Verificador tenta verificar => DEVE falhar (ok=false)
    // ============================================================
    console.log("15) Verificador verificando Presentation (deve reprovar)...");

    try {
      const ok = await issuerA.verifyPresentation(
        JSON.stringify(presReqObj),
        presJson,
        schemasMap,
        credDefsMap
      );

      if (ok) {
        console.error("❌ ERRO: verifyPresentation retornou TRUE, mas deveria rejeitar (CONTATO B é impossível).");
        process.exit(1);
      }

      console.log("✅ OK (NEGATIVO): verifyPresentation retornou FALSE como esperado.");
      console.log(`📁 Arquivos gerados em: ${exchangeDir}`);
    } catch (e) {
      // ✅ Esse é o comportamento observado: o binding lança erro quando rejeita por restrictions
      const msg = e?.message || String(e);

      // Opcional: validar que a causa foi realmente "restriction validation"
      const looksLikeRestrictionFailure =
        /restriction validation failed|Proof rejected|\$or operator validation failed/i.test(msg);

      if (!looksLikeRestrictionFailure) {
        console.error("❌ ERRO: verifyPresentation falhou, mas com erro inesperado (não parece restriction failure).");
        console.error("🧾 Mensagem:", msg);
        process.exit(1);
      }

      console.log("✅ OK (NEGATIVO): verifyPresentation rejeitou como esperado (lançou exceção por restrictions).");
      console.log("🧾 Mensagem:", msg);
      console.log(`📁 Arquivos gerados em: ${exchangeDir}`);
    }
  } finally {
    try { await issuerA.walletClose(); } catch (_) { }
    try { await issuerB.walletClose(); } catch (_) { }
    try { await holder.walletClose(); } catch (_) { }
  }
})().catch((e) => {
  console.error("FALHA NO TESTE:", e?.message || e);
  console.error(e?.stack || "");
  process.exit(1);
});
