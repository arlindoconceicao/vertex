#!/usr/bin/env node
/**
 * Script de Simulação do Aplicativo Móvel: Consulta de Credenciais Oferecidas em Lote
 *
 * GUIA DE IMPLEMENTAÇÃO MOBILE:
 * Este script serve como especificação funcional e de referência para desenvolvedores
 * mobile (iOS / Android / Flutter / React Native) implementarem a tela de "Novas Ofertas de Credenciais".
 *
 * Ele simula a consulta periódica (polling ou disparo pós-notificação Push) à rota:
 *   GET /api/signer/requests/offered
 *
 * A autenticação utiliza dois fatores criptográficos (M2M + Proof-of-Possession PQC):
 *   1. Header 'Authorization': Bearer HMAC-SHA256(SIGNER_SECRET, titularDid)
 *   2. Header 'x-signer-auth-credential': Credencial efêmera assinada localmente com a chave
 *      privada pós-quântica ML-DSA-65 do titular (Base64).
 *
 * NOTA DE ARQUITETURA MOBILE:
 * No app móvel, todas as chaves privadas e informações sensíveis da carteira ficam
 * armazenadas diretamente dentro do banco SQLite cifrado (SQLCipher). Não é utilizado
 * o Android Keystore; a proteção criptográfica é provida integralmente pelo próprio
 * SQLite cifrado (SQLCipher). Para testes locais, qualquer banco SQLite pode ser
 * passado via --wallet (ex: lib/issuer_wallet.db, lib/holder_wallet.db, etc.).
 *
 * Uso CLI:
 *   lib/get-batch-credentials.js --wallet lib/issuer_wallet.db
 *   lib/get-batch-credentials.js --wallet lib/holder_wallet.db
 *   lib/get-batch-credentials.js (detecta automaticamente a carteira disponível)
 */

require("dotenv").config(); // Carrega variáveis de ambiente locais do arquivo .env

const fs = require("fs"); // No mobile nativo: usar APIs de I/O de arquivos locais protegidos do SO
const path = require("path"); // Manipulação de diretórios e nomes de arquivo
const crypto = require("crypto"); // No mobile nativo: usar biblioteca padrão de criptografia (ex: CommonCrypto no iOS, javax.crypto no Android)
const core = require("./ssi_pq_core.node"); // No mobile nativo: biblioteca em C++/Rust com algoritmos pós-quânticos compilada via JNI/FFI

