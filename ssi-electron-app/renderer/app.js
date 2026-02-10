// renderer/app.js
(() => {

  // IIFE para isolar o escopo do script do Renderer e evitar poluir o objeto global (window).
  // "use strict" habilita o modo estrito para reduzir comportamentos implícitos/ambíguos e tornar erros mais visíveis.
  // A função utilitária `$` é um atalho para `document.getElementById`, usada para acessar elementos do DOM por id
  // de forma mais legível e consistente ao longo do arquivo.

  "use strict";
  const $ = (id) => document.getElementById(id);

  // Helper “fail-fast” para buscar elementos do DOM por id: usa `$` (getElementById) e lança um erro explícito
  // se o elemento não existir. Isso evita falhas silenciosas (null) e facilita depuração quando há divergência
  // entre os IDs esperados no app.js e os elementos definidos no index.html.
  function mustEl(id) {
    const el = $(id);
    if (!el) throw new Error(`Elemento do HTML não encontrado: id="${id}". Verifique o index.html carregado.`);
    return el;
  }

  // Normaliza e exibe a saída no painel "out": se a resposta seguir o padrão { ok, result, error },
  // extrai apenas `result` para mostrar o conteúdo útil; caso contrário, imprime o próprio objeto/valor.
  // A renderização é feita como JSON identado (2 espaços) para facilitar leitura e depuração no UI.
  function out(res) {
    const view = (res && typeof res === "object" && Object.prototype.hasOwnProperty.call(res, "result"))
      ? res.result
      : res;
    $("out").textContent = JSON.stringify(view, null, 2);
  }

  // Coleta e normaliza (trim) os valores de configuração informados na UI para montar o objeto `cfg`,
  // que é enviado ao backend via IPC em todas as operações SSI. Inclui parâmetros de rede (genesis),
  // carteira (path/pass), credenciais do trustee/issuer e campos opcionais (issuerSeed/newDidRole).
  // Também resolve com segurança o DID efetivo do emissor (`issuerDid`) que será usado para escrita no ledger.
  function cfg() {
    return {
      genesisUrl: $("genesisUrl").value.trim(),
      genesisFile: $("genesisFile").value.trim(),
      walletPath: $("walletPath").value.trim(),
      walletPass: $("walletPass").value.trim(),
      trusteeSeed: $("trusteeSeed").value.trim(),
      trusteeDid: $("trusteeDid").value.trim(),
      issuerSeed: ($("issuerSeed")?.value || "").trim(),
      newDidRole: ($("newDidRole")?.value || "").trim(),

      // DID que será usado para escrever no ledger (schema/credDef)
      issuerDid: getIssuerDidForLedgerSafe(),
    };
  }

  // Faz o parse de JSON com validação “segura”: normaliza o texto (string + trim), rejeita conteúdo vazio
  // e, em caso de erro de parse, relança uma exceção com mensagem contextualizada (label) para orientar o usuário
  // exatamente qual campo contém JSON inválido e por quê.
  function parseJsonSafe(text, label) {
    const t = String(text || "").trim();
    if (!t) throw new Error(`${label} está vazio.`);
    try { return JSON.parse(t); }
    catch (e) { throw new Error(`${label} contém JSON inválido: ${e.message}`); }
  }

  // Desencapsula respostas “aninhadas” no formato { result: { ... } } (até 3 níveis), comum em retornos
  // intermediários do backend/IPC. A ideia é chegar no payload útil sem depender de uma profundidade fixa,
  // evitando que a UI precise tratar manualmente múltiplas camadas de `result.result.result`.
  function unwrapDeep(x) {
    let cur = x;
    for (let i = 0; i < 3; i++) {
      if (cur && typeof cur === "object" && cur.result && typeof cur.result === "object") cur = cur.result;
      else break;
    }
    return cur;
  }

  // Normaliza um “pacote” (credencial/apresentação) para exibição em textarea: primeiro remove camadas
  // desnecessárias de wrapper via `unwrapDeep` e depois serializa o objeto em JSON identado (2 espaços),
  // garantindo um formato legível e consistente na UI.
  function normalizePackageForTextarea(pkgOrWrapper) {
    const pkg = unwrapDeep(pkgOrWrapper);
    return JSON.stringify(pkg, null, 2);
  }

  // Lê o conteúdo do textarea `credPkg`, valida que é um JSON não vazio (parseJsonSafe) e remove possíveis
  // camadas de wrapper (unwrapDeep), retornando o objeto “pacote” pronto para ser enviado às rotinas de
  // verificação/geração sem depender do formato exato usado na colagem/importação.
  function getAnyPackageFromTextarea() {
    const el = mustEl("credPkg");
    const obj = parseJsonSafe(el.value, "Package (JSON)");
    return unwrapDeep(obj);
  }

  // Heurística para identificar se o objeto recebido é um “pacote de credencial”: verifica estrutura básica
  // (objeto) e procura pelo `type` esperado (ssi-credential-package-v1) ou por chaves alternativas comuns
  // em variações de payload (credential/cred/credentialJson/credJson), garantindo compatibilidade com formatos
  // ligeiramente diferentes de exportação/importação.
  function isCredentialPackage(pkg) {
    return pkg && typeof pkg === "object" && (pkg.type === "ssi-credential-package-v1" || pkg.credential || pkg.cred || pkg.credentialJson || pkg.credJson);
  }

  // Heurística para identificar se o objeto é um “pacote de apresentação”: confirma que é um objeto e
  // valida pelo `type` esperado (ssi-presentation-package-v1) ou, alternativamente, pela presença do par
  // (presentation + presentationRequest), típico de um payload de apresentação/verificação.
  function isPresentationPackage(pkg) {
    return pkg && typeof pkg === "object" && (pkg.type === "ssi-presentation-package-v1" || (pkg.presentation && pkg.presentationRequest));
  }

  function isOfferPackage(pkg) {
    return pkg && typeof pkg === "object" && pkg.type === "ssi-credential-offer-package-v1" && pkg.offer;
  }

  function isRequestPackage(pkg) {
    return pkg && typeof pkg === "object" && pkg.type === "ssi-credential-request-package-v1" && pkg.offer && pkg.request;
  }


  // Tenta auto-preencher o campo `verifySchemaId` a partir de um pacote de credencial, extraindo o schema_id
  // de locais comuns (offer.schema_id, credential.schema_id, schemaId). Se encontrar um valor e o input existir
  // na página, atualiza o formulário para reduzir trabalho manual e evitar erros de digitação.
  function maybeAutofillVerifySchemaIdFromCredential(pkg) {
    const schemaId = pkg?.offer?.schema_id || pkg?.credential?.schema_id || pkg?.schemaId || "";
    if (schemaId && $("verifySchemaId")) $("verifySchemaId").value = schemaId;
  }

  // Tenta auto-preencher o campo `verifySchemaId` a partir de um pacote de apresentação: prioriza `pkg.schemaId`
  // (quando presente) e só aplica o preenchimento se existir um indício de que o objeto é uma apresentação
  // (ex.: presence de `presentationRequest.requested_attributes`) e o input `verifySchemaId` existir na página.
  function maybeAutofillVerifySchemaIdFromPresentation(pkg) {
    const schemaId = pkg?.schemaId || pkg?.presentationRequest?.requested_attributes ? pkg?.schemaId : "";
    if (schemaId && $("verifySchemaId")) $("verifySchemaId").value = schemaId;
  }

  // Wrapper assíncrono para executar ações da UI com tratamento padronizado de sucesso/erro: chama `fn()`,
  // imprime o resultado em `out()` e devolve a resposta. Em caso de exceção, captura o erro e publica um
  // objeto estruturado ({ ok:false, context, message, stack }) para facilitar diagnóstico, retornando null
  // para sinalizar falha ao fluxo chamador.
  async function run(actionName, fn) {
    try {
      const res = await fn();
      out(res);
      return res;
    } catch (e) {
      out({ ok: false, context: actionName, message: e?.message || String(e), stack: e?.stack || null });
      return null;
    }
  }

  // -------------------------
  // Modal (Visualizar Credencial)
  // -------------------------

  // Controla a visibilidade do modal de visualização (`credModal`): se o elemento existir no DOM, alterna
  // `display` entre "flex" (mostrar) e "none" (ocultar). O `flex` é usado para manter o layout centralizado
  // conforme definido no CSS do modal.
  function showModal(show) {
    const el = $("credModal");
    if (!el) return;
    el.style.display = show ? "flex" : "none";
  }

  // Versão genérica do controle de modais: recebe o `modalId`, verifica se o elemento existe e alterna
  // sua visibilidade via `display` ("flex" para abrir e "none" para fechar). Permite reutilizar a mesma
  // lógica para diferentes janelas/modais da aplicação.
  function showModalById(modalId, show) {
    const el = $(modalId);
    if (!el) return;
    el.style.display = show ? "flex" : "none";
  }

  // Extrai o objeto de credencial “real” a partir de diferentes formatos de pacote: aceita tanto campos
  // já desserializados (credential/cred) quanto variantes em string JSON (credentialJson/credJson), fazendo
  // o parse quando necessário. Retorna null se nenhum formato conhecido estiver presente.
  function extractCredentialObject(pkg) {
    if (pkg && typeof pkg.credential === "object" && pkg.credential) return pkg.credential;
    if (pkg && typeof pkg.cred === "object" && pkg.cred) return pkg.cred;
    if (pkg && typeof pkg.credentialJson === "string") return JSON.parse(pkg.credentialJson);
    if (pkg && typeof pkg.credJson === "string") return JSON.parse(pkg.credJson);
    return null;
  }


  // Extrai o DID do emissor a partir de um identificador Indy no formato "DID:...": valida entrada,
  // divide por ":" e retorna o primeiro segmento (DID) já normalizado (trim). Se o formato for inválido
  // ou não houver segmento, retorna string vazia.
  function extractIssuerDidFromIndyId(id) {
    if (!id || typeof id !== "string") return "";
    const parts = id.split(":");
    return parts[0] ? String(parts[0]).trim() : "";
  }

  // Lê o conteúdo do textarea `credPkg`, faz o parse validado do JSON (com mensagem contextualizada) e
  // remove camadas de wrapper via `unwrapDeep`, retornando um pacote normalizado que pode ser tanto de
  // credencial quanto de apresentação, conforme o conteúdo colado/importado pelo usuário.
  function extractPresentationPackageFromTextarea() {
    const txt = $("credPkg").value;
    const obj = parseJsonSafe(txt, "Credential/Presentation Package (JSON)");
    return unwrapDeep(obj);
  }

  // Extrai o objeto de apresentação (VP/prova) a partir de diferentes formatos de “package”, mantendo
  // compatibilidade com versões antigas/alternativas: aceita campos já desserializados (presentation/proof)
  // e variantes em string JSON (presentationJson/proofJson/presJson), realizando o parse quando necessário.
  // Retorna null se nenhum campo conhecido estiver presente.
  function extractPresentationObject(pkg) {
    // Aceita vários nomes possíveis, para aguentar versões
    // - pkg.presentation (obj)
    // - pkg.presentationJson (string)
    // - pkg.proof / pkg.presentationPackage
    if (pkg && typeof pkg.presentation === "object" && pkg.presentation) return pkg.presentation;
    if (pkg && typeof pkg.presentationJson === "string") return JSON.parse(pkg.presentationJson);

    if (pkg && typeof pkg.proof === "object" && pkg.proof) return pkg.proof;
    if (pkg && typeof pkg.proofJson === "string") return JSON.parse(pkg.proofJson);

    // Às vezes o "presentation package" vem com { presReqJson, presJson }:
    if (pkg && typeof pkg.presJson === "string") return JSON.parse(pkg.presJson);

    return null;
  }

  // Determina o DID do emissor a partir de um pacote de credencial: tenta obter `cred_def_id` e `schema_id`
  // de locais comuns (offer/credObj/pkg) e extrai o DID do prefixo Indy ("DID:...") via `extractIssuerDidFromIndyId`.
  // Se não encontrar nesses IDs, usa `pkg.issuerDid` como fallback. Retorna string vazia quando não há DID.
  function getIssuerDidFromPkg(pkg, credObj) {
    const credDefId =
      pkg?.offer?.cred_def_id ||
      credObj?.cred_def_id ||
      pkg?.credDefId ||
      "";

    const schemaId =
      pkg?.offer?.schema_id ||
      credObj?.schema_id ||
      pkg?.schemaId ||
      "";

    const fromCredDef = extractIssuerDidFromIndyId(credDefId);
    if (fromCredDef) return fromCredDef;

    const fromSchema = extractIssuerDidFromIndyId(schemaId);
    if (fromSchema) return fromSchema;

    if (pkg?.issuerDid) return String(pkg.issuerDid).trim();
    return "";
  }

  // Determina o DID do emissor a partir de uma apresentação Indy: prioriza o campo `identifiers` da própria
  // apresentação (mais confiável), extraindo o DID do prefixo dos IDs `cred_def_id` ou `schema_id`.
  // Se `identifiers` não estiver disponível, faz fallback para campos conhecidos do pacote (credDefId/offer/...),
  // retornando string vazia caso não seja possível derivar o DID.
  function getIssuerDidFromPresentation(pkg, presObj) {
    // “Padrão Indy”: derive do cred_def_id ou schema_id (mais confiável)
    const identifiers = presObj?.identifiers;
    if (Array.isArray(identifiers) && identifiers.length > 0) {
      const id0 = identifiers[0];
      const fromCredDef = extractIssuerDidFromIndyId(id0?.cred_def_id || "");
      if (fromCredDef) return fromCredDef;

      const fromSchema = extractIssuerDidFromIndyId(id0?.schema_id || "");
      if (fromSchema) return fromSchema;
    }

    // fallback: tenta achar nos campos conhecidos do pacote
    const credDefId = pkg?.credDefId || pkg?.offer?.cred_def_id || "";
    const schemaId = pkg?.schemaId || pkg?.offer?.schema_id || "";
    return extractIssuerDidFromIndyId(credDefId) || extractIssuerDidFromIndyId(schemaId) || "";
  }

  // Extrai os atributos revelados (revealed_attrs) de uma apresentação Indy: percorre `requested_proof.revealed_attrs`
  // e converte cada entrada em um array normalizado { ref, raw, encoded }. Isso facilita a renderização na UI,
  // mantendo compatibilidade com o formato típico { raw, encoded } e tratando valores ausentes de forma segura.
  function extractRevealedAttrsFromPresentation(presObj) {
    const ra = presObj?.requested_proof?.revealed_attrs || {};
    const out = [];

    for (const [ref, v] of Object.entries(ra)) {
      // v tende a ser { raw, encoded }
      const raw = (v && typeof v === "object" && "raw" in v) ? String(v.raw) : String(v ?? "");
      const encoded = (v && typeof v === "object" && "encoded" in v) ? String(v.encoded) : "";
      out.push({ ref, raw, encoded });
    }
    return out;
  }

  // Preenche o modal de “Visualizar Apresentação” a partir de um Presentation Package: extrai o objeto de apresentação,
  // deriva schemaId/credDefId (preferindo `presentation.identifiers[0]` e usando fallbacks do pacote), calcula o DID do emissor
  // e atualiza os campos do modal. Em seguida, monta dinamicamente a lista de atributos revelados (requested_proof.revealed_attrs)
  // para renderização na UI, exibindo um aviso amigável quando não houver atributos revelados.
  function fillPresModal(pkg) {
    const presObj = extractPresentationObject(pkg);
    if (!presObj) {
      throw new Error("Pacote não contém apresentação. Gere/importe um Presentation Package e tente novamente.");
    }

    // Identifiers (schema/creddef) normalmente existem aqui
    const identifiers = presObj?.identifiers;
    const id0 = Array.isArray(identifiers) && identifiers.length > 0 ? identifiers[0] : null;

    const schemaId =
      (id0?.schema_id) ||
      pkg?.schemaId ||
      pkg?.offer?.schema_id ||
      "";

    const credDefId =
      (id0?.cred_def_id) ||
      pkg?.credDefId ||
      pkg?.offer?.cred_def_id ||
      "";

    const issuerDid = getIssuerDidFromPresentation(pkg, presObj);

    $("pmSchemaId").textContent = schemaId || "—";
    $("pmCredDefId").textContent = credDefId || "—";
    $("pmIssuerDid").textContent = issuerDid || "—";

    const attrsEl = $("pmAttrs");
    attrsEl.innerHTML = "";

    const revealed = extractRevealedAttrsFromPresentation(presObj);

    if (revealed.length === 0) {
      attrsEl.innerHTML = `<div class="attr-item">
      <div class="attr-name">Sem atributos revelados</div>
      <div class="attr-value">A apresentação não contém "requested_proof.revealed_attrs".</div>
    </div>`;
      return;
    }

    const presReqAttrs = pkg?.presentationRequest?.requested_attributes || {};

    function displayNameForRef(ref) {
      return presReqAttrs?.[ref]?.name || ref; // fallback se não existir
    }

    for (const item0 of revealed) {
      const item = document.createElement("div");
      item.className = "attr-item";

      const label = displayNameForRef(item0.ref);

      item.innerHTML = `
    <div class="attr-name">${label}</div>
    <div class="attr-value">${item0.raw}</div>
    ${item0.encoded
          ? `<div class="attr-name" style="margin-top:8px;">encoded</div>
           <div class="attr-value">${item0.encoded}</div>`
          : ""
        }
  `;
      attrsEl.appendChild(item);
    }

  }

  // Gera um “resumo” da apresentação exibida no modal (schemaId, credDefId, issuerDid e atributos revelados),
  // varrendo o DOM do container `pmAttrs` para coletar os itens renderizados, e copia esse JSON formatado para
  // a área de transferência via `navigator.clipboard`. Retorna o objeto de resumo para uso posterior (ex.: logs/UI).
  async function copyPresSummaryToClipboard() {
    const schemaId = $("pmSchemaId")?.textContent || "";
    const credDefId = $("pmCredDefId")?.textContent || "";
    const issuerDid = $("pmIssuerDid")?.textContent || "";

    const attrs = [];
    const container = $("pmAttrs");
    if (container) {
      const items = container.querySelectorAll(".attr-item");
      for (const item of items) {
        const name = item.querySelector(".attr-name")?.textContent || "";
        const values = item.querySelectorAll(".attr-value");
        const raw = values?.[0]?.textContent || "";
        attrs.push({ ref: name, raw });
      }
    }

    const summary = { schemaId, credDefId, issuerDid, revealed: attrs };
    await navigator.clipboard.writeText(JSON.stringify(summary, null, 2));
    return summary;
  }


  // Preenche o modal de “Visualizar Credencial” a partir de um Credential Package: extrai o objeto de credencial,
  // resolve schemaId/credDefId (com fallbacks do pacote/offer), deriva o DID do emissor e atualiza os campos do modal.
  // Em seguida, monta dinamicamente a lista de atributos a partir de `credential.values`, normalizando `raw/encoded`
  // quando presentes, e exibe uma mensagem amigável caso a credencial não contenha atributos.
  function fillCredModal(pkg) {
    const credObj = extractCredentialObject(pkg);
    if (!credObj) throw new Error("Pacote inválido: não foi possível localizar 'credential'.");

    const schemaId = credObj?.schema_id || pkg?.offer?.schema_id || pkg?.schemaId || "";
    const credDefId = credObj?.cred_def_id || pkg?.offer?.cred_def_id || pkg?.credDefId || "";
    const issuerDid = getIssuerDidFromPkg(pkg, credObj);

    $("vmSchemaId").textContent = schemaId || "—";
    $("vmCredDefId").textContent = credDefId || "—";
    $("vmIssuerDid").textContent = issuerDid || "—";

    const attrsEl = $("vmAttrs");
    attrsEl.innerHTML = "";

    const values = credObj?.values || {};
    const keys = Object.keys(values);

    if (keys.length === 0) {
      attrsEl.innerHTML = `<div class="attr-item">
        <div class="attr-name">Sem atributos</div>
        <div class="attr-value">A credencial não contém "values".</div>
      </div>`;
      return;
    }

    for (const name of keys) {
      const v = values[name];
      const raw = (v && typeof v === "object" && "raw" in v) ? String(v.raw) : String(v);
      const encoded = (v && typeof v === "object" && "encoded" in v) ? String(v.encoded) : "";

      const item = document.createElement("div");
      item.className = "attr-item";
      item.innerHTML = `
        <div class="attr-name">${name}</div>
        <div class="attr-value">${raw}</div>
        ${encoded ? `<div class="attr-name" style="margin-top:8px;">encoded</div><div class="attr-value">${encoded}</div>` : ""}
      `;
      attrsEl.appendChild(item);
    }
  }


  // Gera um “resumo” da credencial exibida no modal (schemaId, credDefId, issuerDid e atributos), coletando os itens
  // renderizados no DOM (`vmAttrs`) e copiando esse JSON formatado para a área de transferência via `navigator.clipboard`.
  // Retorna o objeto de resumo para permitir reaproveitamento (ex.: logs, UI ou exportação).
  async function copyCredSummaryToClipboard() {
    const schemaId = $("vmSchemaId")?.textContent || "";
    const credDefId = $("vmCredDefId")?.textContent || "";
    const issuerDid = $("vmIssuerDid")?.textContent || "";

    const attrs = [];
    const container = $("vmAttrs");
    if (container) {
      const items = container.querySelectorAll(".attr-item");
      for (const item of items) {
        const name = item.querySelector(".attr-name")?.textContent || "";
        const values = item.querySelectorAll(".attr-value");
        const raw = values?.[0]?.textContent || "";
        attrs.push({ name, raw });
      }
    }

    const summary = { schemaId, credDefId, issuerDid, attributes: attrs };
    await navigator.clipboard.writeText(JSON.stringify(summary, null, 2));
    return summary;
  }

  // -------------------------
  // Issuer Mode (who writes to the ledger)
  // -------------------------

  // Estado local da UI: `issuerMode` define qual identidade será usada nas operações (TRUSTEE existente ou um novo DID),
  // e `lastDidRecord` guarda o último DID criado/ativado ({ did, verkey }) para reutilização automática em etapas
  // subsequentes (ex.: escrever schema/credDef no ledger) sem exigir nova digitação do usuário.
  let issuerMode = "TRUSTEE"; // "TRUSTEE" | "NEW_DID"
  let lastDidRecord = null;   // { did, verkey }

  // Sincroniza a UI com o estado atual do emissor: aplica `issuerMode` no seletor correspondente e calcula
  // o DID “ativo” (TRUSTEE → usa o campo trusteeDid; NEW_DID → usa o último DID criado em `lastDidRecord`).
  // Em seguida, atualiza `issuerDidSelected` para que o usuário visualize claramente qual DID será utilizado.
  function refreshIssuerUI() {
    if ($("issuerMode")) $("issuerMode").value = issuerMode;

    const did =
      issuerMode === "TRUSTEE"
        ? ($("trusteeDid")?.value || "").trim()
        : (lastDidRecord?.did || "");

    if ($("issuerDidSelected")) $("issuerDidSelected").value = did;
  }

  // Retorna, de forma segura, o DID que será efetivamente usado para operações de escrita no ledger (schema/credDef):
  // se o modo for TRUSTEE, usa o DID informado no campo `trusteeDid`; caso contrário, usa o último DID criado/ativado
  // armazenado em `lastDidRecord`. Garante retorno como string normalizada (trim), evitando undefined/null.
  function getIssuerDidForLedgerSafe() {
    if (issuerMode === "TRUSTEE") return ($("trusteeDid")?.value || "").trim();
    return (lastDidRecord?.did || "").trim();
  }

  // Handler do botão “Usar Trustee”: ao clicar, muda o modo do emissor para TRUSTEE, atualiza a UI com
  // `refreshIssuerUI()` e publica no painel de saída um objeto de status contendo o modo selecionado e o DID
  // efetivo que será usado no ledger. A execução é encapsulada em `run()` para padronizar logs e captura de erros.
  if ($("btnUseTrustee")) {
    $("btnUseTrustee").onclick = () =>
      run("btnUseTrustee", async () => {
        issuerMode = "TRUSTEE";
        refreshIssuerUI();
        return { ok: true, issuerMode, issuerDid: getIssuerDidForLedgerSafe() };
      });
  }


  // Handler do botão “Usar Novo DID”: ao clicar, muda o modo do emissor para NEW_DID, atualiza a UI com
  // `refreshIssuerUI()` e exibe no painel de saída o estado atual (modo e DID efetivo para escrita no ledger).
  // A ação roda dentro de `run()` para manter tratamento uniforme de resultado/erro.
  if ($("btnUseNewDid")) {
    $("btnUseNewDid").onclick = () =>
      run("btnUseNewDid", async () => {
        issuerMode = "NEW_DID";
        refreshIssuerUI();
        return { ok: true, issuerMode, issuerDid: getIssuerDidForLedgerSafe() };
      });
  }

  // Handler do botão “Visualizar Apresentação”: ao clicar, lê o JSON do textarea (credPkg), normaliza o pacote,
  // preenche o modal de apresentação (`fillPresModal`) e abre o modal (`presModal`). Retorna um status simples
  // ({ ok:true, viewed:true }) e usa `run()` para padronizar a saída e captura de erros (ex.: JSON inválido).
  if ($("btnViewPres")) {
    $("btnViewPres").onclick = () =>
      run("btnViewPres", async () => {
        const pkg = extractPresentationPackageFromTextarea();
        fillPresModal(pkg);
        showModalById("presModal", true);
        return { ok: true, viewed: true };
      });
  }

  // Handlers de fechamento do modal de apresentação: conectam os botões de “fechar” (ex.: X no topo e botão no rodapé)
  // para ocultar o `presModal` via `showModalById(...)`. A duplicidade permite múltiplos pontos de fechamento na UI.
  if ($("btnClosePresModal")) $("btnClosePresModal").onclick = () => showModalById("presModal", false);
  if ($("btnClosePresModal2")) $("btnClosePresModal2").onclick = () => showModalById("presModal", false);

  // Permite fechar o modal de apresentação ao clicar fora do conteúdo: adiciona um listener no overlay (`presModal`)
  // e, se o alvo do clique for o próprio overlay (id === "presModal"), oculta o modal. Isso evita fechar quando
  // o usuário clica dentro do painel interno do modal.
  if ($("presModal")) {
    $("presModal").addEventListener("click", (e) => {
      if (e.target && e.target.id === "presModal") showModalById("presModal", false);
    });
  }

  // Handler do botão “Copiar Resumo da Apresentação”: coleta os dados atualmente exibidos no modal (schemaId, credDefId,
  // issuerDid e atributos revelados), copia o JSON para a área de transferência (clipboard) e retorna um status
  // ({ ok:true, copied:true, summary }) para registro no painel de saída. Usa `run()` para padronizar logs e erros.
  if ($("btnCopyPresSummary")) {
    $("btnCopyPresSummary").onclick = () =>
      run("btnCopyPresSummary", async () => {
        const summary = await copyPresSummaryToClipboard();
        return { ok: true, copied: true, summary };
      });
  }

  // ---------------------------
  // Event bindings
  // ---------------------------

  // Handler do botão “Testar Conexão”: ao clicar, monta a configuração atual via `cfg()` e invoca o backend
  // (`window.ssiApi.testConnection`) para validar acesso à rede/ledger/carteira conforme parâmetros informados.
  // A chamada é encapsulada em `run()` para exibir o resultado no painel e padronizar tratamento de erros.
  $("btnTest").onclick = () =>
    run("btnTest", () => window.ssiApi.testConnection(cfg()));

  // Handler do botão “Criar DID”: chama `createDidAndRegister(cfg())` no backend para criar/ativar um DID e,
  // quando o retorno trouxer `newDid` e `newVerkey`, salva esse par em `lastDidRecord` para reutilização automática
  // (modo NEW_DID) e atualiza a UI com `refreshIssuerUI()`. Usa `unwrapDeep` para acessar o payload útil mesmo
  // que o resultado venha encapsulado em camadas de `result`, e `run()` para padronizar saída/erros.
  $("btnDid").onclick = () =>
    run("btnDid", async () => {
      const res = await window.ssiApi.createDidAndRegister(cfg());
      const payload = unwrapDeep(res);

      if (payload?.newDid && payload?.newVerkey) {
        lastDidRecord = { did: payload.newDid, verkey: payload.newVerkey };
        refreshIssuerUI();
      }
      return res;
    });

  // Handler do botão “Criar Schema”: valida a versão base informada (ex.: 1.0 ou 1.0.1), extrai major/minor e
  // gera um patch automaticamente a partir do timestamp (segundos) para garantir unicidade do schema no ledger.
  // Monta o objeto `schema` com name, version e a lista de atributos (uma linha por atributo) e invoca
  // `window.ssiApi.createSchema(cfg(), schema)`. Se o retorno trouxer `schemaId`, auto-preenche os campos
  // `schemaId` e `verifySchemaId` para uso imediato em etapas posteriores. A execução é encapsulada em `run()`
  // e usa `unwrapDeep` para lidar com respostas com camadas de `result`.
  $("btnSchema").onclick = () =>
    run("btnSchema", async () => {
      const base = $("schemaVersion").value.trim();
      const parts = base.split(".").map((p) => p.trim()).filter(Boolean);
      if (parts.length < 2 || parts.length > 3) throw new Error("Versão inválida. Use 2 ou 3 partes: ex. 1.0 ou 1.0.1");

      const major = parts[0] || "1";
      const minor = parts[1] || "0";
      const patch = String(Math.floor(Date.now() / 1000) % 1000000);

      const schema = {
        name: $("schemaName").value.trim(),
        version: `${major}.${minor}.${patch}`,
        attrs: $("schemaAttrs").value.split("\n").map((s) => s.trim()).filter(Boolean),
      };

      const res = await window.ssiApi.createSchema(cfg(), schema);
      const payload = unwrapDeep(res);

      const schemaId = payload?.schemaId || payload?.result?.schemaId;
      if (schemaId) {
        $("schemaId").value = schemaId;
        $("verifySchemaId").value = schemaId;
      }
      return res;
    });

  // Handler do botão “Criar CredDef”: monta o objeto `credDef` com `schemaId` (já criado/selecionado) e `tag`,
  // chama `window.ssiApi.createCredDef(cfg(), credDef)` para registrar o Credential Definition no ledger e,
  // em seguida, extrai `credDefId` do retorno (via `unwrapDeep`). Se o ID não vier, lança erro explícito para
  // sinalizar inconsistência no backend/ssiService. Ao obter o `credDefId`, preenche o campo na UI para uso
  // imediato nas etapas de emissão/verificação. A execução é encapsulada em `run()` para padronizar logs/erros.
  $("btnCredDef").onclick = () =>
    run("btnCredDef", async () => {
      const credDef = {
        schemaId: $("schemaId").value.trim(),
        tag: $("credDefTag").value.trim(),
      };

      const res = await window.ssiApi.createCredDef(cfg(), credDef);
      const payload = unwrapDeep(res);

      const credDefId = payload?.credDefId || payload?.result?.credDefId;
      if (!credDefId) throw new Error("createCredDef não retornou credDefId. Verifique o backend/ssiService.");

      $("credDefId").value = credDefId;
      return res;
    });

  // Handler do botão “Emitir Credencial”: valida o `credDefId` (espera o padrão Indy de CredDef contendo ':3:CL:',
  // evitando confusão com SchemaId ':2:'), monta o payload `issue` com `credDefId` e `values` (JSON validado via
  // `parseJsonSafe`) e chama `window.ssiApi.issueCredential(cfg(), issue)`. Após emitir, serializa o pacote retornado
  // para o textarea `credPkg` (formato legível via `normalizePackageForTextarea`) e tenta auto-preencher `verifySchemaId`
  // com base no pacote emitido. Encapsulado em `run()` para padronizar saída e captura de erros.
  $("btnIssue").onclick = () =>
    run("btnIssue", async () => {
      const credDefId = $("credDefId").value.trim();
      if (!credDefId.includes(":3:CL:")) {
        throw new Error("CredDef ID inválido. Use o ID que contém ':3:CL:' (não o Schema ID ':2:').");
      }

      const issue = {
        credDefId,
        values: parseJsonSafe($("credValues").value, "Valores (JSON)"),
      };

      const res = await window.ssiApi.issueCredential(cfg(), issue);

      $("credPkg").value = normalizePackageForTextarea(res);
      const pkg = unwrapDeep(res);
      maybeAutofillVerifySchemaIdFromCredential(pkg);

      return res;
    });

  // 1) Issuer: Criar Oferta (Exportar)
  if ($("btnOffer")) {
    $("btnOffer").onclick = () =>
      run("btnOffer", async () => {
        const credDefId = $("credDefId").value.trim();
        if (!credDefId.includes(":3:CL:")) {
          throw new Error("CredDef ID inválido. Use o ID que contém ':3:CL:'.");
        }
        const res = await window.ssiApi.createCredentialOfferPackage(cfg(), { credDefId });
        $("credPkg").value = normalizePackageForTextarea(res);
        return res;
      });
  }

  // 2) Holder: Aceitar Oferta (Gerar Request)
  if ($("btnAcceptOffer")) {
    $("btnAcceptOffer").onclick = () =>
      run("btnAcceptOffer", async () => {
        const pkg = getAnyPackageFromTextarea();
        if (!isOfferPackage(pkg)) {
          throw new Error("Cole no textarea um Offer Package (ssi-credential-offer-package-v1).");
        }
        const res = await window.ssiApi.acceptCredentialOfferPackage(cfg(), {
          offerPackageJson: JSON.stringify(pkg),
        });
        $("credPkg").value = normalizePackageForTextarea(res);
        return res;
      });
  }

  // 3) Issuer: Emitir a partir do Request
  if ($("btnIssueFromReq")) {
    $("btnIssueFromReq").onclick = () =>
      run("btnIssueFromReq", async () => {
        const pkg = getAnyPackageFromTextarea();
        if (!isRequestPackage(pkg)) {
          throw new Error("Cole no textarea um Request Package (ssi-credential-request-package-v1).");
        }

        const credDefId = $("credDefId").value.trim();
        if (!credDefId.includes(":3:CL:")) {
          throw new Error("CredDef ID inválido. Use o ID que contém ':3:CL:'.");
        }

        const values = parseJsonSafe($("credValues").value, "Valores (JSON)");

        const res = await window.ssiApi.issueCredentialFromRequestPackage(cfg(), {
          credDefId,
          values,
          requestPackageJson: JSON.stringify(pkg),
        });

        $("credPkg").value = normalizePackageForTextarea(res);
        const outPkg = unwrapDeep(res);
        maybeAutofillVerifySchemaIdFromCredential(outPkg);
        return res;
      });
  }

  // 4) Holder: Importar Credencial (Store/Process)
  if ($("btnStoreCred")) {
    $("btnStoreCred").onclick = () =>
      run("btnStoreCred", async () => {
        const pkg = getAnyPackageFromTextarea();
        if (!isCredentialPackage(pkg)) {
          throw new Error("Cole no textarea um Credential Package (ssi-credential-package-v1).");
        }
        const res = await window.ssiApi.storeCredentialFromPackage(cfg(), {
          credentialPackageJson: JSON.stringify(pkg),
        });
        return res;
      });
  }

  // Handler do botão “Verificar Credencial”: lê o JSON do textarea e valida o tipo do pacote (recusa apresentação
  // e exige pacote de credencial). Coleta `schemaId` para verificação e um atributo opcional a ser revelado
  // (`revealAttrName`), monta o payload `verify` com o pacote serializado (`credentialPackageJson`) e invoca
  // `window.ssiApi.verifyCredential(cfg(), verify)`. A execução roda dentro de `run()` para padronizar saída/erros.
  $("btnVerify").onclick = () =>
    run("btnVerify", async () => {
      const pkg = getAnyPackageFromTextarea();

      if (isPresentationPackage(pkg)) {
        throw new Error("O JSON atual é uma APRESENTAÇÃO. Use o botão 'Verificar Apresentação'.");
      }
      if (!isCredentialPackage(pkg)) {
        throw new Error("JSON inválido: esperado pacote de credencial.");
      }

      const schemaId = ($("verifySchemaId")?.value || "").trim();
      const revealAttrName = ($("revealAttr")?.value || "").trim(); // opcional

      const verify = {
        credentialPackageJson: JSON.stringify(pkg),
        schemaId,
        revealAttrName,
      };

      return window.ssiApi.verifyCredential(cfg(), verify);
    });

  // Handler do botão “Gerar Apresentação”: lê o JSON do textarea e garante que ele seja uma credencial (não uma
  // apresentação). Opcionalmente usa `verifySchemaId` como contexto, valida se `createPresentationPackage` está
  // exposto via IPC (preload/main) e chama `window.ssiApi.createPresentationPackage(...)` para gerar um Presentation
  // Package. Em seguida, normaliza o retorno (`unwrapDeep`), escreve o pacote no textarea `credPkg` e tenta auto-preencher
  // `verifySchemaId` para facilitar a verificação posterior. Executa dentro de `run()` para padronizar logs e erros.
  if ($("btnMakePres")) {
    $("btnMakePres").onclick = () =>
      run("btnMakePres", async () => {
        const pkg = getAnyPackageFromTextarea();

        if (isPresentationPackage(pkg)) {
          throw new Error("O JSON atual já é uma APRESENTAÇÃO. Use 'Verificar Apresentação' ou cole uma credencial.");
        }
        if (!isCredentialPackage(pkg)) {
          throw new Error("JSON inválido: cole um pacote de CREDENCIAL para gerar a apresentação.");
        }

        const schemaId = ($("verifySchemaId")?.value || "").trim();

        if (!window.ssiApi.createPresentationPackage) {
          throw new Error("createPresentationPackage não está exposto no preload/main. Atualize preload.js e main.js.");
        }

        const res = await window.ssiApi.createPresentationPackage(cfg(), {
          credentialPackageJson: JSON.stringify(pkg),
          schemaId: schemaId || undefined
        });

        const presPkg = unwrapDeep(res);
        $("credPkg").value = JSON.stringify(presPkg, null, 2);
        maybeAutofillVerifySchemaIdFromPresentation(presPkg);

        return res;
      });
  }

  // Handler do botão “Verificar Apresentação”: lê o JSON do textarea e valida que é um Presentation Package;
  // confirma que `verifyPresentationPackage` está exposto via IPC (preload/main) e chama o backend passando o pacote
  // serializado (`presentationPackageJson`). A execução roda dentro de `run()` para registrar o resultado no painel
  // e padronizar o tratamento de erros (ex.: pacote inválido ou API não exposta).
  if ($("btnVerifyPres")) {
    $("btnVerifyPres").onclick = () =>
      run("btnVerifyPres", async () => {
        const pkg = getAnyPackageFromTextarea();

        if (!isPresentationPackage(pkg)) {
          throw new Error("JSON inválido: cole um pacote de APRESENTAÇÃO (ssi-presentation-package-v1).");
        }

        if (!window.ssiApi.verifyPresentationPackage) {
          throw new Error("verifyPresentationPackage não está exposto no preload/main. Atualize preload.js e main.js.");
        }

        const res = await window.ssiApi.verifyPresentationPackage(cfg(), {
          presentationPackageJson: JSON.stringify(pkg),
        });

        return res;
      });
  }

  // Handler do botão “Salvar em Arquivo”: lê e normaliza o pacote (credencial ou apresentação) a partir do textarea
  // e solicita ao backend que abra o diálogo de salvamento e grave o JSON em disco, sugerindo um nome padrão
  // (`package-<timestamp>.json`). Usa `run()` para padronizar a saída e captura de erros durante leitura/serialização.
  if ($("btnSaveCredFile")) {
    $("btnSaveCredFile").onclick = () =>
      run("btnSaveCredFile", async () => {
        const pkg = getAnyPackageFromTextarea();

        if (isPresentationPackage(pkg)) {
          throw new Error("O JSON atual é uma APRESENTAÇÃO. Use 'Salvar Apresentação (JSON)'.");
        }
        if (!isCredentialPackage(pkg)) {
          throw new Error("JSON inválido: esperado pacote de CREDENCIAL.");
        }

        return window.ssiApi.saveCredentialToFile(`credential-${Date.now()}.json`, pkg);
      });
  }

  // Handler do botão “Abrir Arquivo”: solicita ao backend que abra o diálogo de seleção e carregue um package JSON
  // do disco (`openCredentialFromFile`). Se a leitura for bem-sucedida (res.ok), escreve o conteúdo no textarea
  // (`credPkg`) em formato legível e tenta auto-preencher `verifySchemaId` conforme o tipo do pacote (credencial ou
  // apresentação). Retorna um status com o caminho do arquivo para registro no painel. Encapsulado em `run()` para
  // padronizar logs e tratamento de erros.
  if ($("btnOpenCredFile")) {
    $("btnOpenCredFile").onclick = () =>
      run("btnOpenCredFile", async () => {
        const res = await window.ssiApi.openCredentialFromFile();
        if (!res || !res.ok) return res;

        const pkg = res.pkg;
        if (isPresentationPackage(pkg)) {
          throw new Error("O arquivo selecionado é uma APRESENTAÇÃO. Use 'Abrir Apresentação (JSON)'.");
        }
        if (!isCredentialPackage(pkg)) {
          throw new Error("Arquivo inválido: esperado pacote de CREDENCIAL.");
        }

        $("credPkg").value = JSON.stringify(pkg, null, 2);
        maybeAutofillVerifySchemaIdFromCredential(pkg);

        return { ok: true, opened: true, path: res.path, type: res.type || "credential" };
      });
  }


  // -------------------------
  // Arquivos (Apresentação)
  // -------------------------
  if ($("btnSavePresFile")) {
    $("btnSavePresFile").onclick = () =>
      run("btnSavePresFile", async () => {
        const pkg = getAnyPackageFromTextarea();

        if (isCredentialPackage(pkg) && !isPresentationPackage(pkg)) {
          throw new Error("O JSON atual é uma CREDENCIAL. Use 'Salvar Credencial (JSON)'.");
        }
        if (!isPresentationPackage(pkg)) {
          throw new Error("JSON inválido: esperado pacote de APRESENTAÇÃO (ssi-presentation-package-v1).");
        }

        if (!window.ssiApi.savePresentationToFile) {
          throw new Error("savePresentationToFile não está exposto no preload/main.");
        }

        return window.ssiApi.savePresentationToFile(`presentation-${Date.now()}.json`, pkg);
      });
  }

  if ($("btnOpenPresFile")) {
    $("btnOpenPresFile").onclick = () =>
      run("btnOpenPresFile", async () => {
        if (!window.ssiApi.openPresentationFromFile) {
          throw new Error("openPresentationFromFile não está exposto no preload/main.");
        }

        const res = await window.ssiApi.openPresentationFromFile();
        if (!res || !res.ok) return res;

        const pkg = res.pkg;
        if (!isPresentationPackage(pkg)) {
          throw new Error("Arquivo inválido: esperado pacote de APRESENTAÇÃO.");
        }

        $("credPkg").value = JSON.stringify(pkg, null, 2);
        maybeAutofillVerifySchemaIdFromPresentation(pkg);

        return { ok: true, opened: true, path: res.path, type: res.type || "presentation" };
      });
  }


  // Handler do botão “Visualizar Credencial”: lê o JSON do textarea e valida que seja um pacote de credencial
  // (recusa apresentação e formatos desconhecidos). Em seguida, preenche o modal com os metadados e atributos
  // (`fillCredModal`) e abre o modal de credencial (`showModal(true)`). Retorna um status simples ({ ok:true, viewed:true })
  // e usa `run()` para padronizar saída e captura de erros (ex.: JSON inválido ou tipo incorreto).
  if ($("btnViewCred")) {
    $("btnViewCred").onclick = () =>
      run("btnViewCred", async () => {
        const pkg = getAnyPackageFromTextarea();

        if (isPresentationPackage(pkg)) {
          throw new Error("O JSON atual é uma APRESENTAÇÃO. Este modal é para CREDENCIAL. Cole uma credencial para visualizar.");
        }
        if (!isCredentialPackage(pkg)) {
          throw new Error("JSON inválido: esperado pacote de credencial.");
        }

        fillCredModal(pkg);
        showModal(true);
        return { ok: true, viewed: true };
      });
  }

  // Handlers de fechamento do modal de credencial: conectam os botões de “fechar” (ex.: X no topo e botão no rodapé)
  // para ocultar o modal (`showModal(false)`). A duplicidade permite múltiplos pontos de fechamento na interface.
  if ($("btnCloseCredModal")) $("btnCloseCredModal").onclick = () => showModal(false);
  if ($("btnCloseCredModal2")) $("btnCloseCredModal2").onclick = () => showModal(false);

  // Permite fechar o modal de credencial ao clicar fora do conteúdo: adiciona um listener no overlay (`credModal`)
  // e, se o clique ocorrer no próprio overlay (id === "credModal"), fecha o modal. Isso evita fechamento ao clicar
  // dentro do painel interno e melhora a usabilidade da visualização.
  if ($("credModal")) {
    $("credModal").addEventListener("click", (e) => {
      if (e.target && e.target.id === "credModal") showModal(false);
    });
  }

  // Handler do botão “Copiar Resumo da Credencial”: coleta os dados atualmente exibidos no modal (schemaId, credDefId,
  // issuerDid e atributos), copia o JSON formatado para a área de transferência (clipboard) e retorna um status
  // ({ ok:true, copied:true, summary }) para registro no painel. Executa dentro de `run()` para padronizar logs e erros.
  if ($("btnCopyCredSummary")) {
    $("btnCopyCredSummary").onclick = () =>
      run("btnCopyCredSummary", async () => {
        const summary = await copyCredSummaryToClipboard();
        return { ok: true, copied: true, summary };
      });
  }

  // Inicializa/sincroniza a interface de seleção do emissor logo na carga da página, garantindo que os campos
  // `issuerMode` e `issuerDidSelected` reflitam o estado atual (`issuerMode` e `lastDidRecord`) antes do usuário
  // executar qualquer operação.
  refreshIssuerUI();
})();
