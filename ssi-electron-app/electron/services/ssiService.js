// ssiService.js — camada de serviço do Main Process: concentra integrações com o sistema operacional (filesystem),
// rede (HTTP), utilitários de path e APIs do Electron (app/dialog) para suportar operações SSI expostas via IPC.
// Também importa `crypto` para funções auxiliares (ex.: geração/derivação de dados, identificadores ou validações)
// e `os` para resolver informações do ambiente quando necessário. Esta camada funciona como “fachada” entre os
// handlers IPC (main.js) e o módulo nativo (bindings), encapsulando detalhes de runtime (dev vs empacotado) e I/O.
const fs = require("fs");
const http = require("http");
const path = require("path");
const { app } = require("electron");

const { dialog } = require("electron");
const crypto = require("crypto");

const os = require("os");
// const crypto = require("crypto");

// Gera um caminho de carteira temporária (arquivo .db) no diretório temporário do sistema: cria um nome único
// combinando timestamp e bytes aleatórios (hex) para evitar colisões entre execuções concorrentes e retorna o caminho
// completo via `path.join(os.tmpdir(), ...)`. Usado tipicamente em fluxos de verificação para operar em uma wallet
// descartável sem impactar a carteira principal do usuário.
function mkTempWalletPath() {
  const name = `ssi_verify_${Date.now()}_${crypto.randomBytes(4).toString("hex")}.db`;
  return path.join(os.tmpdir(), name);
}

// Resolve o diretório onde o módulo nativo (N-API) está localizado, considerando o modo de execução:
// - Em desenvolvimento (`app.isPackaged === false`), aponta para `../../bindings` relativo ao service.
// - Empacotado (`app.isPackaged === true`), aponta para `process.resourcesPath/bindings`, onde o electron-builder
//   copia a pasta via `extraResources`. Isso garante que o require do `.node` funcione tanto no dev quanto no build.
function resolveBindingsDir() {
  // Dev: .../electron/services -> .../bindings
  if (!app.isPackaged) return path.join(__dirname, "..", "..", "bindings");
  // Prod: resources/bindings (via extraResources)
  return path.join(process.resourcesPath, "bindings");
}

// Carrega dinamicamente o binding nativo da biblioteca SSI (N-API), suportando dois formatos de distribuição:
// `index.node` (binário nativo) e, como fallback, `index.js` (wrapper/loader). Resolve o diretório correto via
// `resolveBindingsDir()`, tenta requerer primeiro o `.node` quando existir e, em caso de falha, alterna a ordem.
// Valida que o export esperado (`IndyAgent`) está presente e retorna a classe/construtor para uso pelo serviço.
function loadIndyAgent() {
  const bindingsDir = resolveBindingsDir();
  const nodePath = path.join(bindingsDir, "index.node");
  const jsPath = path.join(bindingsDir, "index.js");

  let binding;
  try {
    if (fs.existsSync(nodePath)) binding = require(nodePath);
    else binding = require(jsPath);
  } catch (e) {
    // fallback inverso
    try { binding = require(jsPath); }
    catch { binding = require(nodePath); }
  }
  if (!binding || !binding.IndyAgent) throw new Error("IndyAgent não encontrado no binding.");
  return binding.IndyAgent;
}

// Faz o download do arquivo genesis (transações iniciais do ledger) se ele ainda não existir em disco: cria o
// diretório de destino (recursive), abre um write stream e baixa via HTTP GET, validando status 200. Em caso de
// sucesso, fecha o arquivo e resolve a Promise; em caso de erro, tenta remover o arquivo parcial e rejeita com o
// erro. Esse mecanismo garante que a configuração do ledger esteja disponível antes de inicializar o agente.
function downloadGenesis(genesisUrl, genesisFile) {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(genesisFile)) return resolve(true);

    const dir = path.dirname(genesisFile);
    fs.mkdirSync(dir, { recursive: true });

    const file = fs.createWriteStream(genesisFile);
    http.get(genesisUrl, (res) => {
      if (res.statusCode !== 200) return reject(new Error(`Falha ao baixar genesis: HTTP ${res.statusCode}`));
      res.pipe(file);
      file.on("finish", () => file.close(() => resolve(true)));
    }).on("error", (err) => {
      try { fs.unlinkSync(genesisFile); } catch (_) { }
      reject(err);
    });
  });
}

//==============================================================
// FUNÇOES AUXILIARES PARA IMPEDIR ALTERAÇÃO DO "RAW"
//==============================================================

// Valida se uma string representa um inteiro decimal não-negativo (apenas dígitos 0–9): retorna true somente
// quando `s` é string e passa na expressão regular, evitando entradas com sinais, espaços, casas decimais ou letras.
function isIntegerString(s) {
  return typeof s === "string" && /^[0-9]+$/.test(s);
}

// Deriva um inteiro decimal (string) a partir do SHA-256 de um valor arbitrário: calcula o hash (32 bytes),
// interpreta o resultado como um número big-endian (acumulando em BigInt por deslocamento de 8 bits) e devolve
// a representação em base 10. Útil para gerar valores “encoded” determinísticos no padrão Indy a partir do `raw`.
function sha256ToBigIntDecimal(raw) {
  const hash = crypto.createHash("sha256").update(String(raw), "utf8").digest(); // Buffer 32 bytes
  // Converte bytes big-endian -> BigInt
  let n = 0n;
  for (const b of hash.values()) {
    n = (n << 8n) + BigInt(b);
  }
  return n.toString(10);
}

// Implementa uma estratégia compatível com o “encode” do AnonCreds/Indy: se o valor `raw` já for um inteiro
// decimal (string só com dígitos), normaliza removendo zeros à esquerda via BigInt (mantendo "0"). Caso contrário,
// converte o texto para um inteiro grande determinístico usando SHA-256 → BigInt (base 10). Isso garante um
// `encoded` estável e adequado para provas criptográficas, mesmo para atributos não numéricos.
function anoncredsEncode(raw) {
  const s = String(raw);

  if (isIntegerString(s)) {
    // Normaliza: remove zeros à esquerda (ex.: "00025" -> "25")
    // Obs: "0" permanece "0"
    return BigInt(s).toString(10);
  }
  return sha256ToBigIntDecimal(s);
}

// Valida consistência de um mapa de atributos no formato AnonCreds `{ attr: { raw, encoded } }`: percorre cada
// entrada, verifica estrutura obrigatória (objeto com `raw` e `encoded`) e recalcula o `encoded` esperado via
// `anoncredsEncode(raw)`. Caso haja divergência, acumula mensagens detalhadas em `errors` (incluindo o esperado e
// o atual) para facilitar diagnóstico. Retorna a lista de erros (vazia quando tudo está consistente).
function validateRawEncodedMap(valuesObj, contextLabel = "values") {
  const errors = [];

  if (!valuesObj || typeof valuesObj !== "object") {
    errors.push(`${contextLabel}: objeto inválido/ausente.`);
    return errors;
  }

  for (const [attr, v] of Object.entries(valuesObj)) {
    if (!v || typeof v !== "object") {
      errors.push(`${contextLabel}.${attr}: inválido (esperado objeto {raw, encoded}).`);
      continue;
    }

    const raw = v.raw;
    const encoded = v.encoded;

    if (raw === undefined || encoded === undefined) {
      errors.push(`${contextLabel}.${attr}: precisa conter raw e encoded.`);
      continue;
    }

    const expected = anoncredsEncode(String(raw));
    if (String(encoded) !== expected) {
      errors.push(
        `${contextLabel}.${attr}: raw→encoded inconsistente. ` +
        `encoded atual="${encoded}" esperado="${expected}" raw="${raw}"`
      );
    }
  }

  return errors;
}


