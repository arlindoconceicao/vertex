#!/usr/bin/env node
/**
 * Script de Simulação do Aplicativo Móvel: Aceite/Rejeição de Credenciais pelo Titular (Holder)
 *
 * GUIA DE IMPLEMENTAÇÃO MOBILE:
 * Este script serve como especificação de referência para desenvolvedores mobile
 * (iOS / Android / Flutter / React Native) implementarem o fluxo de consentimento do usuário.
 *
 * Fluxo funcional no aplicativo móvel do TITULAR:
 * 1. Conecta-se à carteira SQLite cifrada local (SQLCipher).
 *    NOTA: As chaves privadas e DIDs ficam protegidos diretamente no SQLite cifrado (SQLCipher),
 *    sem utilização do Android Keystore.
 * 2. Autentica-se na plataforma via M2M Zero-Trust:
 *    - Header 'Authorization': Bearer <HMAC-SHA256(SIGNER_SECRET, holderDid)>
 *    - Header 'x-signer-auth-credential': Prova de Posse (PoP) efêmera assinada localmente com ML-DSA-65.
 * 3. Consulta as credenciais oferecidas destinadas ao seu DID (GET /api/signer/requests/offered).
 * 4. Realiza o aceite (POST /api/signer/requests/offered/[id]/accept ou /batch-accept) ou rejeição,
 *    movendo o status da credencial na plataforma para PENDING (aguardando assinatura digital do emissor).
 *
 * USO CLI:
 *   node lib/holder-accept-offer.js [opções] [credentialId|batchId]
 *   ou diretamente:
 *   lib/holder-accept-offer.js --wallet lib/holder_wallet.db
 *
 * OPÇÕES:
 *   --wallet <caminho>   Caminho para o banco da carteira (ex: lib/holder_wallet.db, lib/issuer_wallet.db)
 *   --keys <caminho>     Caminho para o arquivo de senha da carteira
 *   --reject             Rejeita a credencial em vez de aceitar
 *   --batch              Usa a rota em lote (/api/signer/requests/offered/batch-accept)
 */

require("dotenv").config(); // Carrega variáveis de ambiente (.env)
const fs = require("fs"); // No mobile nativo: APIs de arquivo locais do SO
const path = require("path"); // Utilitário para manipulação de caminhos de arquivos
const crypto = require("crypto"); // No mobile nativo: biblioteca padrão de criptografia (ex: CommonCrypto ou javax.crypto)
const core = require("./ssi_pq_core.node"); // No mobile nativo: biblioteca C++/Rust de criptografia pós-quântica via JNI/FFI

