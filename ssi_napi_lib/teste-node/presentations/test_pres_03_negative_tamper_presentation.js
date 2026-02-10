const path = require("path");
const fs = require("fs");
const {
    NETWORK_CONFIG,
    assert,
    downloadGenesisHttp,
    loadIndyAgent,
    fn,
    walletCreateOpenIdempotent,
    parseJsonSafe,
    extractNonce,
} = require("./_helpers");

function okNegativeVerify(resultOrErr) {
    // Se lançou erro: ok. Se retornou false: ok.
    if (resultOrErr instanceof Error) return true;
    return resultOrErr === false;
}

(async () => {
    const IndyAgent = loadIndyAgent();
    const pass = process.env.WALLET_PASS || "minha_senha_teste";

    const walletDir = path.join(__dirname, "..", "wallets");
    fs.mkdirSync(walletDir, { recursive: true });

    const issuerDb =
        process.env.WALLET_ISSUER || path.join(walletDir, "test_wallet_pres_issuer.db");
    const holderDb =
        process.env.WALLET_HOLDER || path.join(walletDir, "test_wallet_pres_holder.db");

    const genesisAbs = path.join(process.cwd(), NETWORK_CONFIG.genesisFile);

    console.log("🚀 TESTE PRES 03: negativo (tamper presentation)");
    console.log("Config:", { issuerDb, holderDb, genesisAbs });

    await downloadGenesisHttp(NETWORK_CONFIG.genesisUrl, genesisAbs);

    const issuer = new IndyAgent();
    const holder = new IndyAgent();

    await walletCreateOpenIdempotent(issuer, issuerDb, pass);
    await walletCreateOpenIdempotent(holder, holderDb, pass);

    try {
        await issuer.connectNetwork(genesisAbs);
        await holder.connectNetwork(genesisAbs);

        const importDidFromSeed = fn(issuer, "importDidFromSeed", "import_did_from_seed");
        const [issuerDid] = await importDidFromSeed(NETWORK_CONFIG.trusteeSeed);
        assert(issuerDid === NETWORK_CONFIG.trusteeDid, "Trustee DID inesperado");

        const createAndRegisterSchema = fn(issuer, "createAndRegisterSchema", "create_and_register_schema");
        const createAndRegisterCredDef = fn(issuer, "createAndRegisterCredDef", "create_and_register_cred_def");
        const fetchSchemaFromLedger = fn(issuer, "fetchSchemaFromLedger", "fetch_schema_from_ledger");
        const fetchCredDefFromLedger = fn(issuer, "fetchCredDefFromLedger", "fetch_cred_def_from_ledger");

        const schemaId = await createAndRegisterSchema(
            genesisAbs,
            issuerDid,
            `SchemaTamper_${Date.now()}`,
            `1.${Math.floor(Date.now() / 1000)}`,
            ["nome", "cpf", "idade"]
        );
        const credDefId = await createAndRegisterCredDef(
            genesisAbs,
            issuerDid,
            schemaId,
            `TAG_TAMPER_${Math.floor(Date.now() / 1000)}`
        );

        const schemaLedgerObj = parseJsonSafe(await fetchSchemaFromLedger(genesisAbs, schemaId));
        const credDefLedgerObj = parseJsonSafe(await fetchCredDefFromLedger(genesisAbs, credDefId));

        // Emitir + store uma cred
        const createCredentialOffer = fn(issuer, "createCredentialOffer", "create_credential_offer");
        const createLinkSecret = fn(holder, "createLinkSecret", "create_link_secret");
        const createDidV2 = fn(holder, "createDidV2", "create_did_v2");
        const createCredentialRequest = fn(holder, "createCredentialRequest", "create_credential_request");
        const createCredential = fn(issuer, "createCredential", "create_credential");
        const storeCredential = fn(holder, "storeCredential", "store_credential");

        await createLinkSecret("default");

        const offerJson = await createCredentialOffer(credDefId, `offer-tamper-${Date.now()}`);

        const didRaw = await createDidV2("{}");
        const didObj = typeof didRaw === "string" ? JSON.parse(didRaw) : didRaw;
        const holderDid = didObj.did || didObj.myDid || didObj.id;

        const requestJson = await createCredentialRequest("default", holderDid, JSON.stringify(credDefLedgerObj), offerJson);

        const nonce = extractNonce(offerJson);
        const values = { nome: "Alice", cpf: "12345678900", idade: "29" };
        const credentialJson = await createCredential(credDefId, offerJson, requestJson, JSON.stringify(values));

        const credentialId = `cred-tamper-${Date.now()}`;
        await storeCredential(credentialId, credentialJson, nonce, JSON.stringify(credDefLedgerObj), null);

        // Criar presentation válida
        const createPresentation = fn(holder, "createPresentation", "create_presentation");
        const verifyPresentation = fn(issuer, "verifyPresentation", "verify_presentation");

        const presReq = {
            nonce: String(Math.floor(Date.now() / 1000) * 1000000 + 222),
            name: "ProofReqTamper",
            version: "0.1",
            requested_attributes: { attr1_referent: { name: "nome" } },
            requested_predicates: {},
        };

        const reqCreds = {
            requested_attributes: {
                attr1_referent: { cred_id: credentialId, revealed: true },
            },
            requested_predicates: {},
        };

        const schemasMap = { [schemaId]: schemaLedgerObj };
        const credDefsMap = { [credDefId]: credDefLedgerObj };

        const presJson = await createPresentation(
            JSON.stringify(presReq),
            JSON.stringify(reqCreds),
            JSON.stringify(schemasMap),
            JSON.stringify(credDefsMap)
        );

        // Tamper: altera um byte/valor no JSON (mantendo JSON válido)
        // Tamper forte: altera um campo que participa do proof (ou, fallback, primeira string longa)
        const presObj = JSON.parse(presJson);

        function flipOneCharInString(s) {
            if (typeof s !== "string" || s.length < 5) return s;
            const i = Math.floor(s.length / 2);
            const ch = s[i];
            // se for dígito, troca por outro dígito; senão troca por 'A'
            if (ch >= "0" && ch <= "9") {
                const nd = ch === "9" ? "8" : "9";
                return s.slice(0, i) + nd + s.slice(i + 1);
            }
            return s.slice(0, i) + "A" + s.slice(i + 1);
        }

        const PROOF_KEYS = new Set([
            // campos típicos de provas CL / estruturas internas
            "a_prime", "e", "v", "m2", "c", "r", "t", "z",
            "u", "ur", "s", "alpha", "beta",
            "primary_proof", "eq_proof", "ge_proofs", "proofs",
            "proof", "signature", "witness", "m_hat", "t_hat", "tau_list",
        ]);

        function tamperInPlace(node) {
            if (!node || typeof node !== "object") return false;

            if (Array.isArray(node)) {
                for (const item of node) {
                    if (tamperInPlace(item)) return true;
                }
                return false;
            }

            // 1) tenta achar chaves “sensíveis”
            for (const [k, v] of Object.entries(node)) {
                if (PROOF_KEYS.has(k)) {
                    if (typeof v === "string") {
                        node[k] = flipOneCharInString(v);
                        return true;
                    }
                    if (typeof v === "number") {
                        node[k] = v + 1;
                        return true;
                    }
                    if (v && typeof v === "object") {
                        // desce e tenta adulterar dentro
                        if (tamperInPlace(v)) return true;
                    }
                }
            }

            // 2) fallback: adulterar a primeira string "grande" (quase sempre material criptográfico)
            for (const [k, v] of Object.entries(node)) {
                if (typeof v === "string" && v.length >= 32) {
                    node[k] = flipOneCharInString(v);
                    return true;
                }
                if (v && typeof v === "object") {
                    if (tamperInPlace(v)) return true;
                }
            }

            return false;
        }

        const didTamper = tamperInPlace(presObj);
        assert(didTamper, "Não consegui aplicar tamper (nenhum campo encontrado)");
        const tamperedJson = JSON.stringify(presObj);

        let resOrErr;
        try {
            const ok = await verifyPresentation(
                JSON.stringify(presReq),
                tamperedJson,
                JSON.stringify(schemasMap),
                JSON.stringify(credDefsMap)
            );
            resOrErr = ok;
        } catch (e) {
            resOrErr = e;
        }

        assert(okNegativeVerify(resOrErr), "verify_presentation não falhou como esperado após tamper");
        console.log("✅ OK: tamper detectado (false ou erro).");
        console.log("✅ OK: TESTE PRES 03 passou.");
    } finally {
        try { await issuer.walletClose(); } catch { }
        try { await holder.walletClose(); } catch { }
    }
})().catch((e) => {
    console.error("❌ FALHA TESTE PRES 03:", e && e.stack ? e.stack : e);
    process.exit(1);
});