// Identificador do Link Secret (Master Secret) usado pelo AnonCreds/Aries Askar: mantido como "default" para
// compatibilidade, pois em muitos fluxos/bindings esse ID é tratado como obrigatório (inclusive nos testes do projeto).
const LINK_SECRET_ID = "default"; // seus testes indicam que é obrigatório usar "default" 

// Classe de serviço central do backend (Main Process) que encapsula todas as operações SSI do aplicativo:
// inicialização e gestão de carteira (SQLite cifrado), comunicação com o ledger (genesis, escrita/leitura),
// emissão e verificação de credenciais (AnonCreds) e criação/verificação de Presentation Packages. Também é
// responsável por carregar o binding nativo (IndyAgent), controlar ciclo de vida (init/close) e fornecer
// métodos consumidos pelos handlers IPC em `main.js`.
class SsiService {

  // Construtor do serviço: carrega a classe `IndyAgent` a partir do binding nativo (via `loadIndyAgent()`),
  // instancia o agente que executa as operações SSI e inicializa o estado interno (`isWalletOpen`) para controlar
  // o ciclo de vida da carteira e evitar chamadas fora de ordem (ex.: emitir/verificar antes de abrir/init).
  constructor() {
    const IndyAgent = loadIndyAgent();
    this.agent = new IndyAgent();
    this.isWalletOpen = false;
  }

  // ---- Pairwise DID cache (1 DID por relacionamento Issuer↔Holder) -------------------------------
  // Evita poluir a wallet criando um DID novo a cada oferta. Mantém um DID local por issuerDid,
  // persistido como sidecar JSON ao lado do arquivo da wallet.
  _pairwiseMapPath(walletPath) {
    return `${walletPath}.pairwise_dids.json`;
  }

  _loadPairwiseMap(walletPath) {
    const p = this._pairwiseMapPath(walletPath);
    try {
      if (!fs.existsSync(p)) return {};
      const raw = fs.readFileSync(p, "utf-8");
      const obj = JSON.parse(raw);
      return (obj && typeof obj === "object") ? obj : {};
    } catch (_) {
      // Se o arquivo estiver corrompido, não quebra o fluxo: recomeça vazio.
      return {};
    }
  }