async function main() {
  const args = process.argv.slice(2); // No mobile: as opções vêm das interações do usuário na interface
  const isReject = args.includes("--reject"); // Define se a ação do usuário na tela é rejeitar a oferta
  const useBatchEndpoint = args.includes("--batch"); // Define se o app enviará aceite em lote ou individual

  // 1. Localização e Seleção da Carteira SQLite e Arquivo de Chaves
  // GUIA MOBILE: As chaves privadas e os DIDs residem diretamente dentro do banco SQLite cifrado (SQLCipher).
  // O app não utiliza o Android Keystore; a confidencialidade é garantida pelo SQLCipher.
  const walletArgIdx = args.indexOf("--wallet");
  let customWallet = walletArgIdx !== -1 ? args[walletArgIdx + 1] : process.env.WALLET_PATH;

  let walletPath = "";
  if (customWallet) {
    walletPath = path.resolve(customWallet); // Utiliza a carteira especificada via argumento --wallet
  } else if (fs.existsSync(path.join(__dirname, "holder_wallet.db"))) {
    walletPath = path.join(__dirname, "holder_wallet.db"); // Carteira padrão do titular
  } else if (fs.existsSync(path.join(__dirname, "issuer_wallet.db"))) {
    walletPath = path.join(__dirname, "issuer_wallet.db"); // Carteira unificada de testes (emissor/titular)
  } else {
    walletPath = path.join(__dirname, "mobile_wallet.db"); // Carteira móvel padrão
  }

  const keysArgIdx = args.indexOf("--keys");
  let customKeys = keysArgIdx !== -1 ? args[keysArgIdx + 1] : process.env.KEYS_PATH;

  let keysFilePath = "";
  if (customKeys) {
    keysFilePath = path.resolve(customKeys); // Chave personalizada indicada
  } else {
    // Busca a senha correspondente ao arquivo da carteira (ex: holder_wallet.keys.txt)
    const baseName = path.basename(walletPath, path.extname(walletPath));
    const candidateKeys = path.join(path.dirname(walletPath), `${baseName}.keys.txt`);
    if (fs.existsSync(candidateKeys)) {
      keysFilePath = candidateKeys; // Chave da carteira específica
    } else {
      keysFilePath = path.join(__dirname, "keys.txt"); // Fallback para keys.txt
    }
  }

  // Identificador específico de uma credencial ou lote informado via argumento (opcional)
  const targetId = args.find((a) => !a.startsWith("-") && a !== customWallet && a !== customKeys);

  // URL base da API da plataforma (no mobile, configurada via build variants / variáveis de ambiente)
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const offeredEndpoint = `${baseUrl}/api/signer/requests/offered`; // Endpoint para consulta de ofertas

  // Segredo compartilhado M2M (no mobile, provisionado no pareamento seguro do dispositivo)
  const secretsStr = process.env.SIGNER_SECRETS || process.env.SIGNER_SECRET;
  const signerSecret = secretsStr ? secretsStr.split(",")[0].trim() : "mobile-signer-secret-token";

  console.log("=================================================");
  console.log(`📱 APP MÓVEL DO TITULAR - ${isReject ? "REJEIÇÃO" : "ACEITE"} DE OFERTAS`);
  console.log("=================================================");
  console.log(`💾 Wallet DB  : ${walletPath}`);
  console.log(`🔑 Senha DB   : ${keysFilePath}`);

  // Validação: Garante que o banco SQLite e o arquivo de chave existem antes de tentar abrir
  if (!fs.existsSync(keysFilePath) || !fs.existsSync(walletPath)) {
    console.error("\n❌ [ERRO] Wallet móvel ou arquivo de chaves não encontrados.");
    console.error("   Certifique-se de executar o pareamento do titular primeiro.");
    process.exit(1); // Encerra caso a carteira ainda não tenha sido pareada/criada
  }

  const walletPassword = fs.readFileSync(keysFilePath, "utf-8").trim(); // Lê a senha mestra para desbloquear o SQLCipher

  // 2. Abertura do Banco SQLite Cifrado e Obtenção do DID do Titular
  // GUIA MOBILE: No app, o DID ativo fica na sessão do usuário após o desbloqueio do banco
  let registeredDids = [];
  try {
    core.walletOpen(walletPath, walletPassword); // Descriptografa e inicializa a carteira SQLCipher
    registeredDids = core.walletListDids(walletPath, walletPassword) || []; // Obtém os DIDs salvos na carteira
  } catch (err) {
    console.error("\n❌ [ERRO] Falha ao abrir wallet SQLite:", err.message); // Notifica caso a senha ou banco estejam inválidos
    process.exit(1);
  }

  const activeDidData = registeredDids[registeredDids.length - 1]; // Seleciona o DID do titular ativo
  if (!activeDidData) {
    console.error("\n❌ [ERRO] Nenhuma DID encontrada na wallet do titular.");
    process.exit(1); // Aborta se a carteira não possuir identidades cadastradas
  }
  const holderDid = activeDidData.did; // DID que assinará digitalmente as requisições
  console.log(`👤 Titular DID: ${holderDid}`);

  // 3. Função Auxiliar: Geração dos Cabeçalhos de Autenticação (PoP Pós-Quântica + HMAC)
  // GUIA MOBILE: Cada chamada segura requer uma credencial efêmera (PoP) com timestamp e ação específica.
  function buildAuthHeaders(actionName) {
    const timestamp = new Date().toISOString(); // Timestamp UTC no formato ISO-8601
    const authData = { action: actionName, timestamp }; // Payload da prova de autorização
    
    // Cria schema temporário para a credencial efêmera de autorização
    const authSchema = core.createSchemaFromAttributes(authData, {
      version: "1.0",
      createdAt: timestamp,
    });
    
    // Assina a prova criptográfica (PoP) usando a chave privada ML-DSA-65 do titular
    const signedCredential = core.walletIssueCredentialFromSchema(
      walletPath,
      walletPassword,
      holderDid, // DID emissor da prova de autorização
      authSchema,
      authData,
      {
        credentialId: `auth-holder-${Date.now()}`,
        issuedAt: timestamp,
        visiblePaths: ["action", "timestamp"], // Divulgação seletiva dos atributos requeridos
      }
    );

    // Codifica a credencial assinada em Base64 para envio no header HTTP
    const authHeaderBase64 = Buffer.from(JSON.stringify(signedCredential)).toString("base64");
    
    // Gera o token de autorização Bearer via HMAC-SHA256 (chave compartilhada + DID do titular)
    const bearerToken = crypto.createHmac("sha256", signerSecret).update(holderDid).digest("hex");

    return {
      "x-signer-auth-credential": authHeaderBase64, // Header com a Prova de Posse (PoP) assinada
      Authorization: `Bearer ${bearerToken}`, // Header Bearer token M2M
      "Content-Type": "application/json",
    };
  }

  // 4. Consulta de Ofertas Pendentes (GET /api/signer/requests/offered)
  // GUIA MOBILE: Pode ser disparado ao abrir a tela de notificações, via Pull-to-Refresh ou Push Notification
  console.log("\n📡 [1/2] Consultando ofertas pendentes na plataforma...");
  const listHeaders = buildAuthHeaders("offered_requests_auth"); // Gera cabeçalho para a ação de listagem

  let offeredList = [];
  try {
    const listRes = await fetch(offeredEndpoint, {
      method: "GET", // Requisição HTTP GET
      headers: listHeaders, // Cabeçalhos de autenticação do titular
    });

    if (!listRes.ok) {
      const errText = await listRes.text();
      throw new Error(`HTTP ${listRes.status}: ${errText}`); // Lança erro com detalhes caso HTTP != 200
    }

    offeredList = await listRes.json(); // Array de credenciais oferecidas retornado pela plataforma
  } catch (err) {
    console.error("❌ Falha ao buscar credenciais oferecidas:", err.message); // Notifica erro de rede ou autenticação
    process.exit(1);
  }

  // Tratamento de estado vazio (Empty State)
  if (!Array.isArray(offeredList) || offeredList.length === 0) {
    console.log("ℹ️  Nenhuma credencial OFFERED encontrada para este titular.");
    process.exit(0); // GUIA MOBILE: No app, exibir "Nenhuma oferta pendente no momento"
  }

  console.log(`✔ Encontradas ${offeredList.length} oferta(s) para este titular.`);

  // 5. Filtragem Opcional: Permite aceitar uma credencial ou lote específico caso indicado
  let targets = offeredList;
  if (targetId) {
    targets = offeredList.filter(
      (item) => item.requestId === targetId || item.batchId === targetId // Compara com ID individual ou ID do lote
    );
    if (targets.length === 0) {
      console.error(`❌ Nenhuma oferta encontrada com ID ou BatchId '${targetId}'.`);
      process.exit(1);
    }
  }

  // 6. Execução do Aceite ou Rejeição via API HTTP
  const actionPath = isReject ? "reject" : "accept"; // Rota de destino da ação
  const actionLabel = isReject ? "Rejeitando" : "Aceitando"; // Rótulo amigável para logs

  // CENÁRIO A: Aceite em Lote (Batch Accept)
  // GUIA MOBILE: Disparado quando o usuário clica em "Aceitar Todas" na visualização do Lote
  if (useBatchEndpoint && !isReject) {
    console.log(`\n📡 [2/2] Enviando aceite em lote para a plataforma...`);
    const batchHeaders = buildAuthHeaders("accept_credential_auth"); // Gera cabeçalhos com ação de aceite
    
    const batchRes = await fetch(`${baseUrl}/api/signer/requests/offered/batch-accept`, {
      method: "POST", // Requisição HTTP POST
      headers: batchHeaders, // Cabeçalhos autenticados
      body: JSON.stringify({
        credentialIds: targets.map((t) => t.requestId), // Envia lista com os IDs de todas as credenciais do lote
      }),
    });

    if (!batchRes.ok) {
      const errBody = await batchRes.text();
      console.error(`❌ Erro no aceite em lote (HTTP ${batchRes.status}):`, errBody); // GUIA MOBILE: Exibir erro na UI
      process.exit(1);
    }

    const batchData = await batchRes.json(); // Resposta com total de credenciais aceitas
    console.log(`\n🎉 Sucesso! ${batchData.count} credencial(is) aceita(s) em lote.`);
    console.log(`   Status atualizado para PENDING (prontas para assinatura do emissor).`);
    // GUIA MOBILE: Exibir Toast/Snackbar de sucesso e atualizar lista de credenciais na UI
  } else {
    // CENÁRIO B: Aceite ou Rejeição Individual (Item a Item)
    // GUIA MOBILE: Disparado ao aceitar ou rejeitar uma credencial individualmente na tela de detalhes
    console.log(`\n📡 [2/2] Processando ${targets.length} credencial(is) via API REST...`);

    for (let i = 0; i < targets.length; i++) {
      const item = targets[i];
      console.log(`\n   [${i + 1}/${targets.length}] ${actionLabel} credencial: ${item.requestId}`);
      if (item.batchId) console.log(`      Lote: ${item.batchId}`);
      if (item.issuer?.name) console.log(`      Emissor: ${item.issuer.name} (${item.issuer.did})`);

      // Endpoint REST por credencial: /api/signer/requests/offered/{requestId}/accept ou /reject
      const endpoint = `${baseUrl}/api/signer/requests/offered/${item.requestId}/${actionPath}`;
      const actionHeaders = buildAuthHeaders(`${actionPath}_credential_auth`); // Assina a autorização específica para esta ação

      const res = await fetch(endpoint, {
        method: "POST", // Requisição HTTP POST
        headers: actionHeaders, // Cabeçalhos autenticados
      });

      if (!res.ok) {
        const errorText = await res.text();
        console.error(`      ❌ Falha ao ${actionPath} (HTTP ${res.status}): ${errorText}`); // GUIA MOBILE: Notificar falha
      } else {
        const result = await res.json();
        console.log(`      ✔ Concluído com sucesso (Status: ${result.credential?.status || "OK"}).`);
      }
    }

    console.log("\n=================================================");
    console.log(`🎉 OPERAÇÃO DO TITULAR CONCLUÍDA VIA HTTP!`);
    if (!isReject) {
      console.log(`👉 As credenciais aceitas estão agora em status PENDING.`);
      console.log(`   O Emissor já pode emitir a assinatura móvel com:`);
      console.log(`   node lib/sign-batch-credentials.js --upload`);
    }
    console.log("=================================================\n");
  }
}

// Ponto de entrada para execução em linha de comando
if (require.main === module) {
  main().catch((err) => {
    console.error("❌ Erro inesperado:", err); // Captura erros não tratados
    process.exit(1);
  });
}

module.exports = { main }; // Exporta a função para permitir uso programático em testes ou suítes automatizadas