async function main() {
  // GUIA MOBILE - Configuração do Endpoint:
  // No app móvel, a URL base da API deve vir de configuração de ambiente (build variants / flavors / remote config)
  const endpoint = process.env.NEXT_PUBLIC_APP_URL
      ? `${process.env.NEXT_PUBLIC_APP_URL}/api/signer/requests/offered`
      : "http://localhost:3000/api/signer/requests/offered"; // Endpoint GET para listar ofertas pendentes

  // GUIA MOBILE - Segredo Compartilhado M2M:
  // No app real, esta chave ou segredo é provisionado durante o pareamento/onboarding seguro do dispositivo
  const secretsStr = process.env.SIGNER_SECRETS || process.env.SIGNER_SECRET;
  const signerSecret = secretsStr ? secretsStr.split(',')[0].trim() : "mobile-signer-secret-token"; // Chave secreta para cálculo do HMAC

  // 1. Localização da Carteira e Chaves Locais
  // GUIA MOBILE: No smartphone, todas as chaves privadas e credenciais ficam persistidas diretamente
  // dentro do banco SQLite cifrado (SQLCipher), sem utilização do Android Keystore. A proteção e o sigilo
  // dos dados são providos integralmente pela cifra da base SQLite (SQLCipher).
  const walletArgIdx = process.argv.indexOf("--wallet");
  const customWallet = walletArgIdx !== -1 ? process.argv[walletArgIdx + 1] : process.env.WALLET_PATH;
  let walletPath = "";
  if (customWallet) {
    walletPath = path.resolve(customWallet); // Permite indicar explicitamente qualquer arquivo de carteira
  } else if (fs.existsSync(path.join(__dirname, "holder_wallet.db"))) {
    walletPath = path.join(__dirname, "holder_wallet.db"); // Carteira padrão do titular (se existir)
  } else if (fs.existsSync(path.join(__dirname, "issuer_wallet.db"))) {
    walletPath = path.join(__dirname, "issuer_wallet.db"); // Carteira do emissor (útil para testes onde a mesma conta emite e recebe)
  } else {
    walletPath = path.join(__dirname, "mobile_wallet.db"); // Carteira móvel padrão
  }

  const keysArgIdx = process.argv.indexOf("--keys");
  const customKeys = keysArgIdx !== -1 ? process.argv[keysArgIdx + 1] : process.env.KEYS_PATH;
  let keysFilePath = "";
  if (customKeys) {
    keysFilePath = path.resolve(customKeys); // Caminho customizado informado via parâmetro
  } else {
    // Busca arquivo de chave correspondente ao nome da carteira (ex: issuer_wallet.keys.txt)
    const baseName = path.basename(walletPath, path.extname(walletPath));
    const candidateKeys = path.join(path.dirname(walletPath), `${baseName}.keys.txt`);
    if (fs.existsSync(candidateKeys)) {
      keysFilePath = candidateKeys; // Utiliza a chave associada à carteira escolhida
    } else {
      keysFilePath = path.join(__dirname, "keys.txt"); // Fallback para arquivo padrão de chaves
    }
  }

  // Validação: Garante que o banco de dados e a chave de descriptografia existem antes de prosseguir
  if (!fs.existsSync(keysFilePath) || !fs.existsSync(walletPath)) {
    console.error(`\n❌ [ERRO] Banco SQLite da wallet (${walletPath}) ou arquivo de chaves não encontrados.`);
    console.error(`👉 Para inicializar esta carteira com o DID do app, execute primeiro o pareamento:`);
    console.error(`   lib/complete-pairing.js '<PAYLOAD_JSON_DA_WEB>' --wallet ${walletPath}\n`);
    process.exit(1); // Encerra caso a carteira não tenha sido criada/pareada previamente
  }

  const walletPassword = fs.readFileSync(keysFilePath, "utf-8").trim(); // Lê a senha para decifrar a carteira local

  // 2. Abertura da Wallet e Obtenção do DID do Usuário Logado
  // GUIA MOBILE: No app, o DID ativo geralmente é mantido no estado global da sessão do usuário autenticado.
  let registeredDids = [];
  try {
    core.walletOpen(walletPath, walletPassword); // Abre a base SQLite e descriptografa as tabelas internas
    registeredDids = core.walletListDids(walletPath, walletPassword) || []; // Lista todos os DIDs contidos na carteira
  } catch (err) {
    console.error("\n❌ [ERRO] Falha ao abrir a wallet SQLite:", err.message); // Notifica caso a senha ou arquivo estejam corrompidos
    process.exit(1);
  }

  if (registeredDids.length === 0) {
    console.error("\n❌ [ERRO] Nenhuma identidade DID encontrada na wallet móvel.");
    process.exit(1); // Aborta se a carteira não contiver nenhuma identidade
  }

  // Suporte a seleção de DID específico (útil se o app suportar múltiplas identidades/personas)
  const didArgIdx = process.argv.indexOf("--did");
  const requestedDid = didArgIdx !== -1 ? process.argv[didArgIdx + 1] : null;

  let activeDidData = null;
  if (requestedDid) {
    activeDidData = registeredDids.find((d) => d.did === requestedDid); // Localiza o DID explicitamente solicitado
    if (!activeDidData) {
      console.error(`\n❌ [ERRO] O DID especificado (${requestedDid}) não existe nesta carteira.`);
      console.log(`   DIDs disponíveis:`);
      registeredDids.forEach((d) => console.log(`   - ${d.did}`));
      process.exit(1);
    }
  } else {
    activeDidData = registeredDids[registeredDids.length - 1]; // Por padrão, seleciona a identidade mais recente (ativa no app)
  }

  const signerDid = activeDidData.did; // DID do titular que assinará a requisição de busca

  // 3. Montagem dos Cabeçalhos Criptográficos de Autenticação (PoP + M2M)
  // GUIA MOBILE: Esta etapa é essencial para segurança Zero Trust. A API só retorna credenciais se o app provar
  // matematicamente que possui a chave privada ML-DSA-65 correspondente ao DID do titular.
  const timestamp = new Date().toISOString(); // Timestamp em padrão UTC ISO-8601
  
  // Objeto de claims da credencial efêmera de autorização
  const authCredentialData = {
    action: "offered_requests_auth", // Ação autorizada para este endpoint específico
    timestamp: timestamp // O servidor rejeita requisições com diferença superior a 2 minutos para evitar Replay
  };

  // Criação do schema interno temporário para a credencial efêmera
  const schema = core.createSchemaFromAttributes(authCredentialData, {
    version: '1.0',
    createdAt: timestamp
  });

  // Emissão e assinatura da prova criptográfica pós-quântica (PoP) com a chave privada ML-DSA-65 do titular
  const signedAuthCredential = core.walletIssueCredentialFromSchema(
    walletPath,
    walletPassword,
    signerDid, // Assina com o DID do titular do app móvel
    schema,
    authCredentialData,
    { credentialId: `auth-${Date.now()}`, issuedAt: timestamp, visiblePaths: ['action', 'timestamp'] }
  );

  // Serializa a credencial assinada em JSON e codifica em Base64 para envio no Header HTTP
  const authHeaderBase64 = Buffer.from(JSON.stringify(signedAuthCredential)).toString('base64');
  
  // Gera o token de autorização Bearer via HMAC-SHA256 (segredo compartilhado + DID do usuário)
  const bearerToken = crypto.createHmac("sha256", signerSecret).update(signerDid).digest("hex");

  console.log("=================================================");
  console.log("📱 SIMULADOR MOBILE - CONSULTA DE LOTES OFERECIDOS");
  console.log("=================================================");
  console.log(`💾 Wallet DB          : ${walletPath}`);
  console.log(`👤 Titular (Holder DID): ${signerDid}`);
  console.log(`📡 Endpoint           : ${endpoint}`);

  try {
    // 4. Chamada HTTP GET para a Plataforma
    // GUIA MOBILE: No app móvel (ex: useEffect/onInit ou via Background Fetch), execute esta requisição:
    const response = await fetch(endpoint, {
      method: "GET", // Método HTTP GET
      headers: {
        "x-signer-auth-credential": authHeaderBase64, // Prova de posse efêmera da chave pós-quântica do titular
        "Authorization": `Bearer ${bearerToken}`, // Token M2M autenticando a identidade do titular
        "Content-Type": "application/json",
      },
    });

    // Tratamento de respostas de erro da API
    if (!response.ok) {
      const errBody = await response.text();
      // GUIA MOBILE: Códigos de retorno esperados:
      // - 401 Unauthorized: Chave/HMAC incorreto, assinatura inválida ou relógio do celular dessincronizado (> 2 min)
      // - 500 Internal Error: Falha no servidor ou indisponibilidade do banco
      console.error(`\n❌ [ERRO] Falha na resposta da plataforma (HTTP ${response.status}): ${errBody}`);
      process.exit(1);
    }

    // Decodifica a lista de credenciais oferecidas retornadas pelo backend
    const offeredRequests = await response.json();

    // 5. Filtro de Segurança do Lado do Cliente (Client-Side Assertion)
    // GUIA MOBILE: Confirma que cada credencial ofertada realmente pertence ao DID do usuário ativo no dispositivo
    const userOffers = offeredRequests.filter((req) => {
      const targetHolderDid = req.unsignedPayload?.credentialSubject?.id || req.holder?.did;
      return targetHolderDid === signerDid; // Ignora qualquer registro que não seja destinado a este titular
    });

    // 6. Agrupamento em Lotes para Exibição na Interface do App
    // GUIA MOBILE: Na interface do app, agrupar por 'batchId' permite mostrar um único Card de "Lote de Credenciais"
    // com um botão "Aceitar Todas (Lote)" ou permitir ao usuário expandir e inspecionar cada credencial individualmente.
    const batches = {}; // Armazena lotes indexados por batchId: { [batchId]: [cred1, cred2, ...] }
    let individualCount = 0; // Contador de credenciais individuais (sem batchId)

    userOffers.forEach((req) => {
      if (req.batchId) {
        if (!batches[req.batchId]) batches[req.batchId] = [];
        batches[req.batchId].push(req); // Agrupa credencial no lote correspondente
      } else {
        individualCount++; // Credencial avulsa
      }
    });

    console.log("\n=================================================");
    console.log(`✅ Lotes Oferecidos para este DID: ${Object.keys(batches).length}`);
    console.log(`📄 Total de Credenciais do Usuário : ${userOffers.length} (${individualCount} individuais)`);
    console.log("=================================================");

    // Se não houver ofertas pendentes para este titular
    if (userOffers.length === 0) {
      console.log(`\nℹ️  Nenhuma credencial oferecida encontrada para o DID deste usuário (${signerDid}).`);
      // GUIA MOBILE: Renderizar estado vazio na tela (Empty State: "Você não possui novas credenciais pendentes")
      return;
    }

    // 7. Exibição Detalhada dos Lotes e Atributos das Credenciais
    // GUIA MOBILE: Exibir na tela do app as informações de cada lote para o consentimento do titular
    for (const [batchId, creds] of Object.entries(batches)) {
      console.log(`\n📋 [Lote: ${batchId}] - ${creds.length} credencial(is) para o Titular`);
      
      creds.forEach((cred, idx) => {
        console.log(`\n   📄 Credencial [${idx + 1}/${creds.length}] (ID: ${cred.requestId})`);
        console.log(`      Emissor (Issuer) : ${cred.issuer?.name || "Desconhecido"} (${cred.issuer?.did})`);
        console.log(`      Titular (Holder) : ${cred.unsignedPayload.credentialSubject.id}`);
        console.log(`      Payload dos Atributos:`);
        console.log(JSON.stringify(cred.unsignedPayload, null, 2));
      });

      // GUIA MOBILE - Próximo Passo do Fluxo de Aceite:
      // Quando o usuário tocar em "Aceitar Lote" no app móvel:
      // Chamar: POST /api/signer/requests/offered/batch-accept com { batchId: "${batchId}" } ou lista de requestIds.
      // (Consulte o script de referência: lib/holder-accept-offer.js --batch)
    }
  } catch (err) {
    // GUIA MOBILE: Tratar falta de conexão com a internet ou erro de timeout da rede
    console.error("\n❌ [ERRO DE CONEXÃO]:", err.message);
    process.exit(1);
  }
}

main(); // Executa o fluxo principal assíncrono do script