  _savePairwiseMap(walletPath, obj) {
    const p = this._pairwiseMapPath(walletPath);
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    // escrita atômica simples (tmp -> rename)
    const tmp = `${p}.tmp_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), "utf-8");
    fs.renameSync(tmp, p);
  }

  async _getOrCreatePairwiseHolderDid(cfg, issuerDid) {
    const walletPath = cfg.walletPath;
    const map = this._loadPairwiseMap(walletPath);

    // Reuso, se existir
    const cached = map[issuerDid];
    if (cached && typeof cached === "string" && cached.trim()) {
      return { holderDid: cached.trim(), created: false };
    }

    // Cria uma vez e persiste
    const created = await this.agent.createOwnDid();
    const holderDid = created?.[0];
    if (!holderDid) throw new Error("Falha ao criar DID local (pairwise) do Holder.");

    map[issuerDid] = holderDid;
    this._savePairwiseMap(walletPath, map);

    return { holderDid, created: true };
  }


  // Finaliza recursos de forma tolerante a falhas: se houver carteira aberta (`isWalletOpen`), tenta fechá-la via
  // `agent.walletClose()`. Erros no fechamento são ignorados para não travar o encerramento do app, e o estado é
  // resetado para `false` garantindo consistência do serviço após a tentativa de teardown.
  async safeClose() {
    try {
      if (this.isWalletOpen) await this.agent.walletClose();
    } catch (_) { }
    this.isWalletOpen = false;
  }

  // Garante que a carteira exista e esteja aberta para uso: se o arquivo em `walletPath` não existir, cria a wallet
  // com a senha (`walletCreate`). Em seguida, abre a wallet (`walletOpen`) e marca `isWalletOpen = true` para indicar
  // que operações subsequentes (DIDs, schema/credDef, emissão/verificação) podem ser executadas com segurança.
  async ensureWallet(cfg) {
    const { walletPath, walletPass } = cfg;
    if (!fs.existsSync(walletPath)) {
      await this.agent.walletCreate(walletPath, walletPass);
    }
    await this.agent.walletOpen(walletPath, walletPass);
    this.isWalletOpen = true;
  }

  // Garante que a configuração de rede do ledger esteja pronta: baixa o arquivo genesis caso necessário e, em seguida,
  // conecta o agente ao ledger usando `connectNetwork(genesisFile)`. Esse método espelha o fluxo validado nos testes,
  // assegurando que operações que dependem do ledger (registro de DID/schema/credDef e validações) tenham conectividade.
  async ensureNetwork(cfg) {
    await downloadGenesis(cfg.genesisUrl, cfg.genesisFile);
    await this.agent.connectNetwork(cfg.genesisFile); // usado nos testes 
  }

  // Testa a conectividade ponta-a-ponta do backend: garante que a carteira esteja criada/aberta (`ensureWallet`)
  // e que a rede do ledger esteja acessível (`ensureNetwork`). Se ambos concluírem sem erro, retorna `{ ok:true }`
  // para a UI confirmar que o ambiente (wallet + ledger) está operacional.
  async testConnection(cfg) {
    await this.ensureWallet(cfg);
    await this.ensureNetwork(cfg);
    return { ok: true };
  }

  // Cria e registra um novo DID no ledger (fluxo NYM): garante wallet e rede ativas, importa o DID do Trustee a partir
  // do seed (para ter permissão de escrita), cria um DID próprio (newDid/newVerkey) e registra no ledger via NYM usando
  // o role configurado (padrão "ENDORSER"). Em seguida, resolve o DID recém-registrado no ledger para confirmar que a
  // gravação foi efetivada. Retorna os identificadores gerados e as respostas de registro/consulta para diagnóstico.
  // 1) DID: criar + registrar no ledger
  async createDidAndRegister(cfg) {
    await this.ensureWallet(cfg);
    await this.ensureNetwork(cfg);

    // Trustee (importDidFromSeed retorna [did, verkey]) :contentReference[oaicite:12]{index=12}
    const [trusteeDid] = await this.agent.importDidFromSeed(cfg.trusteeSeed);

    // Criar DID novo (createOwnDid retorna [did, verkey]) :contentReference[oaicite:13]{index=13}
    const [newDid, newVerkey] = await this.agent.createOwnDid();

    // Registrar (NYM) :contentReference[oaicite:14]{index=14}
    const role = cfg.newDidRole || "ENDORSER";
    // const resp = await this.agent.registerDidOnLedger(
    //   cfg.genesisFile,
    //   cfg.trusteeDid || trusteeDid,
    //   newDid,
    //   newVerkey,
    //   role
    // );

    // --------------------------------------------------
    // Registrar (NYM)
    const roleRaw = String(cfg.newDidRole ?? "").trim();
    const roleUpper = roleRaw.toUpperCase();

    // DID "comum": role vazio (NYM sem role)
    let roleForLedger = roleRaw;

    // Aceite aliases de "sem role"
    if (!roleUpper || roleUpper === "NONE" || roleUpper === "COMMON" || roleUpper === "USER") {
      roleForLedger = ""; // <-- sem privilégios
    }

    // Alias comum no ecossistema Indy: TRUST_ANCHOR ~= ENDORSER
    if (roleUpper === "TRUST_ANCHOR") {
      roleForLedger = "ENDORSER";
    }

    // (Opcional, mas recomendado) Validar para não “dar certo errado”
    const allowed = new Set(["", "ENDORSER", "STEWARD", "TRUSTEE", "NETWORK_MONITOR"]);
    if (!allowed.has(roleForLedger.toUpperCase())) {
      throw new Error(
        `Role inválido para NYM: "${roleRaw}". Use: NONE (comum), ENDORSER, STEWARD, TRUSTEE, NETWORK_MONITOR.`
      );
    }

    const resp = await this.agent.registerDidOnLedger(
      cfg.genesisFile,
      cfg.trusteeDid || trusteeDid,
      newDid,
      newVerkey,
      roleForLedger
    );

    // --------------------------------------------------------


    // Resolve para confirmar :contentReference[oaicite:15]{index=15}
    const nym = await this.agent.resolveDidOnLedger(newDid);

    return { newDid, newVerkey, registerResponse: resp, resolveResponse: nym };
  }

  exportDid(didObj) {
    return JSON.stringify(didObj, null, 2);
  }

  // Serializa um objeto DID (ex.: { did, verkey, metadata }) em JSON identado (2 espaços) para exportação/armazenamento
  // ou exibição na UI, mantendo um formato legível e consistente.
  importDid(didJson) {
    const obj = JSON.parse(didJson);
    if (!obj.did || !obj.verkey) throw new Error("JSON inválido: precisa ter did e verkey.");
    return obj;
  }

  // Cria e registra um Schema no ledger: garante wallet e rede ativas, determina o DID emissor (`issuerDid`) a usar
  // para escrita (preferindo `cfg.issuerDid`; caso ausente, importa a partir de `issuerSeed` ou do `trusteeSeed`),
  // e então chama `createAndRegisterSchema` passando genesis, DID emissor, nome, versão e lista de atributos.
  // Retorna o `schemaId` gerado no ledger e o DID efetivamente utilizado para auditoria/debug.
  async createSchema(cfg, schema) {
    await this.ensureWallet(cfg);
    await this.ensureNetwork(cfg);

    let issuerDid = cfg.issuerDid;

    if (!issuerDid) {
      const [did] = await this.agent.importDidFromSeed(cfg.issuerSeed || cfg.trusteeSeed);
      issuerDid = did;
    }


    const schemaId = await this.agent.createAndRegisterSchema(
      cfg.genesisFile,
      issuerDid,
      schema.name,
      schema.version,
      schema.attrs
    );

    return { schemaId, issuerDid };
  }

  // Cria e registra um Credential Definition (CredDef) no ledger: garante wallet e rede ativas, determina o DID emissor
  // para escrita (usa `cfg.issuerDid` quando informado; caso contrário, importa a partir de `issuerSeed` ou `trusteeSeed`)
  // e chama `createAndRegisterCredDef` passando genesis, DID emissor, `schemaId` e `tag`. Retorna o `credDefId` do ledger
  // e o DID efetivamente utilizado, facilitando rastreabilidade e depuração.
  async createCredDef(cfg, credDef) {
    await this.ensureWallet(cfg);
    await this.ensureNetwork(cfg);

    let issuerDid = cfg.issuerDid;

    if (!issuerDid) {
      const [did] = await this.agent.importDidFromSeed(cfg.issuerSeed || cfg.trusteeSeed);
      issuerDid = did;
    }


    const credDefId = await this.agent.createAndRegisterCredDef(
      cfg.genesisFile,
      issuerDid,
      credDef.schemaId,
      credDef.tag
    );

    return { credDefId, issuerDid };
  }

  // 4) Emissão: cria offer + request + credential e retorna pacote exportável (JSON)
  // Emite uma credencial AnonCreds ponta-a-ponta (issuer + holder no mesmo backend, para MVP/testes): valida `cfg` e
  // `issue` (inclui defesa contra args invertidos no IPC), garante wallet e rede ativas e normaliza DIDs (remove
  // "did:sov:" e aplica sanity checks de base58/tamanho). Valida `credDefId` (espera ':3:CL:') e força coerência:
  // o DID emissor usado para assinar deve ser o mesmo DID que criou o CredDef (primeiro segmento do credDefId).
  // Em seguida, garante o Link Secret ("default"), cria um DID local para o holder, cria oferta (offer), busca o
  // CredDef público no ledger, cria o request (holder), cria a credencial (issuer) com os valores, armazena na wallet
  // (storeCredential) e retorna um “package” padronizado (`ssi-credential-package-v1`) contendo metadados (issuer/holder,
  // schemaId/credDefId, nonce/reqMetaId, timestamp) e os objetos `offer` e `credential` prontos para exportação/verificação.
  async issueCredential(cfg, issue) {
    // ---------- guards ----------
    if (!cfg || typeof cfg !== "object") throw new Error("CFG inválida no issueCredential");
    if (!issue || typeof issue !== "object") throw new Error("ISSUE inválido no issueCredential");

    // Se você cair aqui, é quase certeza de args invertidos no IPC (preload/main)
    if (issue.genesisFile && !issue.credDefId) {
      throw new Error("Parâmetros invertidos no IPC: 'issue' parece ser 'cfg'. Verifique preload.js/main.js");
    }

    await this.ensureWallet(cfg);
    await this.ensureNetwork(cfg);

    // ---------- helpers ----------
    const isBase58 = (s) => /^[1-9A-HJ-NP-Za-km-z]+$/.test(s);

    const normalizeIndyDid = (did, label) => {
      let d = String(did || "").trim();

      // remove prefixo qualificado, se vier
      if (d.startsWith("did:sov:")) d = d.slice("did:sov:".length);

      d = d.trim();
      if (!d) throw new Error(`${label} ausente.`);

      // Indy/AnonCreds normalmente espera base58 para DID legado.
      if (!isBase58(d)) {
        throw new Error(`${label} inválido (não é base58): "${d}"`);
      }

      // Não prenda em 16/32: há DIDs válidos com outros tamanhos (ex.: 22).
      // Mantemos apenas um range “sanity check” para evitar lixo.
      if (d.length < 16 || d.length > 64) {
        throw new Error(`${label} inválido (tamanho ${d.length} fora do range 16..64): "${d}"`);
      }

      return d;
    };

    // ---------- credDefId ----------
    const credDefId = String(issue.credDefId || "").trim();
    if (!credDefId) throw new Error("CredDefID ausente.");
    if (!credDefId.includes(":3:CL:")) throw new Error(`CredDefID inválido (esperado conter ':3:CL:'): "${credDefId}"`);

    // ---------- issuer DID (quem assina/emite) ----------
    // Preferir o DID selecionado no UI (TRUSTEE/NEW_DID). Se vazio, cair no seed.
    let issuerDid = String(cfg.issuerDid || "").trim();

    if (!issuerDid) {
      const seed = String(cfg.issuerSeed || cfg.trusteeSeed || "").trim();
      if (!seed) throw new Error("issuerDid não informado e nenhum seed disponível para importar DID.");
      const imported = await this.agent.importDidFromSeed(seed);
      issuerDid = imported?.[0];
    }

    issuerDid = normalizeIndyDid(issuerDid, "Issuer DID");

    // Defesa: credDefId “pertence” ao DID que o criou (primeiro segmento antes do ':')
    const credDefIssuerDid = credDefId.split(":")[0];
    if (credDefIssuerDid !== issuerDid) {
      throw new Error(
        `CredDefID inválido para o emissor atual.\n` +
        `- CredDef pertence ao DID: "${credDefIssuerDid}"\n` +
        `- Emissão está usando:     "${issuerDid}"\n\n` +
        `Selecione no app o mesmo DID (TRUSTEE/NEW_DID) usado para criar o CredDef.`
      );
    }

    // ---------- holder DID (prover) + link secret ----------
    const linkSecretId = (typeof LINK_SECRET_ID !== "undefined" && LINK_SECRET_ID) ? LINK_SECRET_ID : "default";

    // idempotente
    try { await this.agent.createLinkSecret(linkSecretId); } catch (_) { }

    // Para o MVP, o holder está na mesma instância (wallet local). Criamos um DID local.
    // Se sua lib retornar DID qualificado, normalizamos.
    const created = await this.agent.createOwnDid();
    let holderDid = created?.[0];
    holderDid = normalizeIndyDid(holderDid, "Holder DID (Prover)");

    // ---------- oferta ----------
    const offerId = String(issue.offerId || `offer-${Date.now()}`).trim();
    const offerJson = await this.agent.createCredentialOffer(credDefId, offerId);
    const offerObj = JSON.parse(offerJson);

    // Ledger: credDef público (necessário para montar o request)
    const credDefJsonVdr = await this.agent.fetchCredDefFromLedger(cfg.genesisFile, credDefId);

    // ---------- request ----------
    const reqJson = await this.agent.createCredentialRequest(
      linkSecretId,
      holderDid,
      credDefJsonVdr,
      offerJson
    );

    // ---------- credential ----------
    const values = issue.values;
    if (!values || typeof values !== "object") {
      throw new Error("Valores (issue.values) inválidos; esperado objeto JSON.");
    }
    const credValuesJson = JSON.stringify(values);

    const credJson = await this.agent.createCredential(
      credDefId,
      offerJson,
      reqJson,
      credValuesJson
    );

    // ---------- store + export ----------
    const reqMetaId = String(offerObj?.nonce || "").trim();
    if (!reqMetaId) throw new Error("Falha ao obter reqMetaId (nonce) da oferta.");

    const credIdInWallet = String(issue.credIdInWallet || `cred-${Date.now()}`).trim();
    await this.agent.storeCredential(credIdInWallet, credJson, reqMetaId, credDefJsonVdr, null);

    // schemaId pode ser inferido a partir do offer/cred, mas aqui mantemos compatibilidade
    const credObj = (typeof credJson === "string") ? JSON.parse(credJson) : credJson;
    const schemaId =
      issue.schemaId ||
      offerObj?.schema_id ||
      credObj?.schema_id ||
      null;

    return {
      type: "ssi-credential-package-v1",
      issuerDid,                 // ✅ agora coerente com o DID selecionado no app
      holderDid,
      schemaId,
      credDefId,
      reqMetaId,
      issuedAt: new Date().toISOString(),
      offer: offerObj,
      credential: credObj
    };
  }

  // =========================================================================
  //  FLUXO MULTI-INSTÂNCIA (Offer -> Request -> Credential)
  // =========================================================================

  // (1) ISSUER: cria um Offer Package exportável
  async createCredentialOfferPackage(cfg, input) {
    await this.ensureWallet(cfg);
    await this.ensureNetwork(cfg);

    const credDefId = String(input?.credDefId || "").trim();
    if (!credDefId.includes(":3:CL:")) {
      throw new Error("CredDef ID inválido (esperado conter ':3:CL:').");
    }

    const offerIdLocal = String(input?.offerIdLocal || `offer-${Date.now()}`).trim();
    const offerJson = await this.agent.createCredentialOffer(credDefId, offerIdLocal);
    const offer = JSON.parse(offerJson);

    const issuerDid = credDefId.split(":")[0] || "";
    const schemaId = offer?.schema_id || offer?.schemaId || null;
    const nonce = offer?.nonce || null;

    return {
      type: "ssi-credential-offer-package-v1",
      offerIdLocal,
      issuerDid,
      credDefId,
      schemaId,
      nonce,
      createdAt: new Date().toISOString(),
      offer,
    };
  }

  // (2) HOLDER: aceita Offer e gera Credential Request Package (persistindo request_metadata na wallet do HOLDER)
  async acceptCredentialOfferPackage(cfg, input) {
    await this.ensureWallet(cfg);
    await this.ensureNetwork(cfg);

    const raw = input?.offerPackageJson ?? input?.offerPackage ?? input;
    const offerPkg = (typeof raw === "string") ? JSON.parse(raw) : raw;

    if (!offerPkg || typeof offerPkg !== "object") throw new Error("Offer Package inválido.");
    if (offerPkg.type !== "ssi-credential-offer-package-v1") {
      throw new Error("JSON não é um Offer Package (ssi-credential-offer-package-v1).");
    }
    if (!offerPkg.offer) throw new Error("Offer Package sem campo 'offer'.");

    // Garantir link secret do holder
    try { await this.agent.createLinkSecret("default"); } catch (_) { }

    // Holder DID local (não precisa registrar no ledger)
    // const created = await this.agent.createOwnDid();
    // let holderDid = created?.[0];
    // if (!holderDid) throw new Error("Falha ao criar DID local do Holder.");

    // Holder DID local (pairwise) — reusa 1 DID por emissor para não poluir a wallet
    const issuerDid = (String(offerPkg.issuerDid || "").trim()
      || String(offerPkg.credDefId || "").split(":")[0].trim());

    if (!issuerDid) throw new Error("Offer Package sem issuerDid (ou credDefId inválido).");

    // Se não existir cache pairwise para este issuer, cria uma vez; se já existir, reusa
    let holderDid;
    try {
      ({ holderDid } = await this._getOrCreatePairwiseHolderDid(cfg, issuerDid));
    } catch (e) {
      // fallback defensivo: se houver alguma falha inesperada, cria DID novo (não-pairwise)
      const created = await this.agent.createOwnDid();
      holderDid = created?.[0];
      if (!holderDid) throw e;
    }

    const credDefId = String(offerPkg.credDefId || "").trim();
    if (!credDefId) throw new Error("Offer Package sem credDefId.");

    // Buscar CredDef público no ledger (necessário para montar request)
    const credDefJsonVdr = await this.agent.fetchCredDefFromLedger(cfg.genesisFile, credDefId);

    const offerJson = JSON.stringify(offerPkg.offer);

    // Isso cria (request, metadata) e salva metadata em "request_metadata" com id = offer.nonce
    const requestJson = await this.agent.createCredentialRequest(
      "default",
      holderDid,
      credDefJsonVdr,
      offerJson
    );
    const request = JSON.parse(requestJson);

    const schemaId = offerPkg.schemaId || offerPkg.offer?.schema_id || null;
    const nonce = offerPkg.nonce || offerPkg.offer?.nonce || null;

    return {
      type: "ssi-credential-request-package-v1",
      credDefId,
      schemaId,
      nonce,
      holderDid,
      createdAt: new Date().toISOString(),
      offer: offerPkg.offer,      // reenviamos o offer junto (facilita o issuer emitir sem depender do DB local)
      request,
    };
  }

  // (3) ISSUER: emite Credential a partir do Request Package
  async issueCredentialFromRequestPackage(cfg, input) {
    await this.ensureWallet(cfg);
    await this.ensureNetwork(cfg);

    const raw = input?.requestPackageJson ?? input?.requestPackage ?? input;
    const reqPkg = (typeof raw === "string") ? JSON.parse(raw) : raw;

    if (!reqPkg || typeof reqPkg !== "object") throw new Error("Request Package inválido.");
    if (reqPkg.type !== "ssi-credential-request-package-v1") {
      throw new Error("JSON não é um Request Package (ssi-credential-request-package-v1).");
    }
    if (!reqPkg.offer || !reqPkg.request) {
      throw new Error("Request Package precisa conter 'offer' e 'request'.");
    }

    const credDefId = String(input?.credDefId || reqPkg.credDefId || "").trim();
    if (!credDefId.includes(":3:CL:")) throw new Error("credDefId ausente/ inválido para emissão.");

    const valuesObj = input?.values;
    if (!valuesObj || typeof valuesObj !== "object") {
      throw new Error("values (JSON) ausente/ inválido para emissão.");
    }

    const offerJson = JSON.stringify(reqPkg.offer);
    const requestJson = JSON.stringify(reqPkg.request);
    const valuesJson = JSON.stringify(valuesObj);

    const credJson = await this.agent.createCredential(
      credDefId,
      offerJson,
      requestJson,
      valuesJson
    );
    const credential = JSON.parse(credJson);

    const issuerDid = credDefId.split(":")[0] || "";
    const schemaId = reqPkg.schemaId || reqPkg.offer?.schema_id || credential?.schema_id || null;
    const nonce = reqPkg.nonce || reqPkg.offer?.nonce || null;

    return {
      type: "ssi-credential-package-v1",
      issuerDid,
      holderDid: reqPkg.holderDid || null,
      schemaId,
      credDefId,
      reqMetaId: nonce,          // importante: é o id do request_metadata na wallet do holder
      issuedAt: new Date().toISOString(),
      offer: reqPkg.offer,
      credential,
    };
  }

  // (4) HOLDER: armazena (processa) uma credencial recebida (requer request_metadata existir nesta wallet)
  async storeCredentialFromPackage(cfg, input) {
    await this.ensureWallet(cfg);
    await this.ensureNetwork(cfg);

    const raw = input?.credentialPackageJson ?? input?.credentialPackage ?? input;
    const pkg = (typeof raw === "string") ? JSON.parse(raw) : raw;

    if (!pkg || typeof pkg !== "object") throw new Error("Credential Package inválido.");
    if (pkg.type !== "ssi-credential-package-v1") {
      throw new Error("JSON não é um Credential Package (ssi-credential-package-v1).");
    }

    const credDefId = String(pkg.credDefId || "").trim();
    if (!credDefId) throw new Error("Credential Package sem credDefId.");

    const reqMetaId = String(pkg.reqMetaId || pkg?.offer?.nonce || "").trim();
    if (!reqMetaId) {
      throw new Error("reqMetaId ausente (normalmente é offer.nonce).");
    }

    // garantir link secret
    try { await this.agent.createLinkSecret("default"); } catch (_) { }

    // precisa do credDef público do ledger
    const credDefJsonLedger = await this.agent.fetchCredDefFromLedger(cfg.genesisFile, credDefId);

    const credIdInWallet = String(input?.credIdInWallet || `cred-${Date.now()}`).trim();
    const credJsonForStore = JSON.stringify(pkg.credential);

    try {
      await this.agent.storeCredential(credIdInWallet, credJsonForStore, reqMetaId, credDefJsonLedger, null);
    } catch (e) {
      const msg = String(e?.message || e);
      if (msg.includes("Request Metadata")) {
        throw new Error(
          "Request Metadata não encontrado nesta wallet do Holder.\n" +
          "Você só consegue importar/processar esta credencial se ESTA instância tiver gerado o Credential Request " +
          "da mesma oferta (mesmo nonce).\n\n" +
          "Fluxo correto:\n" +
          "1) Importar Offer -> 2) Aceitar Offer (gera Request) -> 3) Receber Credential -> 4) Store/Process."
        );
      }
      throw e;
    }

    return { ok: true, storedCredId: credIdInWallet };
  }


  // -----------------------------------------------------------------------------
  // 5) Verificação: cria apresentação e verifyPresentation + checagem raw→encoded
  // Verifica uma credencial AnonCreds de ponta a ponta e retorna um resultado “auditável”: após garantir wallet e rede,
  // faz o parse do package recebido (JSON do textarea), remove wrappers { ok, result } e extrai o objeto de credencial
  // suportando múltiplos formatos (credential/cred/credentialJson/credJson). Resolve `schemaId`, `credDefId` e `reqMetaId`
  // (nonce da oferta) com fallbacks e valida presença. Antes da prova criptográfica, aplica uma checagem anti-adulteração
  // raw→encoded (recalcula `encoded` via regra AnonCreds e rejeita inconsistências), criando uma falha “semântica” amigável.
  // Em seguida, garante o link secret, busca Schema e CredDef no ledger, importa a credencial em um ID temporário na wallet,
  // constrói um Proof Request que revela todos os atributos (com restrição pelo `cred_def_id`), cria a apresentação e verifica
  // criptograficamente (`verifyPresentation`). Por fim, extrai os atributos revelados, revalida raw→encoded nos revelados e
  // devolve um payload completo com `cryptoValid`, `semanticValid`, evidências usadas (IDs, hash SHA-256 da credencial) e
  // o mapa `revealed` para exibição/diagnóstico no front-end.
  async verifyCredential(cfg, verify) {
    await this.ensureWallet(cfg);
    await this.ensureNetwork(cfg);

    const crypto = require("crypto");

    // -----------------------------
    // Helpers: raw -> encoded (AnonCreds / Indy style)
    // -----------------------------
    function isIntegerString(s) {
      return typeof s === "string" && /^[0-9]+$/.test(s);
    }

    function sha256ToBigIntDecimal(raw) {
      const hash = crypto.createHash("sha256").update(String(raw), "utf8").digest(); // Buffer (32 bytes)
      let n = 0n;
      for (const b of hash.values()) {
        n = (n << 8n) + BigInt(b);
      }
      return n.toString(10);
    }

    // Indy/AnonCreds encoding:
    // - decimal integer strings are normalized as BigInt (removes leading zeros)
    // - otherwise SHA-256(raw) interpreted as big-endian integer -> decimal string
    function anoncredsEncode(raw) {
      const s = String(raw);
      if (isIntegerString(s)) return BigInt(s).toString(10);
      return sha256ToBigIntDecimal(s);
    }

    function validateRawEncodedMap(valuesObj, contextLabel = "values") {
      const errors = [];

      if (!valuesObj || typeof valuesObj !== "object") {
        errors.push(`${contextLabel}: objeto inválido/ausente.`);
        return errors;
      }

      for (const [attr, v] of Object.entries(valuesObj)) {
        if (!v || typeof v !== "object") {
          errors.push(`${contextLabel}.${attr}: inválido (esperado {raw, encoded}).`);
          continue;
        }

        const raw = v.raw;
        const encoded = v.encoded;

        if (raw === undefined || encoded === undefined) {
          errors.push(`${contextLabel}.${attr}: precisa conter raw e encoded.`);
          continue;
        }

        const expected = anoncredsEncode(String(raw));
        if (String(encoded) !== expected) {
          errors.push(
            `${contextLabel}.${attr}: raw→encoded inconsistente. ` +
            `encoded atual="${encoded}" esperado="${expected}" raw="${raw}"`
          );
        }
      }

      return errors;
    }

    // -----------------------------
    // 0) Parse do pacote (garantir que estamos lendo o textarea)
    // -----------------------------
    let pkg;
    try {
      pkg = JSON.parse(verify.credentialPackageJson);
    } catch (e) {
      throw new Error(`Credential Package (JSON) inválido: ${e.message}`);
    }

    // Unwrap wrapper {ok,result}
    if (pkg && typeof pkg === "object" && pkg.result && typeof pkg.result === "object") {
      pkg = pkg.result;
    }

    // Tenta extrair a credencial (várias formas possíveis)
    const credentialObj =
      (pkg && typeof pkg.credential === "object" && pkg.credential) ? pkg.credential :
        (pkg && typeof pkg.cred === "object" && pkg.cred) ? pkg.cred :
          (pkg && typeof pkg.credentialJson === "string") ? JSON.parse(pkg.credentialJson) :
            (pkg && typeof pkg.credJson === "string") ? JSON.parse(pkg.credJson) :
              null;

    if (!credentialObj) {
      throw new Error("Pacote inválido: 'credential' (objeto) ou 'credJson'/'credentialJson' (string) ausente.");
    }

    // IDs (schemaId/credDefId/reqMetaId)
    const schemaId =
      (verify.schemaId || "").trim() ||
      pkg.schemaId ||
      (pkg.offer && pkg.offer.schema_id) ||
      credentialObj.schema_id;

    const credDefId =
      pkg.credDefId ||
      (pkg.offer && pkg.offer.cred_def_id) ||
      credentialObj.cred_def_id;

    // reqMetaId: no seu fluxo é offer.nonce
    const reqMetaId =
      pkg.reqMetaId ||
      (pkg.offer && pkg.offer.nonce);

    if (!schemaId) throw new Error("schemaId ausente (informe no campo Schema ID ou no pacote).");
    if (!credDefId) throw new Error("credDefId ausente (informe no pacote).");
    if (!reqMetaId) throw new Error("reqMetaId ausente (normalmente é offer.nonce).");

    // -----------------------------
    // 1) Checagem ANTI-FRAUDE de UX: raw -> encoded
    // (se alguém adulterou 'raw' e deixou 'encoded', vamos detectar aqui)
    // -----------------------------
    const pkgValueErrors = validateRawEncodedMap(credentialObj.values, "credential.values");
    if (pkgValueErrors.length > 0) {
      return {
        ok: true,
        cryptoValid: false,   // ainda não chegamos na prova; tratamos como inválida para o usuário
        semanticValid: false,
        reason: "Pacote adulterado: inconsistência raw→encoded nos valores da credencial.",
        errors: pkgValueErrors,
        revealed: null
      };
    }

    // Garantir link secret (se já existir, ignore o erro)
    try { await this.agent.createLinkSecret("default"); } catch (_) { }

    // -----------------------------
    // 2) Buscar públicos no ledger
    // -----------------------------
    const schemaJsonLedger = await this.agent.fetchSchemaFromLedger(cfg.genesisFile, schemaId);
    const credDefJsonLedger = await this.agent.fetchCredDefFromLedger(cfg.genesisFile, credDefId);

    const schemasMap = JSON.stringify({ [schemaId]: JSON.parse(schemaJsonLedger) });
    const credDefsMap = JSON.stringify({ [credDefId]: JSON.parse(credDefJsonLedger) });

    // -----------------------------
    // 3) Store: importa a credencial exatamente como veio do campo
    // -----------------------------
    const tmpCredId = `tmpCred_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
    const credJsonForStore = JSON.stringify(credentialObj);

    // OBS: storeCredential requer reqMetaId (nonce da oferta) no seu binding
    try {
      await this.agent.storeCredential(tmpCredId, credJsonForStore, reqMetaId, credDefJsonLedger, null);
    } catch (e) {
      const msg = String(e?.message || e);
      if (msg.includes("Request Metadata")) {
        throw new Error(
          "Request Metadata não encontrado nesta wallet.\n" +
          "Isso acontece quando esta instância NÃO criou o Credential Request da oferta (nonce).\n\n" +
          "Use o fluxo multi-instância:\n" +
          "Issuer exporta OFFER -> Holder aceita (gera REQUEST) -> Issuer emite CREDENTIAL -> Holder importa e verifica."
        );
      }
      throw e;
    }

    // -----------------------------
    // 4) Criar Proof Request para revelar TODOS os atributos
    // -----------------------------
    const attrNames = Object.keys(credentialObj.values || {});
    if (attrNames.length === 0) throw new Error("Credencial sem 'values'.");

    const requested_attributes = {};
    const requested_credentials_attrs = {};
    const restriction = [{ cred_def_id: credDefId }];

    attrNames.forEach((name, i) => {
      const ref = `attr${i + 1}`;
      requested_attributes[ref] = { name, restrictions: restriction };
      requested_credentials_attrs[ref] = { cred_id: tmpCredId, revealed: true };
    });

    const presReq = {
      nonce: String(Date.now()),
      name: "Verificacao (Revelar Tudo)",
      version: "1.0",
      requested_attributes,
      requested_predicates: {}
    };

    const presReqJson = JSON.stringify(presReq);

    const requestedCredentials = {
      self_attested_attributes: {},
      requested_attributes: requested_credentials_attrs,
      requested_predicates: {}
    };

    // -----------------------------
    // 5) Criar apresentação e verificar criptograficamente
    // -----------------------------
    const presentationJson = await this.agent.createPresentation(
      presReqJson,
      JSON.stringify(requestedCredentials),
      schemasMap,
      credDefsMap
    );

    const isValid = await this.agent.verifyPresentation(
      presReqJson,
      presentationJson,
      schemasMap,
      credDefsMap
    );

    // -----------------------------
    // 6) Extrair revelados
    // -----------------------------
    const presObj = JSON.parse(presentationJson);
    const ra = presObj?.requested_proof?.revealed_attrs || {};

    const revealed = {};
    for (const [ref, v] of Object.entries(ra)) {
      const name = presReq.requested_attributes[ref]?.name || ref;
      revealed[name] = { raw: v.raw, encoded: v.encoded };
    }

    // -----------------------------
    // 7) Checagem raw->encoded também nos revelados
    // (garante que o que a UI mostra bate com o que está assinado)
    // -----------------------------
    const revealedErrors = validateRawEncodedMap(revealed, "revealed");
    const semanticValid = (revealedErrors.length === 0);

    // -----------------------------
    // 8) Retorno auditável
    // -----------------------------
    return {
      ok: true,
      cryptoValid: !!isValid,
      semanticValid,
      errors: revealedErrors,
      used: {
        schemaId,
        credDefId,
        reqMetaId,
        tmpCredId,
        credentialSha256: crypto.createHash("sha256").update(credJsonForStore).digest("hex")
      },
      revealed
    };
  }

