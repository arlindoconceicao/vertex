/* PARA RODAR USE
TRUSTEE_SEED="000000000000000000000000Trustee1" \
TRUSTEE_DID="V4SGRU86Z58d6TV7PBUe6f" \
WALLET_PASS="minha_senha_teste" GENESIS_FILE=./genesis.txn \
RESET_WALLET=1 \
node teste-node/test_wallet/test_wallet_12_regression_change_pass_pres_ok.js
*/

/* eslint-disable no-console */
"use strict";

/*
TESTE 12: REGRESSÃO - walletChangePass não pode quebrar credencial armazenada.
Baseado no teste 1 credencial com file exchange e novos DIDs.

Fluxo:
- Emite e armazena credencial no Holder
- Fecha wallet do Holder
- Troca senha (walletChangePass)
- Reabre com nova senha
- Cria presentation e verifica => deve continuar OK
*/

const fs = require("fs");
const path = require("path");

// index.node na raiz (teste-node/test_wallet -> ../../index.node)
const { IndyAgent } = require(path.join(__dirname, "..", "..", "index.node"));

// ---------- helpers ----------
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

async function encryptToFile(senderAgent, senderDid, recipientVerkey, plaintext, filePath) {
    const encryptedJson = await senderAgent.encryptMessage(senderDid, recipientVerkey, plaintext);
    writeFileAtomic(filePath, encryptedJson);
}

async function decryptFromFile(receiverAgent, receiverDid, senderVerkey, filePath) {
    const encryptedJson = readFileUtf8(filePath);
    const plaintext = await receiverAgent.decryptMessage(receiverDid, senderVerkey, encryptedJson);
    return plaintext;
}

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

