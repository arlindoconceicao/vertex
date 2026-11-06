#!/usr/bin/env node
/**
 * Script de Simulação do Aplicativo Móvel: Assinatura de Credenciais em Lote
 *
 * GUIA DE IMPLEMENTAÇÃO MOBILE:
 * Este script serve como especificação funcional e arquitetural para desenvolvedores
 * mobile (iOS / Android / Flutter / React Native) implementarem o fluxo de emissão
 * e assinatura digital de credenciais em lote pelo EMISSOR (Issuer).
 *
 * Fluxo de Execução no Aplicativo Móvel do EMISSOR:
 * 1. Conexão à Carteira Local Cifrada (SQLCipher):
 *    - Todas as chaves privadas pós-quânticas (ML-DSA-65) e o DID do emissor residem
 *      diretamente no banco SQLite cifrado (SQLCipher). Não é utilizado o Android Keystore.
 * 2. Autenticação M2M Zero-Trust com Prova de Posse (PoP):
 *    - Header 'Authorization': Bearer <HMAC-SHA256(SIGNER_SECRET, issuerDid)>
 *    - Header 'x-signer-auth-credential': Credencial efêmera assinada localmente com ML-DSA-65
 *      indicando a ação 'pending_requests_auth' e timestamp UTC (tolerância máxima de 2 minutos).
 * 3. Download das Pendências de Assinatura:
 *    - Requisição GET /api/signer/requests/pending para buscar credenciais que já foram
 *      aceitas pelos titulares (status PENDING) e aguardam a assinatura do emissor.
 * 4. Assinatura Digital Pós-Quântica Offline / On-Device:
 *    - Para cada credencial do lote, o app assina os atributos usando a chave ML-DSA-65.
 *    - O app gera a representação visual em PDF da credencial.
 *    - Embutimento criptográfico: a credencial assinada é embutida diretamente no PDF.
 *    - As credenciais assinadas são persistidas no armazenamento offline local da carteira.
 * 5. Sincronização / Upload para a Plataforma (--upload):
 *    - Disparo opcional ou em background para enviar as credenciais assinadas de volta
 *      à plataforma web, movendo o status das credenciais para ACTIVE.
 *
 * USO CLI:
 *   lib/sign-batch-credentials.js [batchId] [--upload] [--wallet <caminho>]
 *
 * EXEMPLOS:
 *   lib/sign-batch-credentials.js --upload --wallet lib/issuer_wallet.db
 *   lib/sign-batch-credentials.js de44a5e9-5944-4d30-88c5-4995d0432ad5
 *   lib/sign-batch-credentials.js --upload
 */

require("dotenv").config(); // Carrega variáveis de ambiente do arquivo .env
const fs = require("fs"); // No mobile nativo: usar APIs de I/O de arquivo locais do SO
const path = require("path"); // Módulo para resolução e concatenação de diretórios/arquivos
const crypto = require("crypto"); // No mobile nativo: biblioteca padrão de criptografia (ex: CommonCrypto ou javax.crypto)
const core = require("./ssi_pq_core.node"); // No mobile nativo: biblioteca nativa C++/Rust com algoritmos pós-quânticos via JNI/FFI

