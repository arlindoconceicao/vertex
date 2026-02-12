/*
PARA RODAR ESTE TESTE:
TRUSTEE_SEED="000000000000000000000000Trustee1" \
TRUSTEE_DID="V4SGRU86Z58d6TV7PBUe6f" \
WALLET_PASS="minha_senha_teste" GENESIS_FILE=./genesis.txn \
node teste-node/presentations/teste_tres_credenciais_first_contact_anoncrypt_then_authcrypt_with_verifier_store_presentation_v1.js

O QUE ESTE TESTE FAZ (ISSUER + HOLDER + VERIFIER, COM LEDGER, E VERIFIER ARQUIVA APRESENTAÇÃO):
- Cria 3 wallets: issuer, holder, verifier
- Conecta os 3 na rede (ledger)
- Importa Trustee DID no issuer (para registrar NYM)
- Cria DIDs do issuer, holder, verifier via createOwnDid()
- Registra NYM de issuer/holder/verifier no ledger via Trustee
- FIRST CONTACT (ANONCRYPT):
  * Holder -> Issuer: bootstrap de holderDid/holderVerkey
  * Verifier -> Holder: bootstrap de verifierDid/verifierVerkey
- A PARTIR DAÍ (AUTHCRYPT):
  * Issuer emite 3 credenciais para Holder: CPF, ENDERECO, CONTATO (via envelopes)
  * Verifier envia Proof Request ao Holder (via authcrypt envelope)
  * Holder cria Presentation (3 credenciais + ZKP idade>=18) e envia ao Verifier (via authcrypt envelope)
  * Verifier verifica Presentation com schemas/creddefs do ledger
  * Verifier guarda a apresentação na própria wallet:
    - storePresentation(pres_id_local, presentation_json, presentation_request_json, meta_json)
  * Verifier lista e recupera (listPresentations/getStoredPresentation) e valida que está armazenada

IMPORTANTE:
- Não existe arquivo público separado (pub_*).
- Bootstraps anoncrypt carregam did/verkey no payload.
- Em cenário real, verkey do destinatário é conhecido via canal OOB (QR/convite/etc).
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

function pExchange(dir, name) {
    return path.join(dir, name);
}

function assert(cond, msg) {
    if (!cond) throw new Error(`ASSERT FAIL: ${msg}`);
}

function safeJsonParse(s, label) {
    try { return JSON.parse(s); } catch (e) {
        throw new Error(`${label}: JSON inválido: ${e?.message || e}`);
    }
}

// -------------------------
// Envelope file exchange
// -------------------------
async function packAuthcrypt(agent, senderDid, recipientVerkey, kind, threadId, plaintext, expiresAtMs = null, meta = null) {
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

    const rootExchangeDir = path.join(__dirname, "exchange_3actors_issuer_holder_verifier_store_presentation_v1");
    fs.mkdirSync(rootExchangeDir, { recursive: true });

    const threadId = `th_3actors_store_pres_${Date.now()}`;
    const exchangeDir = path.join(rootExchangeDir, threadId);
    fs.mkdirSync(exchangeDir, { recursive: true });

    // Wallets (reset)
    const issuerWalletPath = path.join(walletsDir, "issuer_3actors_store_pres_v1.db");
    const holderWalletPath = path.join(walletsDir, "holder_3actors_store_pres_v1.db");
    const verifierWalletPath = path.join(walletsDir, "verifier_3actors_store_pres_v1.db");
    rmIfExists(issuerWalletPath);
    rmIfExists(holderWalletPath);
    rmIfExists(verifierWalletPath);

    // Agentes
    const issuer = new IndyAgent();
    const holder = new IndyAgent();
    const verifier = new IndyAgent();

    // “Estado de contato” (aprendido em bootstraps anoncrypt)
    let holderDidLearnedByIssuer = null;
    let holderVerkeyLearnedByIssuer = null;

    let verifierDidLearnedByHolder = null;
    let verifierVerkeyLearnedByHolder = null;

    try {
        // ============================================================
        // SETUP
        // ============================================================
        console.log("1) Criando wallets...");
        await issuer.walletCreate(issuerWalletPath, WALLET_PASS);
        await holder.walletCreate(holderWalletPath, WALLET_PASS);
        await verifier.walletCreate(verifierWalletPath, WALLET_PASS);

        console.log("2) Abrindo wallets...");
        await issuer.walletOpen(issuerWalletPath, WALLET_PASS);
        await holder.walletOpen(holderWalletPath, WALLET_PASS);
        await verifier.walletOpen(verifierWalletPath, WALLET_PASS);

        console.log("3) Conectando na rede...");
        await issuer.connectNetwork(GENESIS_FILE);
        await holder.connectNetwork(GENESIS_FILE);
        await verifier.connectNetwork(GENESIS_FILE);

        console.log("4) Importando Trustee DID no issuer...");
        await issuer.importDidFromSeed(TRUSTEE_SEED);

        // ============================================================
        // DIDs + registrar no ledger
        // ============================================================
        console.log("5) Issuer criando DID (createOwnDid)...");
        const [issuerDid, issuerVerkey] = await issuer.createOwnDid();

        console.log("6) Holder criando DID (createOwnDid)...");
        const [holderDid, holderVerkey] = await holder.createOwnDid();

        console.log("7) Verifier criando DID (createOwnDid)...");
        const [verifierDid, verifierVerkey] = await verifier.createOwnDid();

        console.log("8) Registrando DIDs no ledger (NYM) via Trustee...");
        await tryRegisterDid(issuer, GENESIS_FILE, TRUSTEE_DID, issuerDid, issuerVerkey, "ENDORSER");
        await tryRegisterDid(issuer, GENESIS_FILE, TRUSTEE_DID, holderDid, holderVerkey, null);
        await tryRegisterDid(issuer, GENESIS_FILE, TRUSTEE_DID, verifierDid, verifierVerkey, null);

        // ============================================================
        // FIRST CONTACT 1 (anoncrypt): holder -> issuer (bootstrap)
        // ============================================================
        console.log("9) First contact: Holder -> Issuer (anoncrypt envelope)...");
        const helloIssuerPayload = JSON.stringify({
            type: "hello/anoncrypt",
            holderDid,
            holderVerkey,
            note: "bootstrap holder->issuer",
            ts: Date.now(),
        });

        const helloIssuerEnv = await packAnoncrypt(
            holder,
            issuerVerkey, // OOB knowledge do verkey do issuer
            "contact/hello",
            threadId,
            helloIssuerPayload,
            null,
            { step: "hello_issuer", phase: "first-contact" }
        );

        const helloIssuerFile = pExchange(exchangeDir, "00_hello_holder_to_issuer_anoncrypt.env.json");
        await writeEnvFile(helloIssuerFile, helloIssuerEnv);

        const { plaintext: helloIssuerPlain } = await readAndUnpackEnvFile(issuer, issuerDid, helloIssuerFile);
        const helloIssuerObj = safeJsonParse(helloIssuerPlain, "helloIssuerPlain");

        holderDidLearnedByIssuer = helloIssuerObj.holderDid;
        holderVerkeyLearnedByIssuer = helloIssuerObj.holderVerkey;

        assert(holderDidLearnedByIssuer && holderVerkeyLearnedByIssuer, "First contact holder->issuer inválido");
        console.log("✅ First contact OK. Issuer aprendeu holderDid/verkey.");

        // ============================================================
        // FIRST CONTACT 2 (anoncrypt): verifier -> holder (bootstrap)
        // ============================================================
        console.log("10) First contact: Verifier -> Holder (anoncrypt envelope)...");
        const helloHolderPayload = JSON.stringify({
            type: "hello/anoncrypt",
            verifierDid,
            verifierVerkey,
            note: "bootstrap verifier->holder",
            ts: Date.now(),
        });

        const helloHolderEnv = await packAnoncrypt(
            verifier,
            holderVerkey, // OOB knowledge do verkey do holder (simulado)
            "contact/hello",
            threadId,
            helloHolderPayload,
            null,
            { step: "hello_holder", phase: "first-contact" }
        );

        const helloHolderFile = pExchange(exchangeDir, "01_hello_verifier_to_holder_anoncrypt.env.json");
        await writeEnvFile(helloHolderFile, helloHolderEnv);

        const { plaintext: helloHolderPlain } = await readAndUnpackEnvFile(holder, holderDid, helloHolderFile);
        const helloHolderObj = safeJsonParse(helloHolderPlain, "helloHolderPlain");

        verifierDidLearnedByHolder = helloHolderObj.verifierDid;
        verifierVerkeyLearnedByHolder = helloHolderObj.verifierVerkey;

        assert(verifierDidLearnedByHolder && verifierVerkeyLearnedByHolder, "First contact verifier->holder inválido");
        console.log("✅ First contact OK. Holder aprendeu verifierDid/verkey.");

        // ============================================================
        // 3 Schemas + 3 CredDefs (issuer)
        // ============================================================
        console.log("11) Issuer criando+registrando Schemas...");
        const schemaCpfId = await issuer.createAndRegisterSchema(
            GENESIS_FILE, issuerDid, "cpf", `1.0.${Date.now()}`, ["nome", "cpf", "idade"]
        );
        const schemaEndId = await issuer.createAndRegisterSchema(
            GENESIS_FILE, issuerDid, "endereco", `1.0.${Date.now()}`, ["nome", "endereco", "cidade", "estado"]
        );
        const schemaContatoId = await issuer.createAndRegisterSchema(
            GENESIS_FILE, issuerDid, "contato", `1.0.${Date.now()}`, ["nome", "email", "telefone"]
        );

        console.log("12) Issuer criando+registrando CredDefs...");
        const credDefCpfId = await issuer.createAndRegisterCredDef(GENESIS_FILE, issuerDid, schemaCpfId, `TAG_CPF_${Date.now()}`);
        const credDefEndId = await issuer.createAndRegisterCredDef(GENESIS_FILE, issuerDid, schemaEndId, `TAG_END_${Date.now()}`);
        const credDefContatoId = await issuer.createAndRegisterCredDef(GENESIS_FILE, issuerDid, schemaContatoId, `TAG_CONTATO_${Date.now()}`);

        console.log("13) Garantindo Link Secret no holder...");
        try { await holder.createLinkSecret("default"); } catch (_) { }

        // ============================================================
        // FUNÇÕES LOCAIS: issue + store via envelopes (authcrypt)
        // ============================================================
        async function issueOne(credLabel, credDefId, valuesObj, credIdInWallet, filePrefix) {
            console.log(`-- Emissão ${credLabel}...`);

            const offerId = `offer-${credLabel}-${Date.now()}`;
            const offerJson = await issuer.createCredentialOffer(credDefId, offerId);

            await writeEnvFile(
                pExchange(exchangeDir, `${filePrefix}_01_offer.env.json`),
                await packAuthcrypt(issuer, issuerDid, holderVerkeyLearnedByIssuer, "ssi/cred/offer", threadId, offerJson, null, { step: `${credLabel}.offer` })
            );

            const { plaintext: offerPlain } = await readAndUnpackEnvFile(holder, holderDid, pExchange(exchangeDir, `${filePrefix}_01_offer.env.json`));
            const offerObj = safeJsonParse(offerPlain, `${credLabel}.offerPlain`);
            const reqMetaId = offerObj?.nonce;
            if (!reqMetaId) throw new Error(`${credLabel}: Offer sem nonce (reqMetaId).`);

            const credDefJsonLedger = await holder.fetchCredDefFromLedger(GENESIS_FILE, credDefId);

            const reqJson = await holder.createCredentialRequest("default", holderDid, credDefJsonLedger, offerPlain);

            await writeEnvFile(
                pExchange(exchangeDir, `${filePrefix}_02_request.env.json`),
                await packAuthcrypt(holder, holderDid, issuerVerkey, "ssi/cred/request", threadId, reqJson, null, { step: `${credLabel}.request` })
            );

            const { plaintext: reqPlain } = await readAndUnpackEnvFile(issuer, issuerDid, pExchange(exchangeDir, `${filePrefix}_02_request.env.json`));

            const credJson = await issuer.createCredential(credDefId, offerJson, reqPlain, JSON.stringify(valuesObj));

            await writeEnvFile(
                pExchange(exchangeDir, `${filePrefix}_03_credential.env.json`),
                await packAuthcrypt(issuer, issuerDid, holderVerkeyLearnedByIssuer, "ssi/cred/issue", threadId, credJson, null, { step: `${credLabel}.credential` })
            );

            const { plaintext: credPlain } = await readAndUnpackEnvFile(holder, holderDid, pExchange(exchangeDir, `${filePrefix}_03_credential.env.json`));

            await holder.storeCredential(credIdInWallet, credPlain, reqMetaId, credDefJsonLedger, null);

            const receipt = JSON.stringify({ ok: true, step: "storeCredential", kind: credLabel, cred_id: credIdInWallet, cred_def_id: credDefId });
            await writeEnvFile(
                pExchange(exchangeDir, `${filePrefix}_04_store_receipt.env.json`),
                await packAuthcrypt(holder, holderDid, issuerVerkey, "ssi/cred/store_receipt", threadId, receipt, null, { step: `${credLabel}.receipt` })
            );

            const { plaintext: receiptPlain } = await readAndUnpackEnvFile(issuer, issuerDid, pExchange(exchangeDir, `${filePrefix}_04_store_receipt.env.json`));
            if (!safeJsonParse(receiptPlain, `${credLabel}.receiptPlain`)?.ok) throw new Error(`${credLabel}: receipt inválido.`);

            console.log(`✅ Store OK (${credLabel}).`);

            return { credDefJsonLedger };
        }

        // ============================================================
        // EMITIR 3 CREDENCIAIS
        // ============================================================
        console.log("14) Emissão de 3 credenciais (issuer -> holder)...");
        const credCpfIdInWallet = "cred-cpf-file";
        const credEndIdInWallet = "cred-end-file";
        const credContatoIdInWallet = "cred-contato-file";

        // ⚠️ idade como string numérica para predicado
        await issueOne("cpf", credDefCpfId, { nome: "Edimar Veríssimo", cpf: "123.456.789-09", idade: "35" }, credCpfIdInWallet, "cpf");
        await issueOne("end", credDefEndId, { nome: "Edimar Veríssimo", endereco: "Rua Exemplo, 123", cidade: "São Paulo", estado: "SP" }, credEndIdInWallet, "end");
        await issueOne("contato", credDefContatoId, { nome: "Edimar Veríssimo", email: "edimar@example.com", telefone: "+55 11 99999-9999" }, credContatoIdInWallet, "contato");

        // ============================================================
        // VERIFIER CRIA PROOF REQUEST -> HOLDER (authcrypt)
        // ============================================================
        console.log("15) Verifier criando Proof Request e enviando ao Holder (authcrypt)...");
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
            pExchange(exchangeDir, "proof_01_request_from_verifier.env.json"),
            await packAuthcrypt(
                verifier,
                verifierDid,
                holderVerkey,                 // ✅ CERTO: recipient é o HOLDER
                "ssi/proof/request",
                threadId,
                JSON.stringify(presReq),
                null,
                { step: "proof.request", from: "verifier" }
            )
        );

        // ============================================================
        // HOLDER CRIA PRESENTATION -> VERIFIER (authcrypt)
        // ============================================================
        console.log("16) Holder criando Presentation e enviando ao Verifier (authcrypt)...");
        const { plaintext: presReqPlain } = await readAndUnpackEnvFile(holder, holderDid, pExchange(exchangeDir, "proof_01_request_from_verifier.env.json"));
        const presReqObj = safeJsonParse(presReqPlain, "presReqPlain");

        // Ledger fetch (holder)
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

        const schemasMapStr = JSON.stringify({
            [schemaCpfId]: safeJsonParse(schemaCpfJsonLedger, "schemaCpfJsonLedger"),
            [schemaEndId]: safeJsonParse(schemaEndJsonLedger, "schemaEndJsonLedger"),
            [schemaContatoId]: safeJsonParse(schemaContatoJsonLedger, "schemaContatoJsonLedger"),
        });

        const credDefsMapStr = JSON.stringify({
            [credDefCpfId]: safeJsonParse(credDefCpfJsonLedger2, "credDefCpfJsonLedger2"),
            [credDefEndId]: safeJsonParse(credDefEndJsonLedger2, "credDefEndJsonLedger2"),
            [credDefContatoId]: safeJsonParse(credDefContatoJsonLedger2, "credDefContatoJsonLedger2"),
        });

        const presJson = await holder.createPresentation(
            JSON.stringify(presReqObj),
            JSON.stringify(requestedCreds),
            schemasMapStr,
            credDefsMapStr
        );

        await writeEnvFile(
            pExchange(exchangeDir, "proof_02_presentation_to_verifier.env.json"),
            await packAuthcrypt(
                holder,
                holderDid,
                verifierVerkeyLearnedByHolder,
                "ssi/proof/presentation",
                threadId,
                presJson,
                null,
                { step: "proof.presentation", to: "verifier" }
            )
        );

        // ============================================================
        // VERIFIER VERIFICA E GUARDA A PRESENTATION NA WALLET
        // ============================================================
        console.log("17) Verifier recebendo Presentation (unpack)...");
        const { plaintext: presPlain } = await readAndUnpackEnvFile(verifier, verifierDid, pExchange(exchangeDir, "proof_02_presentation_to_verifier.env.json"));

        console.log("18) Verifier montando schemas/creddefs via ledger e verificando...");
        // (verifier também busca do ledger — cenário real)
        const schemaCpfJsonLedgerV = await verifier.fetchSchemaFromLedger(GENESIS_FILE, schemaCpfId);
        const schemaEndJsonLedgerV = await verifier.fetchSchemaFromLedger(GENESIS_FILE, schemaEndId);
        const schemaContatoJsonLedgerV = await verifier.fetchSchemaFromLedger(GENESIS_FILE, schemaContatoId);

        const credDefCpfJsonLedgerV = await verifier.fetchCredDefFromLedger(GENESIS_FILE, credDefCpfId);
        const credDefEndJsonLedgerV = await verifier.fetchCredDefFromLedger(GENESIS_FILE, credDefEndId);
        const credDefContatoJsonLedgerV = await verifier.fetchCredDefFromLedger(GENESIS_FILE, credDefContatoId);

        const schemasMapVStr = JSON.stringify({
            [schemaCpfId]: safeJsonParse(schemaCpfJsonLedgerV, "schemaCpfJsonLedgerV"),
            [schemaEndId]: safeJsonParse(schemaEndJsonLedgerV, "schemaEndJsonLedgerV"),
            [schemaContatoId]: safeJsonParse(schemaContatoJsonLedgerV, "schemaContatoJsonLedgerV"),
        });

        const credDefsMapVStr = JSON.stringify({
            [credDefCpfId]: safeJsonParse(credDefCpfJsonLedgerV, "credDefCpfJsonLedgerV"),
            [credDefEndId]: safeJsonParse(credDefEndJsonLedgerV, "credDefEndJsonLedgerV"),
            [credDefContatoId]: safeJsonParse(credDefContatoJsonLedgerV, "credDefContatoJsonLedgerV"),
        });

        const ok = await verifier.verifyPresentation(
            JSON.stringify(presReqObj),
            presPlain,
            schemasMapVStr,
            credDefsMapVStr
        );

        if (!ok) throw new Error("❌ Verifier: verifyPresentation retornou false.");
        console.log("✅ OK: Verifier validou a apresentação (3 credenciais + ZKP idade>=18).");

        console.log("19) Verifier armazenando a apresentação na wallet (storePresentation)...");
        const presIdLocal = `pres-received-${Date.now()}`;
        const meta = {
            role: "verifier",
            verified: true,
            verified_at: Date.now(),
            thread_id: threadId,
            from_holder_did: holderDid,
            note: "presentation recebida e arquivada pelo verifier",
        };

        await verifier.storePresentation(
            presIdLocal,
            presPlain,                         // presentation_json
            JSON.stringify(presReqObj),        // presentation_request_json
            JSON.stringify(meta)               // meta_json
        );

        console.log("20) Verifier listPresentations + getStoredPresentation (validar persistência)...");
        const listStr = await verifier.listPresentations();
        const listArr = safeJsonParse(listStr, "listStr");
        const found = listArr.find((x) => x && x.id_local === presIdLocal);
        assert(!!found, "Verifier: listPresentations deve conter a apresentação armazenada");

        const recStr = await verifier.getStoredPresentation(presIdLocal);
        const recObj = safeJsonParse(recStr, "recStr");

        assert(recObj.presentation, "recObj.presentation ausente");
        assert(recObj.presentation_request, "recObj.presentation_request ausente");
        assert(recObj.meta && recObj.meta.verified === true, "recObj.meta.verified inconsistente");
        assert(recObj.presentation_request.nonce === presReqObj.nonce, "nonce do request inconsistente no record armazenado");

        console.log("✅ OK: Verifier arquivou a apresentação e conseguiu listar/recuperar.");

        // ============================================================
        // 21) Verifier exporta a apresentação (package) e testa import (roundtrip)
        // ============================================================
        console.log("21) Verifier exportStoredPresentation + importStoredPresentation (roundtrip)...");

        // 21.1 Export: gerar package JSON e salvar em arquivo no exchangeDir
        const pkgStr = await verifier.exportStoredPresentation(presIdLocal);

        const pkgObj = JSON.parse(pkgStr);
        if (pkgObj.type !== "ssi.presentation.package" || pkgObj.version !== 1) {
            throw new Error(`Package inválido: type/version inesperados (${pkgObj.type}/${pkgObj.version})`);
        }

        const pkgFile = pExchange(exchangeDir, `verifier_21_exported_presentation_${presIdLocal}.package.json`);
        await writeEnvFile(pkgFile, pkgStr);
        console.log(`📦 Package exportado salvo em: ${pkgFile}`);

        // 21.2 Delete: remover item original do wallet (para provar roundtrip)
        console.log("21.2) Verifier deleteStoredPresentation (para provar import)...");
        await verifier.deleteStoredPresentation(presIdLocal);

        // 21.3 Validar que sumiu
        let missingOk = false;
        try {
            await verifier.getStoredPresentation(presIdLocal);
        } catch (e) {
            missingOk = true;
        }
        if (!missingOk) throw new Error("Verifier: esperado getStoredPresentation falhar após delete (antes do import).");

        // 21.4 Import: restaurar como novo id_local (evita conflito e demonstra clone/restore)
        console.log("21.4) Verifier importStoredPresentation (restore com new_id_local)...");
        const restoredId = `${presIdLocal}-restored`;
        const importedId = await verifier.importStoredPresentation(pkgStr, false, restoredId);
        if (importedId !== restoredId) throw new Error("Verifier: importStoredPresentation não retornou restoredId.");

        // 21.5 Validar: list + get
        console.log("21.5) Verifier listPresentations + getStoredPresentation (validar restore)...");
        const list21Str = await verifier.listPresentations();
        const list21Arr = JSON.parse(list21Str);
        const foundRestored = list21Arr.find((x) => x && x.id_local === restoredId);
        if (!foundRestored) throw new Error("Verifier: restoredId não apareceu na listPresentations.");

        const rec21Str = await verifier.getStoredPresentation(restoredId);
        const rec21Obj = JSON.parse(rec21Str);

        // Confere que request_nonce foi preservado pelo package (tags) e que o nonce do request bate
        if (rec21Obj.presentation_request?.nonce !== presReqObj.nonce) {
            throw new Error("Verifier: nonce do presentation_request não bate após import.");
        }

        console.log("✅ OK: export/import roundtrip no Verifier (apresentação arquivada e restaurada).");
        console.log(`📁 Arquivos gerados em: ${exchangeDir}`);
    } finally {
        try { await issuer.walletClose(); } catch (_) { }
        try { await holder.walletClose(); } catch (_) { }
        try { await verifier.walletClose(); } catch (_) { }
    }
})().catch((e) => {
    console.error("FALHA NO TESTE:", e?.message || e);
    console.error(e?.stack || "");
    process.exit(1);
});
