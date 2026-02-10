/*
PARA RODAR ESTE TESTE:
WALLET_PASS="minha_senha_teste" GENESIS_FILE=./genesis.txn \
node teste-node/presentations/teste_uma_credencial_file_exchange_crypto.js

O QUE ESTE TESTE FAZ:
- Emissão de 1 credencial (CPF) com "troca por arquivos" entre Issuer e Holder:
  1) Issuer cria Offer -> grava offer.enc.json (cifrado p/ Holder)
  2) Holder lê Offer -> decifra -> cria Request -> grava request.enc.json (p/ Issuer)
  3) Issuer lê Request -> decifra -> emite Cred -> grava credential.enc.json (p/ Holder)
  4) Holder lê Cred -> decifra -> faz Store -> grava store_receipt.enc.json (p/ Issuer)
- Depois:
  5) Issuer grava proof_request.enc.json (p/ Holder)
  6) Holder cria Presentation -> grava presentation.enc.json (p/ Issuer)
  7) Issuer decifra e verifica a Presentation (1 credencial)
*/

/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");

// ✅ index.node fica na RAIZ do projeto (teste-node/presentations -> ../../index.node)
const { IndyAgent } = require(path.join(__dirname, "..", "..", "index.node"));

// Remove artefatos da wallet (db + sidecar + wal/shm)
function rmIfExists(walletDbPath) {
    const sidecar = `${walletDbPath}.kdf.json`;
    try { fs.unlinkSync(walletDbPath); } catch (_) { }
    try { fs.unlinkSync(sidecar); } catch (_) { }
    try { fs.unlinkSync(`${sidecar}.tmp`); } catch (_) { }
    try { fs.unlinkSync(`${walletDbPath}-shm`); } catch (_) { }
    try { fs.unlinkSync(`${walletDbPath}-wal`); } catch (_) { }
}

// Env obrigatória
function mustEnv(name) {
    const v = process.env[name];
    if (!v) throw new Error(`Env ${name} não definida.`);
    return v;
}

// Helper: mkdir + write
function writeFileAtomic(filePath, data) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, data, "utf8");
}

// Helper: read
function readFileUtf8(filePath) {
    return fs.readFileSync(filePath, "utf8");
}

/**
 * Encripta plaintext com a verkey do destinatário e salva em arquivo.
 * - senderAgent precisa ter o senderDid na wallet (com chave privada).
 * - recipientVerkey é a verkey pública do destinatário.
 */
async function encryptToFile(senderAgent, senderDid, recipientVerkey, plaintext, filePath) {
    const encryptedJson = await senderAgent.encryptMessage(
        senderDid,
        recipientVerkey,
        plaintext
    );
    writeFileAtomic(filePath, encryptedJson);
}

/**
 * Lê arquivo cifrado e decifra no agente receiver.
 * - receiverAgent precisa ter receiverDid na wallet (com chave privada).
 * - senderVerkey é a verkey pública do remetente (para AuthCrypt).
 */
async function decryptFromFile(receiverAgent, receiverDid, senderVerkey, filePath) {
    const encryptedJson = readFileUtf8(filePath);
    const plaintext = await receiverAgent.decryptMessage(
        receiverDid,
        senderVerkey,
        encryptedJson
    );
    return plaintext;
}

/**
 * Tenta registrar DID; se já existir no ledger, segue o teste.
 * (útil porque aqui vamos usar seeds estáveis)
 */
async function tryRegisterDid(issuerAgent, GENESIS_FILE, submitterDid, did, verkey, role) {
    try {
        await issuerAgent.registerDidOnLedger(
            GENESIS_FILE,
            submitterDid,
            did,
            verkey,
            role
        );
    } catch (e) {
        const msg = e?.message || String(e);
        // Heurística: já registrado / já existe => ignorar
        if (/already exists|exists|DID.*exist|NYM.*exist|Ledger/i.test(msg)) {
            console.log(`ℹ️ DID já estava no ledger, seguindo: ${did}`);
            return;
        }
        throw e;
    }
}