// ---------- teste ----------
(async () => {
    const GENESIS_FILE = mustEnv("GENESIS_FILE");
    const WALLET_PASS = process.env.WALLET_PASS || "minha_senha_teste";

    const TRUSTEE_SEED = mustEnv("TRUSTEE_SEED");
    const TRUSTEE_DID = mustEnv("TRUSTEE_DID");

    const RESET_WALLET = process.env.RESET_WALLET === "1";

    const walletsDir = path.join(__dirname, "wallets");
    fs.mkdirSync(walletsDir, { recursive: true });

    const exchangeDir = path.join(__dirname, "exchange_regression_change_pass");
    fs.mkdirSync(exchangeDir, { recursive: true });

    const issuerWalletPath = path.join(walletsDir, "issuer_regression_change_pass.db");
    const holderWalletPath = path.join(walletsDir, "holder_regression_change_pass.db");

    if (RESET_WALLET) {
        rmIfExists(issuerWalletPath);
        rmIfExists(holderWalletPath);
    }

    const issuer = new IndyAgent();
    const holder = new IndyAgent();

    const NEW_WALLET_PASS = `nova_senha_${Date.now()}`;

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

        console.log("8) Criando+registrando Schema CPF (versão única)...");
        const schemaVersion = `1.0.${Date.now()}`;
        const schemaCpfId = await issuer.createAndRegisterSchema(
            GENESIS_FILE,
            issuerDid,
            "cpf",
            schemaVersion,
            ["nome", "cpf", "idade"]
        );

        console.log("9) Criando+registrando CredDef CPF (tag única)...");
        const credDefTag = `TAG_CPF_${Date.now()}`;
        const credDefCpfId = await issuer.createAndRegisterCredDef(
            GENESIS_FILE,
            issuerDid,
            schemaCpfId,
            credDefTag
        );

        console.log("10) Garantindo Link Secret no holder...");
        try { await holder.createLinkSecret("default"); } catch (_) { }

        // ============================================================
        // 1) OFFER -> arquivo cifrado para Holder
        // ============================================================
        console.log("11) Issuer criando Offer (CPF) e gravando em arquivo cifrado...");
        const offerCpfId = `offer-cpf-${Date.now()}`;
        const offerCpfJson = await issuer.createCredentialOffer(credDefCpfId, offerCpfId);

        const offerFile = path.join(exchangeDir, "01_offer.enc.json");
        await encryptToFile(issuer, issuerDid, holderVerkey, offerCpfJson, offerFile);

        // ============================================================
        // 2) Holder lê Offer, cria Request -> arquivo cifrado para Issuer
        // ============================================================
        console.log("12) Holder lendo Offer (arquivo), decifrando e criando Request...");
        const offerCpfJsonPlain = await decryptFromFile(holder, holderDid, issuerVerkey, offerFile);

        const offerCpfObj = JSON.parse(offerCpfJsonPlain);
        const reqMetaCpfId = offerCpfObj?.nonce;
        if (!reqMetaCpfId) throw new Error("Offer CPF sem nonce (reqMetaId).");

        const credDefCpfJsonLedger = await holder.fetchCredDefFromLedger(GENESIS_FILE, credDefCpfId);

        const reqCpfJson = await holder.createCredentialRequest(
            "default",
            holderDid,
            credDefCpfJsonLedger,
            offerCpfJsonPlain
        );

        const reqFile = path.join(exchangeDir, "02_request.enc.json");
        await encryptToFile(holder, holderDid, issuerVerkey, reqCpfJson, reqFile);

        // ============================================================
        // 3) Issuer lê Request, emite Credential -> arquivo cifrado para Holder
        // ============================================================
        console.log("13) Issuer lendo Request (arquivo), decifrando e emitindo Credencial...");
        const reqCpfJsonPlain = await decryptFromFile(issuer, issuerDid, holderVerkey, reqFile);

        const valuesCpf = { nome: "Edimar Veríssimo", cpf: "123.456.789-09", idade: "35" };

        const credCpfJson = await issuer.createCredential(
            credDefCpfId,
            offerCpfJson,           // offer original (issuer tem localmente)
            reqCpfJsonPlain,        // request decifrado
            JSON.stringify(valuesCpf)
        );

        const credFile = path.join(exchangeDir, "03_credential.enc.json");
        await encryptToFile(issuer, issuerDid, holderVerkey, credCpfJson, credFile);

        // ============================================================
        // 4) Holder lê Credential, faz Store -> grava recibo cifrado p/ Issuer
        // ============================================================
        console.log("14) Holder lendo Credential (arquivo), decifrando e armazenando na wallet...");
        const credCpfJsonPlain = await decryptFromFile(holder, holderDid, issuerVerkey, credFile);

        const credCpfIdInWallet = "cred-cpf-file";
        await holder.storeCredential(
            credCpfIdInWallet,
            credCpfJsonPlain,
            reqMetaCpfId,
            credDefCpfJsonLedger,
            null
        );

        const receipt = JSON.stringify({
            ok: true,
            step: "storeCredential",
            cred_id: credCpfIdInWallet,
            schema_id: schemaCpfId,
            cred_def_id: credDefCpfId
        });

        const receiptFile = path.join(exchangeDir, "04_store_receipt.enc.json");
        await encryptToFile(holder, holderDid, issuerVerkey, receipt, receiptFile);

        console.log("15) Issuer lendo recibo do store (arquivo) e decifrando...");
        const receiptPlain = await decryptFromFile(issuer, issuerDid, holderVerkey, receiptFile);
        const receiptObj = JSON.parse(receiptPlain);
        if (!receiptObj?.ok) throw new Error("Store receipt inválido.");
        console.log(`✅ Store OK (holder): cred_id=${receiptObj.cred_id}`);

        // ============================================================
        // 🔁 REGRESSÃO: trocar senha do Holder e reabrir
        // ============================================================
        console.log("16) REGRESSÃO: fechando wallet do Holder...");
        await holder.walletClose();

        console.log("17) REGRESSÃO: walletVerifyPass antiga deve ser true (antes da troca)...");
        const beforeOk = await holder.walletVerifyPass(holderWalletPath, WALLET_PASS);
        if (!beforeOk) throw new Error("walletVerifyPass antiga retornou false antes da troca.");

        console.log("18) REGRESSÃO: walletChangePass (holder)...");
        await holder.walletChangePass(holderWalletPath, WALLET_PASS, NEW_WALLET_PASS);

        console.log("19) REGRESSÃO: walletVerifyPass antiga => false / nova => true ...");
        const oldOk = await holder.walletVerifyPass(holderWalletPath, WALLET_PASS);
        const newOk = await holder.walletVerifyPass(holderWalletPath, NEW_WALLET_PASS);
        if (oldOk !== false) throw new Error("Senha antiga ainda valida após changePass (esperado false).");
        if (newOk !== true) throw new Error("Senha nova inválida após changePass (esperado true).");

        console.log("20) REGRESSÃO: reabrindo wallet do Holder com a NOVA senha...");
        await holder.walletOpen(holderWalletPath, NEW_WALLET_PASS);

        console.log("20.1) REGRESSÃO: reconectando rede no Holder...");
        await holder.connectNetwork(GENESIS_FILE);

        // ============================================================
        // PROVA: criar presentation após rekey e verificar no issuer
        // ============================================================
        console.log("21) Issuer criando Proof Request (1 credencial) e gravando p/ Holder...");
        const presReq = {
            nonce: String(Date.now()),
            name: "proof-cpf-single-cred-regression-change-pass",
            version: "1.0",
            requested_attributes: {
                attr_nome: { name: "nome", restrictions: [{ cred_def_id: credDefCpfId }] },
                attr_cpf: { name: "cpf", restrictions: [{ cred_def_id: credDefCpfId }] }
            },
            requested_predicates: {}
        };

        const presReqFile = path.join(exchangeDir, "05_proof_request.enc.json");
        await encryptToFile(issuer, issuerDid, holderVerkey, JSON.stringify(presReq), presReqFile);

        console.log("22) Holder lendo Proof Request (arquivo), criando Presentation...");
        const presReqPlain = await decryptFromFile(holder, holderDid, issuerVerkey, presReqFile);
        const presReqObj = JSON.parse(presReqPlain);

        const schemaCpfJsonLedger = await holder.fetchSchemaFromLedger(GENESIS_FILE, schemaCpfId);

        const requestedCreds = {
            requested_attributes: {
                attr_nome: { cred_id: credCpfIdInWallet, revealed: true },
                attr_cpf: { cred_id: credCpfIdInWallet, revealed: true }
            },
            requested_predicates: {}
        };

        const schemasMap = JSON.stringify({ [schemaCpfId]: JSON.parse(schemaCpfJsonLedger) });
        const credDefsMap = JSON.stringify({ [credDefCpfId]: JSON.parse(credDefCpfJsonLedger) });

        const presJson = await holder.createPresentation(
            JSON.stringify(presReqObj),
            JSON.stringify(requestedCreds),
            schemasMap,
            credDefsMap
        );

        const presFile = path.join(exchangeDir, "06_presentation.enc.json");
        await encryptToFile(holder, holderDid, issuerVerkey, presJson, presFile);

        console.log("23) Issuer lendo Presentation (arquivo) e verificando...");
        const presPlain = await decryptFromFile(issuer, issuerDid, holderVerkey, presFile);

        const ok = await issuer.verifyPresentation(
            JSON.stringify(presReqObj),
            presPlain,
            schemasMap,
            credDefsMap
        );

        if (!ok) throw new Error("❌ verifyPresentation retornou false.");

        console.log("✅ OK: apresentação validada após walletChangePass (regressão passou).");
        console.log("📝 Revealed:", JSON.parse(presPlain).requested_proof.revealed_attrs);
        console.log(`📁 Arquivos gerados em: ${exchangeDir}`);
    } finally {
        try { await issuer.walletClose(); } catch (_) { }
        try { await holder.walletClose(); } catch (_) { }
    }
})().catch((e) => {
    console.error("FALHA NO TESTE:", e?.message || e);
    console.error(e?.stack || "");
    process.exit(1);
});