async function main() {
  const args = process.argv.slice(2); // Argumentos passados na linha de comando
  const shouldUpload = args.includes("--upload") || args.includes("-u"); // Flag que indica se deve sincronizar logo após assinar

  // 1. Localização e Resolução da Carteira SQLite e Arquivo de Senha
  // GUIA MOBILE: As chaves e dados residem exclusivamente no SQLite cifrado (SQLCipher).
  // O app móvel não utiliza o Android Keystore; a proteção é provida pela cifra do SQLCipher.
  const walletArgIdx = args.indexOf("--wallet");
  const customWallet = walletArgIdx !== -1 ? args[walletArgIdx + 1] : process.env.WALLET_PATH;
  let walletPath = "";
  if (customWallet) {
    walletPath = path.resolve(customWallet); // Utiliza o caminho da carteira informado via --wallet
  } else if (fs.existsSync(path.join(__dirname, "issuer_wallet.db"))) {
    walletPath = path.join(__dirname, "issuer_wallet.db"); // Carteira padrão do emissor em ambiente de desenvolvimento
  } else {
    walletPath = path.join(__dirname, "mobile_wallet.db"); // Carteira móvel padrão genérica
  }

  const keysArgIdx = args.indexOf("--keys");
  const customKeys = keysArgIdx !== -1 ? args[keysArgIdx + 1] : process.env.KEYS_PATH;
  let keysFilePath = "";
  if (customKeys) {
    keysFilePath = path.resolve(customKeys); // Caminho personalizado de chave
  } else {
    // Localiza o arquivo de senha associado ao banco (ex: issuer_wallet.keys.txt)
    const baseName = path.basename(walletPath, path.extname(walletPath));
    const candidateKeys = path.join(path.dirname(walletPath), `${baseName}.keys.txt`);
    if (fs.existsSync(candidateKeys)) {
      keysFilePath = candidateKeys; // Chave específica da carteira selecionada
    } else {
      keysFilePath = path.join(__dirname, "keys.txt"); // Fallback para o arquivo keys.txt padrão
    }
  }

  // Identifica se um batchId específico foi informado para assinatura
  const targetBatchId = args.find((a, idx) => {
    if (a.startsWith("-")) return false;
    if (walletArgIdx !== -1 && (idx === walletArgIdx || idx === walletArgIdx + 1)) return false;
    if (keysArgIdx !== -1 && (idx === keysArgIdx || idx === keysArgIdx + 1)) return false;
    return true;
  });

  // URL do endpoint de pendências (no mobile, configurada via build variants / variáveis de ambiente)
  const pendingEndpoint = process.env.NEXT_PUBLIC_APP_URL
      ? `${process.env.NEXT_PUBLIC_APP_URL}/api/signer/requests/pending`
      : "http://localhost:3000/api/signer/requests/pending";

  // Segredo compartilhado M2M para HMAC (no mobile, provisionado no pareamento da conta)
  const secretsStr = process.env.SIGNER_SECRETS || process.env.SIGNER_SECRET;
  const signerSecret = secretsStr ? secretsStr.split(',')[0].trim() : "mobile-signer-secret-token";

  // Arquivo local para simular a fila de saída offline do app antes do envio à nuvem
  const offlineStoragePath = path.join(__dirname, "offline_signed_batches.json");

  console.log("=================================================");
  console.log("🚀 SIMULANDO APLICATIVO MÓVEL - ASSINATURA DE LOTE");
  console.log("=================================================");
  console.log(`💾 Wallet DB  : ${walletPath}`);

  // Validação: Garante que o banco da carteira e a senha existem
  if (!fs.existsSync(keysFilePath) || !fs.existsSync(walletPath)) {
    console.error(`❌ [ERRO] Wallet (${walletPath}) ou chaves (${keysFilePath}) não inicializadas.`);
    process.exit(1);
  }

  const walletPassword = fs.readFileSync(keysFilePath, "utf-8").trim(); // Lê a senha mestra para desbloquear o SQLCipher

  // 2. Acesso à Carteira Local Cifrada e Obtenção do DID do Emissor
  // GUIA MOBILE: No app móvel, o DID do emissor é obtido após o desbloqueio do banco de dados local
  let registeredDids = [];
  try {
    core.walletOpen(walletPath, walletPassword); // Abre a base SQLite cifrada e carrega as chaves em memória
    registeredDids = core.walletListDids(walletPath, walletPassword) || []; // Lista todos os DIDs cadastrados na carteira
  } catch (err) {
    console.error("❌ [ERRO] Falha ao abrir wallet:", err.message); // Notifica erro caso a senha esteja incorreta
    process.exit(1);
  }

  const activeDidData = registeredDids[registeredDids.length - 1]; // Obtém o DID ativo do emissor no dispositivo
  if (!activeDidData) {
    console.error("❌ [ERRO] Nenhuma DID encontrada na wallet móvel.");
    process.exit(1);
  }
  const signerDid = activeDidData.did; // DID do emissor que assinará digitalmente as credenciais do lote

  // 3. Montagem da Autenticação Segura (Proof-of-Possession com ML-DSA + Token Bearer HMAC)
  // GUIA MOBILE: O servidor só libera o download de credenciais pendentes se o emissor provar
  // que detém a chave privada pós-quântica do seu DID (segurança Zero-Trust ponta a ponta).
  const timestamp = new Date().toISOString(); // Timestamp UTC ISO-8601
  const authCredentialData = { action: "pending_requests_auth", timestamp }; // Ação autorizada para este endpoint
  const authSchema = core.createSchemaFromAttributes(authCredentialData, { version: '1.0', createdAt: timestamp });
  
  // Emissão da credencial efêmera de autorização assinada com ML-DSA-65
  const signedAuth = core.walletIssueCredentialFromSchema(
    walletPath, walletPassword, signerDid, authSchema, authCredentialData,
    { credentialId: `auth-${Date.now()}`, issuedAt: timestamp, visiblePaths: ['action', 'timestamp'] }
  );

  // Codificação do PoP em Base64 para envio no cabeçalho HTTP
  const authHeaderBase64 = Buffer.from(JSON.stringify(signedAuth)).toString('base64');
  // Cálculo do token Bearer HMAC-SHA256 combinando a chave secreta com o DID do emissor
  const bearerToken = crypto.createHmac("sha256", signerSecret).update(signerDid).digest("hex");

  // 4. Download das Pendências de Assinatura via HTTP GET
  // GUIA MOBILE: No app, esta busca pode ocorrer ao abrir a aba "Assinaturas Pendentes" ou via Notificação Push
  console.log("\n📡 [App Mobile] Conectando ao servidor para baixar pendências de assinatura...");
  let pendingRequests = [];
  try {
    const response = await fetch(pendingEndpoint, {
      method: "GET", // Requisição HTTP GET
      headers: {
        "x-signer-auth-credential": authHeaderBase64, // Prova de posse efêmera da chave privada do emissor
        "Authorization": `Bearer ${bearerToken}`, // Token M2M autenticando o emissor
        "Content-Type": "application/json",
      },
    });

    // Tratamento de falhas de resposta da plataforma
    if (!response.ok) {
      console.error(`❌ [ERRO] Falha ao buscar credenciais pendentes (HTTP ${response.status}).`);
      process.exit(1);
    }

    pendingRequests = await response.json(); // Lista completa de credenciais pendentes
  } catch (err) {
    console.error("\n❌ [ERRO DE CONEXÃO AO BUSCAR PENDÊNCIAS]:", err.message);
    process.exit(1);
  }
  const batchRequests = pendingRequests.filter(r => r.batchId); // Filtra apenas as credenciais vinculadas a um lote

  // Tratamento de estado vazio (Empty State)
  if (batchRequests.length === 0) {
    console.log("ℹ️  Nenhum lote pendente de assinatura encontrado na plataforma.");
    process.exit(0); // GUIA MOBILE: Renderizar estado vazio na tela ("Nenhum lote aguardando assinatura")
  }

  // 5. Agrupamento das Credenciais Pendentes por 'batchId'
  // GUIA MOBILE: Permite listar na interface cada Lote como um Card com o número de credenciais prontas para assinar
  const batches = {};
  batchRequests.forEach(req => {
    if (!batches[req.batchId]) batches[req.batchId] = [];
    batches[req.batchId].push(req); // Agrupa as credenciais sob o mesmo identificador de lote
  });

  // Seleciona o lote específico solicitado ou o primeiro lote disponível da lista
  const batchToSign = targetBatchId || Object.keys(batches)[0];
  const reqsToSign = batches[batchToSign]; // Array com todas as credenciais do lote selecionado

  if (!reqsToSign) {
    console.error(`❌ Lote ${batchToSign} não encontrado ou sem credenciais pendentes.`);
    process.exit(1);
  }

  console.log(`\n=================================================`);
  console.log(`✍️  ASSINANDO LOTE: ${batchToSign} (${reqsToSign.length} credenciais)`);
  console.log(`=================================================\n`);

  // Carrega ou inicializa a fila de armazenamento offline do dispositivo móvel
  let offlineStorage = [];
  if (fs.existsSync(offlineStoragePath)) {
    try {
      offlineStorage = JSON.parse(fs.readFileSync(offlineStoragePath, "utf-8"));
    } catch (_) {
      offlineStorage = [];
    }
  }

  // 6. Loop de Assinatura Local e Geração de PDF no Dispositivo Móvel
  // GUIA MOBILE: Este processamento é 100% on-device (offline). O app não envia a chave privada para o servidor.
  for (let i = 0; i < reqsToSign.length; i++) {
    const req = reqsToSign[i];
    console.log(`⏳ [${i+1}/${reqsToSign.length}] Assinando ID: ${req.requestId}...`);

    const subject = req.unsignedPayload.credentialSubject || {}; // Dados do titular e atributos da credencial
    const recipientDid = subject.id || "unknown"; // DID do titular destinatário
    const credentialData = { ...subject };
    delete credentialData.id; // Remove o ID do subject para não duplicar como atributo solto na interface e no PDF

    // Extração recursiva de todos os atributos e formatação de rótulos (labels) amigáveis para o PDF
    const visiblePaths = [];
    const pdfLabels = {};

    function extractPaths(obj, prefix = "") {
      for (const [key, value] of Object.entries(obj)) {
        const pathStr = prefix ? `${prefix}.${key}` : key;
        if (typeof value === "object" && value !== null && !Array.isArray(value)) {
          pdfLabels[pathStr] = key.charAt(0).toUpperCase() + key.slice(1);
          extractPaths(value, pathStr); // Suporte a schemas aninhados
        } else {
          visiblePaths.push(pathStr); // Caminho completo do atributo para divulgação seletiva
          pdfLabels[pathStr] = key.charAt(0).toUpperCase() + key.slice(1); // Rótulo com inicial maiúscula
        }
      }
    }

    extractPaths(credentialData);

    // Criação do schema dinâmico a partir dos atributos da credencial
    const dynamicSchema = core.createSchemaFromAttributes(credentialData, {
      version: "1.0",
      createdAt: new Date().toISOString()
    });

    // Opções de emissão com metadados de validade e identificador
    const issueOptions = {
      credentialId: req.requestId,
      issuedAt: req.createdAt || new Date().toISOString(),
      visiblePaths: visiblePaths.length > 0 ? visiblePaths : Object.keys(credentialData)
    };

    if (req.unsignedPayload.expirationDate) {
      issueOptions.expiresAt = req.unsignedPayload.expirationDate;
      issueOptions.expirationDate = req.unsignedPayload.expirationDate;
    }

    // A) Assinatura Digital Pós-Quântica (ML-DSA-65) com a chave privada do Emissor
    // GUIA MOBILE: Operação criptográfica local executada pelo core compilado nativamente (JNI / FFI)
    const signedVcPayload = core.walletIssueCredentialFromSchema(
      walletPath,
      walletPassword,
      signerDid, // Chave privada ML-DSA do emissor associada ao seu DID
      dynamicSchema,
      credentialData,
      issueOptions
    );

    // B) Geração do documento visual PDF com os atributos e layout formatados
    const pdfBaseBuffer = Buffer.from(
      core.signedCredentialToPdf(signedVcPayload, {
        labels: pdfLabels
      })
    );

    // C) Embutimento da Prova Criptográfica no PDF
    // GUIA MOBILE: Insere a credencial verificável assinada diretamente nos metadados/estrutura do PDF
    const finalPdfBuffer = Buffer.from(
      core.walletEmbedSignedCredentialInPdf(
        walletPath,
        walletPassword,
        signerDid,
        pdfBaseBuffer,
        signedVcPayload
      )
    );

    // D) Cálculo do hash SHA-256 e codificação do PDF em Base64
    const pdfHash = crypto.createHash("sha256").update(finalPdfBuffer).digest("hex");
    const pdfContentBase64 = finalPdfBuffer.toString("base64");

    // E) Montagem do pacote de metadados para envio posterior à plataforma
    const metadata = {
      requestId: req.requestId,
      issuerDid: signerDid,
      recipientDid: recipientDid,
      timestamp: new Date().toISOString(),
      pdfHash: pdfHash,
      schemaId: req.unsignedPayload.credentialSchema?.id || "N/A",
      expirationDate: req.unsignedPayload.expirationDate || null
    };

    const callbackData = {
      requestId: req.requestId,
      metadata: metadata,
      signedPayload: signedVcPayload, // Credencial Verificável assinada com ML-DSA
      encryptedPdfBase64: pdfContentBase64 // PDF gerado com prova embutida
    };

    // Atualiza a fila local (substitui caso já existisse uma versão pendente com o mesmo requestId)
    offlineStorage = offlineStorage.filter((item) => item.requestId !== req.requestId);
    offlineStorage.push(callbackData);
    console.log(`   ✔ Assinada com sucesso com chave ML-DSA e PDF gerado (${finalPdfBuffer.length} bytes).`);
  }

  // 7. Persistência na Fila de Saída Offline do Dispositivo
  // GUIA MOBILE: No app real, salvar estes registros no banco SQLite local ou no cache seguro do app
  fs.writeFileSync(offlineStoragePath, JSON.stringify(offlineStorage, null, 2));

  console.log(`\n=================================================`);
  console.log(`🎉 ASSINATURA DO LOTE CONCLUÍDA NO DISPOSITIVO MÓVEL!`);
  console.log(`   Credenciais armazenadas em: ${offlineStoragePath}`);
  console.log(`=================================================`);

  // 8. Sincronização / Upload dos Arquivos Assinados para a Plataforma Web
  // GUIA MOBILE: Pode ser disparado logo após a assinatura ou por um worker de background quando houver conexão
  if (shouldUpload) {
    console.log(`\n🚀 Opção --upload detectada. Iniciando envio automático para a plataforma...`);
    const uploader = require("./upload-batch-credentials"); // Módulo responsável pelo envio multipart/form-data
    await uploader.main(); // Executa o upload e move o status das credenciais para ACTIVE na plataforma
  } else {
    console.log(`\n👉 PRÓXIMO PASSO: Enviar as credenciais assinadas para a plataforma:`);
    console.log(`   lib/upload-batch-credentials.js --wallet ${walletPath}\n`);
  }
}

// Ponto de entrada para execução via CLI
if (require.main === module) {
  main();
}

module.exports = { main }; // Exporta a função para reaproveitamento em testes automatizados