(async () => {
    const GENESIS_FILE = mustEnv("GENESIS_FILE");
    const WALLET_PASS = process.env.WALLET_PASS || "minha_senha_teste";

    // Trustee (von-network padrão)
    const TRUSTEE_SEED = process.env.TRUSTEE_SEED || "000000000000000000000000Trustee1";
    const TRUSTEE_DID = process.env.TRUSTEE_DID || "V4SGRU86Z58d6TV7PBUe6f";

    // Seeds estáveis para simular "decifragem via seed" (chave privada na wallet)
    // (32 chars, estilo Indy)
    // Seeds estáveis para simular "decifragem via seed" (chave privada na wallet)
    const ISSUER_SEED = process.env.ISSUER_SEED || "IssuerSeed0000000000000000000000";
    const HOLDER_SEED = process.env.HOLDER_SEED || "HolderSeed0000000000000000000000";

    // Pastas
    const walletsDir = path.join(__dirname, "..", "wallets");
    fs.mkdirSync(walletsDir, { recursive: true });

    const exchangeDir = path.join(__dirname, "exchange_1cred");
    fs.mkdirSync(exchangeDir, { recursive: true });

    // Wallets (reset)
    const issuerWalletPath = path.join(walletsDir, "issuer_1cred_files.db");
    const holderWalletPath = path.join(walletsDir, "holder_1cred_files.db");
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

        console.log("5) Importando DID do emissor (seed estável)...");
        const [issuerDid, issuerVerkey] = await issuer.importDidFromSeed(ISSUER_SEED);

        console.log("6) Importando DID do holder (seed estável)...");
        const [holderDid, holderVerkey] = await holder.importDidFromSeed(HOLDER_SEED);

        console.log("7) Garantindo DIDs no ledger (se já existir, ignora)...");
        await tryRegisterDid(issuer, GENESIS_FILE, TRUSTEE_DID, issuerDid, issuerVerkey, "ENDORSER");
        await tryRegisterDid(issuer, GENESIS_FILE, TRUSTEE_DID, holderDid, holderVerkey, null);

        console.log("8) Criando+registrando Schema CPF (versão única)...");
        const schemaVersion = `1.0.${Date.now()}`; // evita colisão se DID for fixo
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
        await encryptToFile(
            issuer,           // sender agent
            issuerDid,        // sender DID (resolve verkey e chave privada)
            holderVerkey,     // recipient verkey (public)
            offerCpfJson,     // plaintext (offer JSON)
            offerFile         // destino
        );

        // ============================================================
        // 2) Holder lê Offer, cria Request -> arquivo cifrado para Issuer
        // ============================================================
        console.log("12) Holder lendo Offer (arquivo), decifrando e criando Request...");
        const offerCpfJsonPlain = await decryptFromFile(
            holder,
            holderDid,
            issuerVerkey,
            offerFile
        );

        const offerCpfObj = JSON.parse(offerCpfJsonPlain);
        const reqMetaCpfId = offerCpfObj?.nonce;
        if (!reqMetaCpfId) throw new Error("Offer CPF sem nonce (reqMetaId).");

        const credDefCpfJsonLedger = await holder.fetchCredDefFromLedger(
            GENESIS_FILE,
            credDefCpfId
        );

        const reqCpfJson = await holder.createCredentialRequest(
            "default",
            holderDid,
            credDefCpfJsonLedger,
            offerCpfJsonPlain
        );

        const reqFile = path.join(exchangeDir, "02_request.enc.json");
        await encryptToFile(
            holder,
            holderDid,
            issuerVerkey,
            reqCpfJson,
            reqFile
        );

        // ============================================================
        // 3) Issuer lê Request, emite Credential -> arquivo cifrado para Holder
        // ============================================================
        console.log("13) Issuer lendo Request (arquivo), decifrando e emitindo Credencial...");
        const reqCpfJsonPlain = await decryptFromFile(
            issuer,
            issuerDid,
            holderVerkey,
            reqFile
        );

        const valuesCpf = {
            nome: "Edimar Veríssimo",
            cpf: "123.456.789-09",
            idade: "35"
        };

        const credCpfJson = await issuer.createCredential(
            credDefCpfId,
            offerCpfJson,          // offer original (issuer tem localmente)
            reqCpfJsonPlain,       // request decifrado
            JSON.stringify(valuesCpf)
        );

        const credFile = path.join(exchangeDir, "03_credential.enc.json");
        await encryptToFile(
            issuer,
            issuerDid,
            holderVerkey,
            credCpfJson,
            credFile
        );

        // ============================================================
        // 4) Holder lê Credential, faz Store -> grava "recibo" cifrado p/ Issuer
        // ============================================================
        console.log("14) Holder lendo Credential (arquivo), decifrando e armazenando na wallet...");
        const credCpfJsonPlain = await decryptFromFile(
            holder,
            holderDid,
            issuerVerkey,
            credFile
        );

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
        await encryptToFile(
            holder,
            holderDid,
            issuerVerkey,
            receipt,
            receiptFile
        );

        console.log("15) Issuer lendo recibo do store (arquivo) e decifrando...");
        const receiptPlain = await decryptFromFile(
            issuer,
            issuerDid,
            holderVerkey,
            receiptFile
        );
        const receiptObj = JSON.parse(receiptPlain);
        if (!receiptObj?.ok) throw new Error("Store receipt inválido.");
        console.log(`✅ Store OK (holder): cred_id=${receiptObj.cred_id}`);

        // ============================================================
        // PROVA: 1 credencial -> presentation request por arquivo
        // ============================================================
        console.log("16) Issuer criando Proof Request (1 credencial) e gravando p/ Holder...");
        const presReq = {
            nonce: String(Date.now()),
            name: "proof-cpf-single-cred",
            version: "1.0",
            requested_attributes: {
                attr_nome: {
                    name: "nome",
                    restrictions: [{ cred_def_id: credDefCpfId }]
                },
                attr_cpf: {
                    name: "cpf",
                    restrictions: [{ cred_def_id: credDefCpfId }]
                }
            },
            requested_predicates: {}
        };

        const presReqFile = path.join(exchangeDir, "05_proof_request.enc.json");
        await encryptToFile(
            issuer,
            issuerDid,
            holderVerkey,
            JSON.stringify(presReq),
            presReqFile
        );

        console.log("17) Holder lendo Proof Request (arquivo), criando Presentation...");
        const presReqPlain = await decryptFromFile(
            holder,
            holderDid,
            issuerVerkey,
            presReqFile
        );
        const presReqObj = JSON.parse(presReqPlain);

        const schemaCpfJsonLedger = await holder.fetchSchemaFromLedger(
            GENESIS_FILE,
            schemaCpfId
        );

        const requestedCreds = {
            requested_attributes: {
                attr_nome: { cred_id: credCpfIdInWallet, revealed: true },
                attr_cpf: { cred_id: credCpfIdInWallet, revealed: true }
            },
            requested_predicates: {}
        };

        const schemasMap = JSON.stringify({
            [schemaCpfId]: JSON.parse(schemaCpfJsonLedger)
        });

        const credDefsMap = JSON.stringify({
            [credDefCpfId]: JSON.parse(credDefCpfJsonLedger)
        });

        const presJson = await holder.createPresentation(
            JSON.stringify(presReqObj),
            JSON.stringify(requestedCreds),
            schemasMap,
            credDefsMap
        );

        const presFile = path.join(exchangeDir, "06_presentation.enc.json");
        await encryptToFile(
            holder,
            holderDid,
            issuerVerkey,
            presJson,
            presFile
        );

        // ============================================================
        // Verificação: Issuer lê Presentation por arquivo e verifica
        // ============================================================
        console.log("18) Issuer lendo Presentation (arquivo) e verificando...");
        const presPlain = await decryptFromFile(
            issuer,
            issuerDid,
            holderVerkey,
            presFile
        );

        const ok = await issuer.verifyPresentation(
            JSON.stringify(presReqObj),
            presPlain,
            schemasMap,
            credDefsMap
        );

        if (!ok) throw new Error("❌ verifyPresentation retornou false.");

        console.log("✅ OK: apresentação validada (1 credencial).");
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
