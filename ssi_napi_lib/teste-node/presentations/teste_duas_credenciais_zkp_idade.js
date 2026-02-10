/*
PARA RODAR ESTE TESTE:
WALLET_PASS="minha_senha_teste" GENESIS_FILE=./genesis.txn \
node teste-node/presentations/teste_duas_credenciais_zkp_idade.js
*/

/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");

// Carrega o binding N-API da raiz (index.node) e extrai a classe IndyAgent
const { IndyAgent } = require(path.join(__dirname, "..", "..", "index.node"));

// Remove artefatos da wallet, se existirem, para permitir recriar do zero
function rmIfExists(walletDbPath) {
    const sidecar = `${walletDbPath}.kdf.json`;

    try { fs.unlinkSync(walletDbPath); } catch (_) { }
    try { fs.unlinkSync(sidecar); } catch (_) { }
    try { fs.unlinkSync(`${sidecar}.tmp`); } catch (_) { }
    try { fs.unlinkSync(`${walletDbPath}-shm`); } catch (_) { }
    try { fs.unlinkSync(`${walletDbPath}-wal`); } catch (_) { }
}

// Lê uma variável de ambiente obrigatória (ex.: GENESIS_FILE) e valida existência
function mustEnv(name) {
    const v = process.env[name];
    if (!v) throw new Error(`Env ${name} não definida.`);
    return v;
}

