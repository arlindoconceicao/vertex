/*
PARA RODAR ESTE TESTE:
WALLET_PASS="minha_senha_teste" GENESIS_FILE=./genesis.txn node teste-node/presentations/teste_duas_credenciais_e_presentation.js 
*/

/* eslint-disable no-console */
// fs: módulo do Node para operações de arquivo/diretório (criar/remover wallets, etc.)
const fs = require("fs");
// path: monta caminhos de forma portável (evita concatenar strings com / ou \)
const path = require("path");

// ✅ index.node fica na RAIZ do projeto
// teste-node/presentations -> ../../index.node
// Carrega o binding N-API da raiz (index.node) e extrai a classe IndyAgent
const { IndyAgent } = require(path.join(__dirname, "..", "..", "index.node"));

// Remove artefatos da wallet, se existirem, para permitir recriar do zero
function rmIfExists(walletDbPath) {
    // Sidecar usado pela lib para guardar parâmetros KDF (derivação de chave)
    const sidecar = `${walletDbPath}.kdf.json`;

    // Apaga o arquivo do banco SQLite principal da wallet (se existir)
    try { fs.unlinkSync(walletDbPath); } catch (_) { }

    // Apaga o sidecar KDF e o temporário (evita "WalletAlreadyExists")
    try { fs.unlinkSync(sidecar); } catch (_) { }
    try { fs.unlinkSync(`${sidecar}.tmp`); } catch (_) { }

    // Apaga arquivos auxiliares do SQLite (Write-Ahead Logging / memória compartilhada)
    try { fs.unlinkSync(`${walletDbPath}-shm`); } catch (_) { }
    try { fs.unlinkSync(`${walletDbPath}-wal`); } catch (_) { }
}

// Lê uma variável de ambiente obrigatória (ex.: GENESIS_FILE) e valida existência
function mustEnv(name) {
    // Busca o valor em process.env (variáveis de ambiente do processo Node)
    const v = process.env[name];
    // Se não existir/estiver vazia, aborta o teste com erro claro
    if (!v) throw new Error(`Env ${name} não definida.`);

    // Retorna o valor para uso no restante do script
    return v;
}