  // Salva um pacote (credencial/apresentação) em arquivo JSON: aceita tanto o objeto “puro” quanto um wrapper `{ ok, result }`
  // e faz o unwrap quando necessário. Abre um diálogo nativo de salvamento (`dialog.showSaveDialog`) sugerindo um nome padrão
  // e restringindo para extensão .json. Se o usuário cancelar, retorna `{ ok:false, canceled:true }`. Caso confirmado, grava o
  // conteúdo serializado (JSON identado, UTF-8) no caminho escolhido e retorna `{ ok:true, filePath }` para rastreabilidade.
  async saveCredentialToFile(defaultName, pkgLike) {
    // Aceita tanto pacote puro quanto {ok,result}
    let pkg = pkgLike;
    if (pkg && typeof pkg === "object" && pkg.result && typeof pkg.result === "object") {
      pkg = pkg.result;
    }

    const { canceled, filePath } = await dialog.showSaveDialog({
      title: "Salvar credencial (JSON)",
      defaultPath: defaultName || `credential-${Date.now()}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });

    if (canceled || !filePath) return { ok: false, canceled: true };

    fs.writeFileSync(filePath, JSON.stringify(pkg, null, 2), "utf-8");
    return { ok: true, filePath };
  }

  // Abre um arquivo JSON contendo um package (credencial/apresentação): exibe o diálogo nativo de seleção (`showOpenDialog`)
  // limitado a .json, trata cancelamento retornando `{ ok:false, canceled:true }`, lê o arquivo em UTF-8 e faz o parse do JSON.
  // Se o conteúdo estiver no formato wrapper `{ ok, result }`, desempacota para obter o objeto útil. Retorna `{ ok:true, filePath, pkg }`
  // para que a UI possa preencher o textarea e exibir o caminho carregado.
  async openCredentialFromFile() {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: "Abrir credencial (JSON)",
      properties: ["openFile"],
      filters: [{ name: "JSON", extensions: ["json"] }],
    });

    if (canceled || !filePaths || !filePaths[0]) return { ok: false, canceled: true };

    const filePath = filePaths[0];
    const content = fs.readFileSync(filePath, "utf-8");

    let pkg = JSON.parse(content);

    // Se o arquivo contiver wrapper {ok,result}, desempacota
    if (pkg && typeof pkg === "object" && pkg.result && typeof pkg.result === "object") {
      pkg = pkg.result;
    }

    return { ok: true, filePath, pkg };
  }

  // novos métodos aqui
  // 6) Criar apresentação (para exportar e verificar em outra instância)
  // Gera um Presentation Package a partir de um pacote de credencial: garante wallet e rede ativas, faz parse do JSON de
  // entrada (`credentialPackageJson`), remove wrapper `{ ok, result }` e extrai o objeto de credencial suportando múltiplos
  // formatos (credential/cred/credentialJson/credJson). Resolve `schemaId`, `credDefId` e `reqMetaId` (nonce da oferta) com
  // fallbacks e valida presença, pois `reqMetaId` é necessário para `storeCredential`. Garante o link secret ("default"),
  // busca Schema e CredDef no ledger e prepara os mapas `{ schemaId: schemaJson }` e `{ credDefId: credDefJson }` exigidos
  // pelo AnonCreds. Em seguida, importa a credencial em um ID temporário na wallet, constrói um Proof Request que revela
  // todos os atributos (restrito pelo `cred_def_id`), cria a apresentação (`createPresentation`) e extrai os atributos
  // revelados do próprio `presentationJson`. Por fim, retorna um package padronizado (`ssi-presentation-package-v1`) contendo
  // metadados (schemaId/credDefId/issuerDid/timestamp) e os objetos `presentationRequest`, `presentation` e `revealed` para
  // visualização e verificação posterior no front-end.
  async createPresentationPackage(cfg, input) {
    await this.ensureWallet(cfg);
    await this.ensureNetwork(cfg);

    let pkg = JSON.parse(input.credentialPackageJson);
    if (pkg && typeof pkg === "object" && pkg.result && typeof pkg.result === "object") pkg = pkg.result;

    const credentialObj =
      (pkg && typeof pkg.credential === "object" && pkg.credential) ? pkg.credential :
        (pkg && typeof pkg.cred === "object" && pkg.cred) ? pkg.cred :
          (pkg && typeof pkg.credentialJson === "string") ? JSON.parse(pkg.credentialJson) :
            (pkg && typeof pkg.credJson === "string") ? JSON.parse(pkg.credJson) :
              null;

    if (!credentialObj) throw new Error("Pacote inválido: credencial ausente.");

    const schemaId =
      input.schemaId ||
      pkg.schemaId ||
      (pkg.offer && pkg.offer.schema_id) ||
      credentialObj.schema_id;

    const credDefId =
      pkg.credDefId ||
      (pkg.offer && pkg.offer.cred_def_id) ||
      credentialObj.cred_def_id;

    const reqMetaId =
      pkg.reqMetaId ||
      (pkg.offer && pkg.offer.nonce);

    if (!schemaId) throw new Error("schemaId ausente.");
    if (!credDefId) throw new Error("credDefId ausente.");
    if (!reqMetaId) throw new Error("reqMetaId ausente (necessário para storeCredential).");

    // Link secret idempotente
    try { await this.agent.createLinkSecret("default"); } catch (_) { }

    // ledger publics
    const schemaJsonLedger = await this.agent.fetchSchemaFromLedger(cfg.genesisFile, schemaId);
    const credDefJsonLedger = await this.agent.fetchCredDefFromLedger(cfg.genesisFile, credDefId);

    const schemasMap = JSON.stringify({ [schemaId]: JSON.parse(schemaJsonLedger) });
    const credDefsMap = JSON.stringify({ [credDefId]: JSON.parse(credDefJsonLedger) });

    // store temp
    const crypto = require("crypto");
    const tmpCredId = `tmpCred_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;

    const credJsonForStore = JSON.stringify(credentialObj);
    await this.agent.storeCredential(tmpCredId, credJsonForStore, reqMetaId, credDefJsonLedger, null);

    // montar presReq revelando tudo
    const attrNames = Object.keys(credentialObj.values || {});
    if (attrNames.length === 0) throw new Error("Credencial sem 'values'.");

    const requested_attributes = {};
    const requested_credentials_attrs = {};
    const restriction = [{ cred_def_id: credDefId }];

    attrNames.forEach((name, i) => {
      const ref = `attr${i + 1}`;
      requested_attributes[ref] = { name, restrictions: restriction };
      requested_credentials_attrs[ref] = { cred_id: tmpCredId, revealed: true };
    });

    const presReq = {
      nonce: String(Date.now()),
      name: "Apresentacao (Revelar Tudo)",
      version: "1.0",
      requested_attributes,
      requested_predicates: {}
    };

    const presReqJson = JSON.stringify(presReq);
    const requestedCredentials = {
      self_attested_attributes: {},
      requested_attributes: requested_credentials_attrs,
      requested_predicates: {}
    };

    const presentationJson = await this.agent.createPresentation(
      presReqJson,
      JSON.stringify(requestedCredentials),
      schemasMap,
      credDefsMap
    );

    // opcional: extrair revelados do próprio presentationJson
    const presObj = JSON.parse(presentationJson);
    const ra = presObj?.requested_proof?.revealed_attrs || {};
    const revealed = {};
    for (const [ref, v] of Object.entries(ra)) {
      const name = presReq.requested_attributes[ref]?.name || ref;
      revealed[name] = { raw: v.raw, encoded: v.encoded };
    }

    return {
      type: "ssi-presentation-package-v1",
      schemaId,
      credDefId,
      issuerDid: pkg.issuerDid || credDefId.split(":")[0],
      createdAt: new Date().toISOString(),
      presentationRequest: presReq,     // objeto (mais legível)
      presentation: JSON.parse(presentationJson), // objeto
      revealed
    };
  }

  // 7) Verificar apresentação importada (funciona em outra instância)
  // Verifica criptograficamente um Presentation Package já pronto: garante conectividade com o ledger (`ensureNetwork`),
  // faz parse do JSON de entrada (`presentationPackageJson`), remove wrapper `{ ok, result }` e valida o tipo esperado
  // (`ssi-presentation-package-v1`). Extrai `schemaId`, `credDefId`, `presentationRequest` e `presentation`, serializa
  // esses objetos para JSON e busca no ledger os públicos necessários (Schema e CredDef) para montar os mapas exigidos
  // pela verificação AnonCreds. Em seguida, chama `agent.verifyPresentation(...)` e retorna um resultado padronizado
  // contendo `isValid`, os IDs utilizados e um mapa `revealed` extraído de `requested_proof.revealed_attrs`, tentando
  // mapear cada referência para o nome do atributo definido no `presentationRequest` para facilitar exibição na UI.
  async verifyPresentationPackage(cfg, input) {
    await this.ensureNetwork(cfg);

    let pkg = JSON.parse(input.presentationPackageJson);
    if (pkg && typeof pkg === "object" && pkg.result && typeof pkg.result === "object") pkg = pkg.result;

    if (!pkg || pkg.type !== "ssi-presentation-package-v1") {
      throw new Error("Pacote inválido: esperado type='ssi-presentation-package-v1'.");
    }

    const schemaId = pkg.schemaId;
    const credDefId = pkg.credDefId;
    const presReqObj = pkg.presentationRequest;
    const presObj = pkg.presentation;

    if (!schemaId || !credDefId) throw new Error("schemaId/credDefId ausentes no pacote.");
    if (!presReqObj || !presObj) throw new Error("presentationRequest/presentation ausentes no pacote.");

    const presReqJson = JSON.stringify(presReqObj);
    const presentationJson = JSON.stringify(presObj);

    // publics do ledger
    const schemaJsonLedger = await this.agent.fetchSchemaFromLedger(cfg.genesisFile, schemaId);
    const credDefJsonLedger = await this.agent.fetchCredDefFromLedger(cfg.genesisFile, credDefId);

    const schemasMap = JSON.stringify({ [schemaId]: JSON.parse(schemaJsonLedger) });
    const credDefsMap = JSON.stringify({ [credDefId]: JSON.parse(credDefJsonLedger) });

    const isValid = await this.agent.verifyPresentation(
      presReqJson,
      presentationJson,
      schemasMap,
      credDefsMap
    );

    // extrai revelados (se quiser mostrar na UI)
    const ra = presObj?.requested_proof?.revealed_attrs || {};
    const rag = presObj?.requested_proof?.revealed_attr_groups || {};

    const revealed = {};

    // revealed_attrs (caso comum)
    for (const [ref, v] of Object.entries(ra)) {
      const name = presReqObj?.requested_attributes?.[ref]?.name || ref;
      revealed[name] = { raw: v.raw, encoded: v.encoded };
    }

    // revealed_attr_groups (robustez: alguns proof requests usam "names")
    for (const [gref, g] of Object.entries(rag)) {
      const values = g?.values || {};
      for (const [attrName, v] of Object.entries(values)) {
        // evita colisão de chave, se necessário
        const key = revealed[attrName] ? `${gref}:${attrName}` : attrName;
        revealed[key] = { raw: v.raw, encoded: v.encoded };
      }
    }

    // 1) cripto
    const cryptoValid = !!isValid;

    // 2) semântica (raw→encoded)
    const revealedErrors = validateRawEncodedMap(revealed, "presentation.revealed");
    // const semanticValid = (revealedErrors.length === 0);

    const semanticValid = cryptoValid && (revealedErrors.length === 0);
    const verified = cryptoValid && semanticValid;

    let reason = null;
    if (!cryptoValid) {
      reason = "Prova criptográfica inválida.";
    } else if (!semanticValid) {
      reason = "Pacote adulterado: inconsistência raw→encoded nos valores revelados da apresentação.";
    }

    return {
      ok: true,
      cryptoValid,
      verified,
      reason,
      errors: revealedErrors,
      revealed,
      used: { schemaId, credDefId }
    };

  }

  // ===========================================================================
  // 8) Export/Import de APRESENTAÇÃO (Presentation Package) via arquivo JSON
  // ===========================================================================

  // Salva um Presentation Package em arquivo JSON: aceita tanto objeto “puro” quanto wrapper `{ ok, result }`.
  async savePresentationToFile(defaultName, pkgLike) {
    let pkg = pkgLike;

    // unwrap {ok,result}
    if (pkg && typeof pkg === "object" && pkg.result && typeof pkg.result === "object") {
      pkg = pkg.result;
    }

    const { canceled, filePath } = await dialog.showSaveDialog({
      title: "Salvar apresentação (JSON)",
      defaultPath: defaultName || `presentation-${Date.now()}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });

    if (canceled || !filePath) return { ok: false, canceled: true };

    fs.writeFileSync(filePath, JSON.stringify(pkg, null, 2), "utf-8");
    return { ok: true, filePath };
  }

  // Abre um arquivo JSON contendo um Presentation Package: retorna `{ ok:true, filePath, pkg }`.
  async openPresentationFromFile() {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: "Abrir apresentação (JSON)",
      properties: ["openFile"],
      filters: [{ name: "JSON", extensions: ["json"] }],
    });

    if (canceled || !filePaths || !filePaths[0]) return { ok: false, canceled: true };

    const filePath = filePaths[0];
    const content = fs.readFileSync(filePath, "utf-8");

    let pkg = JSON.parse(content);

    // unwrap {ok,result}
    if (pkg && typeof pkg === "object" && pkg.result && typeof pkg.result === "object") {
      pkg = pkg.result;
    }

    return { ok: true, filePath, pkg };
  }


}

// Instancia um singleton do serviço SSI e exporta a mesma instância para todo o Main Process (main.js e demais módulos).
// Isso garante estado compartilhado (ex.: wallet aberta, agente nativo carregado) e evita múltiplas inicializações
// concorrentes do binding nativo e da carteira.
const ssi = new SsiService();
module.exports = { ssi };