(async () => {
    const GENESIS_FILE = mustEnv("GENESIS_FILE");
    const WALLET_PASS = process.env.WALLET_PASS || "minha_senha_teste";

    // von-network padrão
    const TRUSTEE_SEED = process.env.TRUSTEE_SEED || "000000000000000000000000Trustee1";
    const TRUSTEE_DID = process.env.TRUSTEE_DID || "V4SGRU86Z58d6TV7PBUe6f";

    const walletsDir = path.join(__dirname, "..", "wallets");
    fs.mkdirSync(walletsDir, { recursive: true });

    const issuerWalletPath = path.join(walletsDir, "issuer_2creds_zkp.db");
    const holderWalletPath = path.join(walletsDir, "holder_2creds_zkp.db");

    // Reset limpo
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

        // -------------------------
        // DIDs no ledger
        // -------------------------
        console.log("5) Criando DID do emissor (issuer)...");
        const [issuerDid, issuerVerkey] = await issuer.createOwnDid();

        console.log("6) Registrando DID do emissor no ledger (ENDORSER)...");
        await issuer.registerDidOnLedger(GENESIS_FILE, TRUSTEE_DID, issuerDid, issuerVerkey, "ENDORSER");

        console.log("7) Criando DID do holder...");
        const [holderDid, holderVerkey] = await holder.createOwnDid();

        console.log("8) Registrando DID do holder no ledger (NONE)...");
        await issuer.registerDidOnLedger(GENESIS_FILE, TRUSTEE_DID, holderDid, holderVerkey, null);

        // -------------------------
        // Schemas + CredDefs
        // -------------------------
        console.log("9) Criando+registrando Schema CPF...");
        const schemaCpfId = await issuer.createAndRegisterSchema(
            GENESIS_FILE, issuerDid, "cpf", "1.0.0", ["nome", "cpf", "idade"]
        );

        console.log("10) Criando+registrando Schema ENDERECO...");
        const schemaEndId = await issuer.createAndRegisterSchema(
            GENESIS_FILE, issuerDid, "endereco", "1.0.0", ["nome", "endereco", "cidade", "estado"]
        );

        console.log("11) Criando+registrando CredDef CPF...");
        const credDefCpfId = await issuer.createAndRegisterCredDef(
            GENESIS_FILE, issuerDid, schemaCpfId, "TAG_CPF_V1"
        );

        console.log("12) Criando+registrando CredDef ENDERECO...");
        const credDefEndId = await issuer.createAndRegisterCredDef(
            GENESIS_FILE, issuerDid, schemaEndId, "TAG_END_V1"
        );

        // Link Secret do holder
        console.log("13) Garantindo Link Secret no holder...");
        try { await holder.createLinkSecret("default"); } catch (_) { }

        // ============================================================
        // Emissão CPF (idade=35) + Store
        // ============================================================
        console.log("14) Emitindo credencial CPF (idade=35)...");
        const offerCpfId = `offer-cpf-${Date.now()}`;
        const offerCpfJson = await issuer.createCredentialOffer(credDefCpfId, offerCpfId);

        const reqMetaCpfId = JSON.parse(offerCpfJson)?.nonce;
        if (!reqMetaCpfId) throw new Error("Offer CPF sem nonce (reqMetaId).");

        const credDefCpfJsonLedger = await holder.fetchCredDefFromLedger(GENESIS_FILE, credDefCpfId);

        const reqCpfJson = await holder.createCredentialRequest(
            "default", holderDid, credDefCpfJsonLedger, offerCpfJson
        );

        // CPF (adulto)
        const valuesCpf35 = {
            nome: "Edimar Veríssimo",
            cpf: "123.456.789-09",
            idade: "35" // string numérica (a lib detecta dígitos e usa encoded=35)
        };

        const credCpf35Json = await issuer.createCredential(
            credDefCpfId, offerCpfJson, reqCpfJson, JSON.stringify(valuesCpf35)
        );

        console.log("📝 credCpf35Json:", credCpf35Json);

        const credCpf35IdInWallet = "cred-cpf-35";
        await holder.storeCredential(
            credCpf35IdInWallet, credCpf35Json, reqMetaCpfId, credDefCpfJsonLedger, null
        );

        // ============================================================
        // Emissão ENDERECO + Store
        // ============================================================
        console.log("15) Emitindo credencial ENDERECO...");
        const offerEndId = `offer-end-${Date.now()}`;
        const offerEndJson = await issuer.createCredentialOffer(credDefEndId, offerEndId);

        const reqMetaEndId = JSON.parse(offerEndJson)?.nonce;
        if (!reqMetaEndId) throw new Error("Offer ENDERECO sem nonce (reqMetaId).");

        const credDefEndJsonLedger = await holder.fetchCredDefFromLedger(GENESIS_FILE, credDefEndId);

        const reqEndJson = await holder.createCredentialRequest(
            "default", holderDid, credDefEndJsonLedger, offerEndJson
        );

        // ENDERECO
        const valuesEnd = {
            nome: "Edimar Veríssimo",
            endereco: "Rua Exemplo, 123",
            cidade: "São Paulo",
            estado: "SP"
        };

        const credEndJson = await issuer.createCredential(
            credDefEndId, offerEndJson, reqEndJson, JSON.stringify(valuesEnd)
        );

        const credEndIdInWallet = "cred-end";
        await holder.storeCredential(
            credEndIdInWallet, credEndJson, reqMetaEndId, credDefEndJsonLedger, null
        );

        // ============================================================
        // Emissão CPF (idade=17) + Store (para testar "menor que 18")
        // ============================================================
        console.log("16) Emitindo credencial CPF (idade=17) para teste de menoridade...");
        const offerCpfMinorId = `offer-cpf-minor-${Date.now()}`;
        const offerCpfMinorJson = await issuer.createCredentialOffer(credDefCpfId, offerCpfMinorId);

        const reqMetaCpfMinorId = JSON.parse(offerCpfMinorJson)?.nonce;
        if (!reqMetaCpfMinorId) throw new Error("Offer CPF(minor) sem nonce (reqMetaId).");

        const reqCpfMinorJson = await holder.createCredentialRequest(
            "default", holderDid, credDefCpfJsonLedger, offerCpfMinorJson
        );

        // CPF (menor)
        const valuesCpf17 = {
            nome: "Menor de Idade",
            cpf: "999.999.999-99",
            idade: "17"
        };

        const credCpf17Json = await issuer.createCredential(
            credDefCpfId, offerCpfMinorJson, reqCpfMinorJson, JSON.stringify(valuesCpf17)
        );

        const credCpf17IdInWallet = "cred-cpf-17";
        await holder.storeCredential(
            credCpf17IdInWallet, credCpf17Json, reqMetaCpfMinorId, credDefCpfJsonLedger, null
        );

        // ============================================================
        // Schemas/CredDefs para proof
        // ============================================================
        console.log("17) Preparando schemas/creddefs (ledger) para ZKP...");
        const schemaCpfJsonLedger = await holder.fetchSchemaFromLedger(GENESIS_FILE, schemaCpfId);
        const schemaEndJsonLedger = await holder.fetchSchemaFromLedger(GENESIS_FILE, schemaEndId);

        const schemasMap = JSON.stringify({
            [schemaCpfId]: JSON.parse(schemaCpfJsonLedger),
            [schemaEndId]: JSON.parse(schemaEndJsonLedger)
        });

        const credDefsMap = JSON.stringify({
            [credDefCpfId]: JSON.parse(credDefCpfJsonLedger),
            [credDefEndId]: JSON.parse(credDefEndJsonLedger)
        });

        // ============================================================
        // TESTE A: Provar ZKP "idade >= 18" usando CPF(idade=35) (deve PASSAR)
        // + revelar [nome, cpf, endereco]
        // ============================================================
        console.log("18) TESTE A: criando prova com ZKP idade >= 18 (CPF=35)...");
        const presReqAdult = {
            nonce: String(Date.now()),
            name: "proof-adulto-cpf-endereco",
            version: "1.0",
            requested_attributes: {
                attr_nome: { name: "nome", restrictions: [{ cred_def_id: credDefCpfId }] },
                attr_cpf: { name: "cpf", restrictions: [{ cred_def_id: credDefCpfId }] },
                attr_endereco: { name: "endereco", restrictions: [{ cred_def_id: credDefEndId }] }
            },
            requested_predicates: {
                // ZKP: provar que idade >= 18 sem revelar o valor de idade
                pred_idade_maior_igual_18: {
                    name: "idade",
                    p_type: ">=",
                    p_value: 18,
                    restrictions: [{ cred_def_id: credDefCpfId }]
                }
            }
        };

        const requestedCredsAdult = {
            requested_attributes: {
                attr_nome: { cred_id: credCpf35IdInWallet, revealed: true },
                attr_cpf: { cred_id: credCpf35IdInWallet, revealed: true },
                attr_endereco: { cred_id: credEndIdInWallet, revealed: true }
            },
            requested_predicates: {
                pred_idade_maior_igual_18: { cred_id: credCpf35IdInWallet }
            }
        };

        const presAdultJson = await holder.createPresentation(
            JSON.stringify(presReqAdult),
            JSON.stringify(requestedCredsAdult),
            schemasMap,
            credDefsMap
        );

        console.log("19) TESTE A: verificando prova (idade >= 18)...");
        const okAdult = await issuer.verifyPresentation(
            JSON.stringify(presReqAdult),
            presAdultJson,
            schemasMap,
            credDefsMap
        );

        console.log("📝 presAdultJson:", presAdultJson);

        if (!okAdult) throw new Error("❌ TESTE A falhou: idade>=18 deveria validar (CPF=35).");
        console.log("✅ TESTE A OK: ZKP idade>=18 validou (CPF=35).");

        // ============================================================
        // TESTE B: Provar ZKP "idade >= 18" usando CPF(idade=17) (deve FALHAR)
        // ============================================================
        console.log("20) TESTE B: criando prova com ZKP idade >= 18 (CPF=17)...");
        const presReqMinorAsAdult = {
            nonce: String(Date.now()),
            name: "proof-menor-tentando-adulto",
            version: "1.0",
            requested_attributes: {
                attr_nome: { name: "nome", restrictions: [{ cred_def_id: credDefCpfId }] }
            },
            requested_predicates: {
                pred_idade_maior_igual_18: {
                    name: "idade",
                    p_type: ">=",
                    p_value: 18,
                    restrictions: [{ cred_def_id: credDefCpfId }]
                }
            }
        };

        const requestedCredsMinorAsAdult = {
            requested_attributes: {
                attr_nome: { cred_id: credCpf17IdInWallet, revealed: true }
            },
            requested_predicates: {
                pred_idade_maior_igual_18: { cred_id: credCpf17IdInWallet }
            }
        };

        // Alguns engines podem lançar erro ao tentar criar prova impossível;
        // se lançar, consideramos "falha esperada" do TESTE B.
        let presMinorAsAdultJson = null;
        try {
            presMinorAsAdultJson = await holder.createPresentation(
                JSON.stringify(presReqMinorAsAdult),
                JSON.stringify(requestedCredsMinorAsAdult),
                schemasMap,
                credDefsMap
            );
        } catch (e) {
            console.log("✅ TESTE B OK: createPresentation falhou como esperado (CPF=17 não prova >=18).");
            presMinorAsAdultJson = null;
        }

        if (presMinorAsAdultJson) {
            console.log("21) TESTE B: verificando prova (esperado FALSE)...");
            const okMinorAsAdult = await issuer.verifyPresentation(
                JSON.stringify(presReqMinorAsAdult),
                presMinorAsAdultJson,
                schemasMap,
                credDefsMap
            );

            if (okMinorAsAdult) {
                throw new Error("❌ TESTE B falhou: CPF=17 NÃO deveria validar idade>=18.");
            }
            console.log("✅ TESTE B OK: verifyPresentation retornou false (CPF=17 não prova >=18).");
        }

        console.log("✅ OK: testes ZKP de maioridade/menoridade concluídos com sucesso.");

    } finally {
        try { await issuer.walletClose(); } catch (_) { }
        try { await holder.walletClose(); } catch (_) { }
    }
})().catch((e) => {
    console.error("FALHA NO TESTE:", e?.message || e);
    console.error(e?.stack || "");
    process.exit(1);
});