(async () => {
    // -------------------------
    // Config do teste
    // -------------------------
    const GENESIS_FILE = mustEnv("GENESIS_FILE"); // ex: ./genesis.txn
    const WALLET_PASS = process.env.WALLET_PASS || "minha_senha_teste";

    // von-network padrão
    const TRUSTEE_SEED = process.env.TRUSTEE_SEED || "000000000000000000000000Trustee1";
    const TRUSTEE_DID = process.env.TRUSTEE_DID || "V4SGRU86Z58d6TV7PBUe6f";

    // Monta o caminho da pasta teste-node/wallets (um nível acima de presentations)
    const walletsDir = path.join(__dirname, "..", "wallets");
    // Cria a pasta se não existir; recursive evita erro se já existir
    fs.mkdirSync(walletsDir, { recursive: true });

    // Define o caminho do arquivo SQLite da wallet do emissor (issuer)
    const issuerWalletPath = path.join(walletsDir, "issuer_2creds.db");

    // Define o caminho do arquivo SQLite da wallet do portador (holder)
    const holderWalletPath = path.join(walletsDir, "holder_2creds.db");

    // Reset limpo
    // Remove arquivos da wallet do issuer (db + sidecar KDF + wal/shm), se existirem
    rmIfExists(issuerWalletPath);
    // Remove arquivos da wallet do holder (db + sidecar KDF + wal/shm), se existirem
    rmIfExists(holderWalletPath);

    // Cria uma instância do agente SSI para o emissor (usa a wallet/conexão dele)
    const issuer = new IndyAgent();
    // Cria uma instância do agente SSI para o holder (wallet/conexão separadas)
    const holder = new IndyAgent();

    try {
        // -------------------------
        // Wallet + Network
        // -------------------------
        // Log do passo: criação das wallets no disco (arquivos SQLite + sidecar KDF)
        console.log("1) Criando wallets...");
        // Cria a wallet do issuer em issuerWalletPath usando a senha WALLET_PASS
        await issuer.walletCreate(issuerWalletPath, WALLET_PASS);
        // Cria a wallet do holder em holderWalletPath usando a senha WALLET_PASS
        await holder.walletCreate(holderWalletPath, WALLET_PASS);

        // NOTA EM RELAÇÃO AOS NOMES DOS MÉTODOS NA LIB E NO BINDING
        // Porque o binding N-API expõe nomes em camelCase no JS.
        // No Rust (lib.rs) a função é `wallet_create`.
        // O gerador do binding (napi-rs / #[napi]) cria o wrapper JS como `walletCreate`.
        // Ou seja: wallet_create (Rust) -> walletCreate (JS), mesma função por baixo.

        console.log("2) Abrindo wallets...");
        // Abre a wallet do issuer (precisa da mesma senha usada na criação)
        await issuer.walletOpen(issuerWalletPath, WALLET_PASS);
        // Abre a wallet do holder (precisa da mesma senha usada na criação)
        await holder.walletOpen(holderWalletPath, WALLET_PASS);

        console.log("3) Conectando na rede...");
        // Conecta o issuer ao pool Indy definido pelo arquivo GENESIS_FILE
        await issuer.connectNetwork(GENESIS_FILE);
        // Conecta o holder ao mesmo pool (necessário para ler schemas/creddefs do ledger)
        await holder.connectNetwork(GENESIS_FILE);

        // Trustee no issuer (para assinar NYM e publicar no ledger)
        console.log("4) Importando Trustee DID no issuer...");
        // Deriva DID+verkey a partir da seed e grava na wallet do issuer (com chave privada)
        await issuer.importDidFromSeed(TRUSTEE_SEED);

        // -------------------------
        // 1) DID do emissor + registrar no ledger
        // -------------------------
        console.log("5) Criando DID do emissor (issuer)...");
        // Cria um novo DID "próprio" do issuer na wallet e retorna [did, verkey]
        const [issuerDid, issuerVerkey] = await issuer.createOwnDid();

        console.log("6) Registrando DID do emissor no ledger (ENDORSER)...");
        // Publica o DID do issuer no ledger (NYM), assinado pelo Trustee (submitter)
        await issuer.registerDidOnLedger(
            GENESIS_FILE,   // arquivo genesis para localizar/conectar ao pool
            TRUSTEE_DID,    // DID com permissão para escrever NYM (Trustee)
            issuerDid,      // DID que será registrado/publicado no ledger
            issuerVerkey,   // verkey do DID do issuer (chave pública)
            "ENDORSER"      // role do DID no ledger (issuer como ENDORSER)
        );

        // -------------------------
        // 2) DID do holder + registrar no ledger
        // -------------------------
        console.log("7) Criando DID do holder...");
        // Cria um DID próprio do holder na wallet e retorna [did, verkey]
        const [holderDid, holderVerkey] = await holder.createOwnDid();

        console.log("8) Registrando DID do holder no ledger (NONE)...");
        // Registra o DID do holder no ledger (NYM) usando o Trustee como submitter
        await issuer.registerDidOnLedger(
            GENESIS_FILE,  // genesis do pool
            TRUSTEE_DID,   // DID que assina a escrita no ledger
            holderDid,     // DID do holder a ser publicado
            holderVerkey,  // verkey do holder
            null           // role nula => usuário comum (sem privilégios no ledger)
        );

        // -------------------------
        // 3) Schema CPF
        // -------------------------
        console.log("9) Criando+registrando Schema CPF...");
        // Cria um Schema "cpf" com atributos e publica no ledger; retorna o schemaId
        const schemaCpfId = await issuer.createAndRegisterSchema(
            GENESIS_FILE,               // genesis do pool
            issuerDid,                  // DID do issuer (autor/publicador do schema)
            "cpf",                      // nome do schema
            "1.0.0",                    // versão do schema
            ["nome", "cpf", "idade"]    // lista de atributos do schema
        );

        // -------------------------
        // 4) Schema ENDERECO
        // -------------------------
        console.log("10) Criando+registrando Schema ENDERECO...");
        // Cria o Schema "endereco" e publica no ledger; retorna o schemaId gerado
        const schemaEndId = await issuer.createAndRegisterSchema(
            GENESIS_FILE,                                  // genesis do pool
            issuerDid,                                     // DID do issuer (publicador)
            "endereco",                                    // nome do schema
            "1.0.0",                                       // versão do schema
            ["nome", "endereco", "cidade", "estado"]       // atributos do schema
        );

        // -------------------------
        // 5) CredDef CPF
        // -------------------------
        console.log("11) Criando+registrando CredDef CPF...");
        // Cria uma CredDef para o schemaCpfId e publica no ledger; retorna credDefId
        const credDefCpfId = await issuer.createAndRegisterCredDef(
            GENESIS_FILE,  // genesis do pool
            issuerDid,     // DID do issuer (autor/publicador da CredDef)
            schemaCpfId,   // schemaId base para gerar a credencial (cpf)
            "TAG_CPF_V1"   // tag para diferenciar versões/instâncias da CredDef
        );

        // -------------------------
        // 6) CredDef ENDERECO
        // -------------------------
        console.log("12) Criando+registrando CredDef ENDERECO...");
        // Cria uma CredDef para o schemaEndId e publica no ledger; retorna credDefId
        const credDefEndId = await issuer.createAndRegisterCredDef(
            GENESIS_FILE,  // genesis do pool
            issuerDid,     // DID do issuer (publicador)
            schemaEndId,   // schemaId base para a credencial de endereco
            "TAG_END_V1"   // tag para versionar/diferenciar a CredDef
        );

        // Garantir Link Secret no holder
        console.log("13) Garantindo Link Secret no holder...");
        // Garante que o holder tenha um Link Secret (master secret) chamado "default"
        try {
            // Necessário para criar requests/provas; fica armazenado na wallet do holder
            await holder.createLinkSecret("default");
        } catch (_) {
            // Se já existir, a lib pode lançar erro; aqui ignoramos para seguir o teste
        }


        // ============================================================
        // 7-10) Emissão da credencial CPF (Offer → Request → Issue → Store)
        // ============================================================
        console.log("14) Emitindo credencial CPF (Offer→Request→Issue→Store)...");

        // Gera um id único para a oferta de credencial CPF (evita colisão em re-execuções)
        const offerCpfId = `offer-cpf-${Date.now()}`;
        // Issuer cria a Credential Offer para a CredDef CPF; retorna JSON da offer
        const offerCpfJson = await issuer.createCredentialOffer(credDefCpfId, offerCpfId);

        // Converte a offer JSON (string) em objeto para acessar seus campos
        const offerCpfObj = JSON.parse(offerCpfJson);
        // Extrai o nonce da offer; aqui ele é usado como id do "request metadata"
        const reqMetaCpfId = offerCpfObj?.nonce;
        // Se não houver nonce, não dá para vincular o store da credencial ao metadata
        if (!reqMetaCpfId) throw new Error("Offer CPF sem nonce (reqMetaId).");

        // Holder busca a CredDef CPF diretamente do ledger (necessário p/ cred request)
        const credDefCpfJsonLedger =
            await holder.fetchCredDefFromLedger(GENESIS_FILE, credDefCpfId);

        // Holder cria o Credential Request a partir da offer + credDef + link secret
        const reqCpfJson = await holder.createCredentialRequest(
            "default",            // nome do link secret (master secret) do holder
            holderDid,            // DID do holder (prover_did) usado no request
            credDefCpfJsonLedger, // credDef (JSON) obtida do ledger
            offerCpfJson          // offer (JSON) recebida do issuer
        );


        // Define os atributos da credencial CPF a serem emitidos
        const valuesCpf = {
            nome: "Edimar Veríssimo",
            cpf: "123.456.789-09",
            idade: "35"
        };

        // Issuer emite a credencial CPF: usa credDef + offer + request + values
        // Retorna a credencial assinada em JSON (pronta para o holder armazenar)
        const credCpfJson = await issuer.createCredential(
            credDefCpfId,              // credDefId usada na assinatura/emissão
            offerCpfJson,              // offer enviada ao holder
            reqCpfJson,                // request recebido do holder
            JSON.stringify(valuesCpf)  // valores (raw/encoded) serializados em JSON
        );

        // Define um id local para a credencial CPF dentro da wallet do holder
        const credCpfIdInWallet = "cred-cpf";

        // Armazena a credencial emitida na wallet do holder (linka com req metadata)
        await holder.storeCredential(
            credCpfIdInWallet,     // id local (referência interna na wallet)
            credCpfJson,           // credencial assinada (JSON) recebida do issuer
            reqMetaCpfId,          // id do request metadata (aqui reaproveitado do nonce)
            credDefCpfJsonLedger,  // credDef (JSON) usada para validações internas
            null                   // revRegDef (sem revogação neste teste)
        );

        // ============================================================
        // 11) Emissão da credencial ENDERECO (Offer → Request → Issue → Store)
        // ============================================================
        console.log("15) Emitindo credencial ENDERECO (Offer→Request→Issue→Store)...");

        // Gera um id único para a oferta da credencial ENDERECO
        const offerEndId = `offer-end-${Date.now()}`;
        // Issuer cria a Credential Offer para a CredDef ENDERECO; retorna JSON da offer
        const offerEndJson = await issuer.createCredentialOffer(credDefEndId, offerEndId);

        // Converte a offer ENDERECO (string) em objeto para acessar campos internos
        const offerEndObj = JSON.parse(offerEndJson);
        // Extrai o nonce; aqui ele serve como id do "request metadata" para o store
        const reqMetaEndId = offerEndObj?.nonce;
        // Sem nonce não dá para vincular/recuperar o request metadata corretamente
        if (!reqMetaEndId) throw new Error("Offer ENDERECO sem nonce (reqMetaId).");

        // Holder busca a CredDef ENDERECO no ledger (obrigatória para criar o request)
        const credDefEndJsonLedger =
            await holder.fetchCredDefFromLedger(GENESIS_FILE, credDefEndId);

        // Holder cria o Credential Request da credencial ENDERECO (offer + credDef + secret)
        const reqEndJson = await holder.createCredentialRequest(
            "default",            // link secret do holder
            holderDid,            // DID do holder usado no request
            credDefEndJsonLedger, // credDef ENDERECO (JSON do ledger)
            offerEndJson          // offer ENDERECO (JSON do issuer)
        );

        // Valores da credencial ENDERECO 
        const valuesEnd = {
            nome: "Edimar Veríssimo",
            endereco: "Rua Exemplo, 123",
            cidade: "São Paulo",
            estado: "SP"
        };


        // Issuer emite a credencial ENDERECO: assina usando credDef + offer + request + values
        // Retorna a credencial ENDERECO assinada em JSON para o holder armazenar
        const credEndJson = await issuer.createCredential(
            credDefEndId,              // credDefId da credencial ENDERECO
            offerEndJson,              // offer ENDERECO enviada ao holder
            reqEndJson,                // request ENDERECO recebido do holder
            JSON.stringify(valuesEnd)  // valores raw/encoded serializados
        );

        console.log("📝 credEndJson:", credEndJson);

        // Define um id local para a credencial ENDERECO dentro da wallet do holder
        const credEndIdInWallet = "cred-end";

        // Armazena a credencial ENDERECO na wallet do holder, vinculando ao req metadata
        await holder.storeCredential(
            credEndIdInWallet,     // id local na wallet (referência interna)
            credEndJson,           // credencial ENDERECO assinada (JSON)
            reqMetaEndId,          // id do request metadata (aqui vindo do nonce da offer)
            credDefEndJsonLedger,  // credDef ENDERECO (JSON do ledger)
            null                   // revRegDef (sem revogação neste teste)
        );

        // ============================================================
        // 13) Holder cria apresentação com [nome, cpf, endereco]
        // (nome + cpf vêm da cred-cpf; endereco vem da cred-end)
        // ============================================================
        console.log("16) Holder criando apresentação única (2 credenciais)...");

        // Holder busca o Schema CPF no ledger (necessário para montar/verificar a proof)
        const schemaCpfJsonLedger =
            await holder.fetchSchemaFromLedger(GENESIS_FILE, schemaCpfId);

        // Holder busca o Schema ENDERECO no ledger (também necessário para a proof)
        const schemaEndJsonLedger =
            await holder.fetchSchemaFromLedger(GENESIS_FILE, schemaEndId);

        // Monta o Presentation Request (proof request) dizendo o que o verifier quer ver
        const presReq = {
            // Nonce único p/ evitar replay e vincular a prova a este desafio específico
            nonce: String(Date.now()),

            // Nome/identificador lógico desta prova (apenas metadado)
            name: "proof-cpf-endereco",

            // Versão do formato do request (metadado)
            version: "1.0",

            // Atributos solicitados (cada chave é um referenciador interno do request)
            requested_attributes: {
                // Quer revelar "nome" vindo de uma credencial baseada na CredDef CPF
                attr_nome: {
                    name: "nome",
                    restrictions: [{ cred_def_id: credDefCpfId }]
                },

                // Quer revelar "cpf" vindo da mesma CredDef CPF
                attr_cpf: {
                    name: "cpf",
                    restrictions: [{ cred_def_id: credDefCpfId }]
                },

                // Quer revelar "endereco" vindo da CredDef ENDERECO
                attr_endereco: {
                    name: "endereco",
                    restrictions: [{ cred_def_id: credDefEndId }]
                }
            },

            // Predicados (ex.: idade >= 18); vazio aqui porque não pedimos comparações
            requested_predicates: {}
        };

        // Escolha do holder: quais credenciais atenderão cada atributo do presReq
        const requestedCreds = {
            requested_attributes: {
                // Para attr_nome, usa a credencial CPF armazenada (cred-cpf) e revela o valor
                attr_nome: { cred_id: credCpfIdInWallet, revealed: true },

                // Para attr_cpf, também usa a credencial CPF e revela o valor
                attr_cpf: { cred_id: credCpfIdInWallet, revealed: true },

                // Para attr_endereco, usa a credencial ENDERECO (cred-end) e revela o valor
                attr_endereco: { cred_id: credEndIdInWallet, revealed: true }
            },

            // Predicados: vazio porque o request não pediu nenhum (idade>=X, etc.)
            requested_predicates: {}
        };

        // Monta um mapa {schemaId -> schemaJson} exigido pelo create/verify presentation
        const schemasMap = JSON.stringify({
            // Schema CPF (id -> objeto do schema) para resolver atributos da cred-cpf
            [schemaCpfId]: JSON.parse(schemaCpfJsonLedger),

            // Schema ENDERECO (id -> objeto do schema) para resolver atributos da cred-end
            [schemaEndId]: JSON.parse(schemaEndJsonLedger)
        });

        // Monta um mapa {credDefId -> credDefJson} usado na criação/verificação da proof
        const credDefsMap = JSON.stringify({
            // CredDef CPF (id -> objeto) necessária para provar/verificar a cred-cpf
            [credDefCpfId]: JSON.parse(credDefCpfJsonLedger),

            // CredDef ENDERECO (id -> objeto) necessária para provar/verificar a cred-end
            [credDefEndId]: JSON.parse(credDefEndJsonLedger)
        });

        // Holder gera a apresentação (proof) usando o request e as credenciais escolhidas
        const presJson = await holder.createPresentation(
            JSON.stringify(presReq),         // Presentation Request (o desafio do verifier)
            JSON.stringify(requestedCreds),  // Mapeia quais credenciais atendem cada atributo
            schemasMap,                      // Schemas necessários (schemaId -> schema)
            credDefsMap                      // CredDefs necessárias (credDefId -> credDef)
        );

        // ============================================================
        // 15) Emissor verifica a apresentação
        // ============================================================
        console.log("17) Emissor verificando apresentação...");
        // Verifier (issuer) valida criptograficamente a apresentação recebida do holder
        const ok = await issuer.verifyPresentation(
            JSON.stringify(presReq), // o mesmo request usado como referência/verificação
            presJson,                // apresentação (proof) gerada pelo holder
            schemasMap,              // schemas para validar estrutura/atributos
            credDefsMap              // credDefs para validar assinaturas/provas AnonCreds
        );

        if (!ok) throw new Error("❌ verifyPresentation retornou false.");

        console.log("✅ OK: apresentação validada. Holder revelou [nome, cpf, endereco] usando 2 credenciais.");

        console.log("📝 PresJson:", presJson);
        console.log(JSON.parse(presJson).requested_proof.revealed_attrs);

    } finally {
        // Garante fechamento da wallet do issuer mesmo se ocorrer erro no meio do teste
        try { await issuer.walletClose(); } catch (_) { }
        // Garante fechamento da wallet do holder (libera handles/locks do SQLite)
        try { await holder.walletClose(); } catch (_) { }
    }
})().catch((e) => {
    // Mostra uma mensagem curta (message) ou o objeto de erro completo
    console.error("FALHA NO TESTE:", e?.message || e);
    // Imprime stack trace quando disponível (facilita debug)
    console.error(e?.stack || "");
    // Encerra o processo indicando falha (útil para CI/scripts)
    process.exit(1);
});
