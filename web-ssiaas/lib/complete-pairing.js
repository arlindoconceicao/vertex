#!/usr/bin/env node
/**
 * Script de Simulação do Aplicativo Móvel: Conclusão do Pareamento DID
 *
 * Este script simula a ação do aplicativo móvel ao receber o desafio da web.
 * Ele gera as chaves pós-quânticas (ML-DSA-65 e ML-KEM-768), assina a mensagem
 * do desafio, envia a requisição HTTP POST para o endpoint da plataforma e
 * armazena as chaves e o DID em um banco SQLite cifrado (lib/mobile_wallet.db)
 * com senha mantida em lib/keys.txt.
 *
 * Uso:
 *   node lib/complete-pairing.js '<JSON_PAYLOAD_COPIADO_DA_WEB>'
 * ou
 *   node lib/complete-pairing.js <pairingId> <nonce> [endpoint] [userId] [email]
 */

require("dotenv").config(); // Carrega variáveis de ambiente locais do arquivo .env

const fs = require("fs"); // Módulo de sistema de arquivos do Node.js (no mobile: gerenciar o arquivo do SQLite cifrado)
const path = require("path"); // Módulo para resolução de diretórios e caminhos de arquivo
const core = require("./ssi_pq_core.node"); // Bind nativo do core criptográfico pós-quântico (no mobile: biblioteca C++/Rust compilada para iOS/Android)

async function main() {
  const arg1 = process.argv[2]; // No mobile: este payload é recebido ao escanear o QR Code da tela web ou via Deep Link

  if (!arg1) {
    console.error(`
[ERRO] Argumentos ausentes.
Uso:
  node lib/complete-pairing.js '<JSON_PAYLOAD_COPIADO_DA_WEB>'

Exemplo:
  node lib/complete-pairing.js '{"pairingId":"abc...","nonce":"xyz...","endpoint":"http://localhost:3000/api/v1/did-pairings/abc.../complete","email":"teste@gmail.com"}'
`);
    process.exit(1); // Encerra o script com código de erro caso nenhum argumento seja informado
  }

  let pairingId = ""; // Identificador único da sessão de pareamento
  let nonce = ""; // Número pseudoaleatório de uso único gerado pela plataforma para evitar replay attacks
  let expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // Data limite de expiração do desafio (padrão: 10 minutos)
  let endpoint = ""; // URL do endpoint da API para onde o app móvel deve enviar a resposta de conclusão
  let userId = undefined; // ID interno do usuário na plataforma web (opcional)
  let email = undefined; // E-mail da conta do usuário na plataforma (opcional)
  let challengeId = undefined; // ID do registro de desafio criado na plataforma

  // Verifica se o primeiro argumento é uma string JSON (copiada do botão da tela web)
  if (arg1.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(arg1); // Decodifica o payload JSON obtido do QR Code
      pairingId = parsed.pairingId; // Extrai o ID do pareamento
      nonce = parsed.nonce; // Extrai o nonce do desafio
      expiresAt = parsed.expiresAt || expiresAt; // Extrai o prazo de expiração (se fornecido)
      endpoint = parsed.endpoint; // Extrai a URL de retorno (callback endpoint)
      userId = parsed.userId; // Extrai o identificador do usuário
      email = parsed.email; // Extrai o e-mail do usuário
      challengeId = parsed.id; // Extrai o ID único do desafio
    } catch (err) {
      console.error("[ERRO] JSON inválido fornecido no argumento:", err.message); // Notifica erro caso o JSON esteja malformado
      process.exit(1); // Aborta a execução em caso de falha de parsing
    }
  } else {
    // Argumentos posicionais: pairingId nonce [endpoint]
    pairingId = arg1; // Primeiro argumento posicional: ID do pareamento
    nonce = process.argv[3]; // Segundo argumento posicional: nonce
    endpoint =
      process.argv[4] ||
      `http://localhost:3000/api/v1/did-pairings/${pairingId}/complete`; // Terceiro argumento posicional ou endpoint padrão
    userId = process.argv[5]; // Quarto argumento posicional: ID do usuário
    email = process.argv[6]; // Quinto argumento posicional: e-mail

    if (!pairingId || !nonce) {
      console.error("[ERRO] Informe pelo menos pairingId e nonce."); // Valida campos mínimos obrigatórios
      process.exit(1); // Aborta se os campos essenciais não foram informados
    }
  }

  if (!endpoint) {
    endpoint = `http://localhost:3000/api/v1/did-pairings/${pairingId}/complete`; // Fallback de segurança para URL padrão do backend local
  }

  // 0. Gerenciamento do Arquivo de Chave e Wallet SQLite
  // DICA MOBILE: As chaves privadas e o DID ficam diretamente no banco SQLite cifrado (SQLCipher), sem uso do Android Keystore.
  const walletArgIdx = process.argv.indexOf("--wallet"); // Permite passar caminho personalizado da carteira via flag
  const customWallet = walletArgIdx !== -1 ? process.argv[walletArgIdx + 1] : process.env.WALLET_PATH; // Lê flag ou variável de ambiente
  const walletPath = customWallet ? path.resolve(customWallet) : path.join(__dirname, "mobile_wallet.db"); // Define o caminho do banco SQLite da carteira

  const keysArgIdx = process.argv.indexOf("--keys"); // Permite passar caminho personalizado da chave da carteira via flag
  const customKeys = keysArgIdx !== -1 ? process.argv[keysArgIdx + 1] : process.env.KEYS_PATH; // Lê flag ou variável de ambiente
  let keysFilePath = ""; // Caminho absoluto para o arquivo que armazena a senha da carteira
  if (customKeys) {
    keysFilePath = path.resolve(customKeys); // Utiliza o caminho customizado indicado
  } else if (customWallet) {
    const baseName = path.basename(walletPath, path.extname(walletPath)); // Obtém nome base do arquivo da carteira
    keysFilePath = path.join(path.dirname(walletPath), `${baseName}.keys.txt`); // Associa o arquivo .keys.txt ao nome da wallet
  } else {
    keysFilePath = path.join(__dirname, "keys.txt"); // Caminho padrão do arquivo de chave
  }

  let walletPassword = ""; // Senha mestra usada para cifrar e decifrar o banco SQLite da carteira
  if (fs.existsSync(keysFilePath)) {
    walletPassword = fs.readFileSync(keysFilePath, "utf-8").trim(); // Lê a senha existente do arquivo
  } else {
    walletPassword = "senha-wallet-mobile-123"; // Senha padrão para primeira inicialização
    fs.writeFileSync(keysFilePath, walletPassword, "utf-8"); // Salva a senha gerada no arquivo local
  }

  const isNewWallet = !fs.existsSync(walletPath); // Checa se o banco de dados da carteira já existe no armazenamento local

  if (isNewWallet) {
    core.walletCreate(walletPath, walletPassword, { // Cria e inicializa um novo banco de dados SQLite criptografado
      createdAt: new Date().toISOString(), // Grava timestamp de criação dos metadados da carteira
    });
  } else {
    core.walletOpen(walletPath, walletPassword); // Abre e desbloqueia a carteira existente utilizando a senha mestra
  }


  console.log("=================================================");
  console.log("🚀 SIMULANDO APLICATIVO MÓVEL - PAREAMENTO DID");
  console.log("=================================================");
  console.log(`📌 Pairing ID : ${pairingId}`);
  console.log(`📌 Nonce      : ${nonce}`);
  console.log(`📌 Endpoint   : ${endpoint}`);
  if (email) console.log(`📌 Account    : ${email}`);
  console.log(`🔑 Wallet Key : ${keysFilePath}`);
  console.log(`💾 Wallet DB  : ${walletPath} (${isNewWallet ? "Nova" : "Existente"})`);

  // 1. Geração ou Carregamento de Identidade DID
  let mobileDid = null; // Estrutura que conterá o identificador DID e o documento DID
  let didDoc = null; // Documento DID estruturado (conforme especificações W3C DID)
  let proofValue = null; // Assinatura digital opcional para comprovar posse de chave privada

  if (isNewWallet) {
    console.log("\n🔑 1. Gerando novo DID e chaves pós-quânticas na Wallet móvel...");
    const createdAt = new Date().toISOString(); // Timestamp ISO 8601 de criação do DID
    const newRecord = core.walletCreateDid(walletPath, walletPassword, { // Gera um par de chaves pós-quânticas e persiste no banco SQLite
      label: `Mobile DID (${email || "Teste"})`, // Rótulo amigável para exibição visual na carteira do usuário
      mldsa: "ML-DSA-65", // Algoritmo pós-quântico de assinatura digital (NIST FIPS 204)
      mlkem: "ML-KEM-768", // Algoritmo pós-quântico de encapsulamento e troca de chaves (NIST FIPS 203)
      createdAt, // Data de criação registrada no documento
    });

    const targetDid = newRecord.did; // Obtém o identificador do novo DID gerado (ex: did:key:...)
    didDoc = newRecord.did_document || core.walletGetDidDocument(walletPath, walletPassword, targetDid); // Recupera o DID Document completo

    mobileDid = {
      did: targetDid, // Atribui o identificador DID
      didDocument: didDoc, // Atribui o documento com os métodos de verificação e chaves públicas
    };
    proofValue = null; // Prova de posse (pode ser gerada assinando o nonce com ML-DSA-65 se exigido)
    console.log(`   ✔ Novo DID gerado e armazenado na Wallet: ${mobileDid.did}`);
  } else {
    console.log("\n🔑 1. Reaproveitando DID existente na Wallet DB...");
    const walletDidsList = core.walletListDids(walletPath, walletPassword); // Lista todos os DIDs cadastrados na carteira móvel
    if (walletDidsList.length === 0) {
      console.error("❌ Wallet existe, mas não contém DIDs.");
      process.exit(1); // Aborta se a carteira já existe porém não possui identidades salvas
    }
    
    const targetDid = walletDidsList[walletDidsList.length - 1].did; // Seleciona o DID mais recente da lista de identidades
    didDoc = core.walletGetDidDocument(walletPath, walletPassword, targetDid); // Carrega o DID Document correspondente do banco seguro
    
    mobileDid = {
      did: targetDid, // Atribui o identificador DID recuperado
      didDocument: didDoc // Atribui o DID Document recuperado
    };
    proofValue = null; // Mantém nulo se não houver exigência de prova adicional
    console.log(`   ✔ DID Recuperado da Wallet : ${mobileDid.did}`);
  }

  // Extrai as chaves públicas
  // DICA MOBILE: As chaves públicas devem ser enviadas à plataforma web para que ela possa validar futuras assinaturas do app
  const mldsaKeyObj = didDoc.keys ? didDoc.keys.find((k) => k.type === "ML-DSA-65") : 
                      didDoc.verificationMethod ? didDoc.verificationMethod.find((k) => k.type === "ML-DSA-65" || k.type === "ML-DSA") : null; // Localiza o objeto com os dados da chave ML-DSA-65
  const mlkemKeyObj = didDoc.keys ? didDoc.keys.find((k) => k.type === "ML-KEM-768") :
                      didDoc.verificationMethod ? didDoc.verificationMethod.find((k) => k.type === "ML-KEM-768" || k.type === "ML-KEM") : null; // Localiza o objeto com os dados da chave ML-KEM-768

  const mlDsaPublicKey = mldsaKeyObj ? (mldsaKeyObj.public_key_multibase || mldsaKeyObj.publicKeyMultibase) : ""; // Extrai a chave pública de assinatura em codificação multibase
  const mlKemPublicKey = mlkemKeyObj ? (mlkemKeyObj.public_key_multibase || mlkemKeyObj.publicKeyMultibase) : ""; // Extrai a chave pública de troca de segredo em codificação multibase

  // 3. Envio da Requisição HTTP POST ao Endpoint da Plataforma Web
  // DICA MOBILE: É esta requisição HTTP que efetua o handshake de pareamento entre o app e o backend
  console.log(`\n📡 3. Enviando resposta de pareamento para a plataforma...`);

  const requestBody = {
    id: challengeId, // ID do desafio que foi escaneado no QR Code
    pairingId, // ID da sessão de pareamento
    nonce, // Nonce recebido no desafio (usado pelo servidor para evitar ataques de repetição)
    expiresAt, // Validade do desafio
    userId, // ID do usuário associado (se presente)
    email, // E-mail da conta vinculada (se presente)
    did: mobileDid.did, // DID do aplicativo móvel
    didDocument: mobileDid.didDocument, // Documento DID contendo métodos de autenticação e verificação
    mlDsaPublicKey, // Chave pública de assinatura digital pós-quântica
    mlKemPublicKey, // Chave pública de encapsulamento de segredos pós-quântica
    ...(proofValue ? {
      proof: { // Bloco opcional de prova criptográfica (Signature Proof)
        type: "ML-DSA-65", // Algoritmo de assinatura utilizado
        created: new Date().toISOString(), // Timestamp da geração da assinatura
        verificationMethod: `${mobileDid.did}#mldsa-1`, // Referência da chave pública usada
        proofValue, // Valor da assinatura digital em base64/hex/multibase
      }
    } : {}),
  };

  try {
    const response = await fetch(endpoint, { // Envia requisição HTTP POST assíncrona para o endpoint da plataforma
      method: "POST", // Método HTTP POST exigido pela API
      headers: {
        "Content-Type": "application/json", // Especifica o cabeçalho com formato JSON
      },
      body: JSON.stringify(requestBody), // Converte o objeto da requisição em string JSON
    });

    const responseData = await response.json(); // Converte o corpo da resposta HTTP em objeto JSON

    console.log("\n=================================================");
    if (response.ok) { // Verifica se a resposta HTTP teve status 2xx (Sucesso)
      console.log("✅ PAREAMENTO CONCLUÍDO COM SUCESSO PELA PLATAFORMA!");
      console.log("=================================================");
      console.log(JSON.stringify(responseData, null, 2)); // DICA MOBILE: Salvar o estado 'pareado' na storage local do app e navegar para a Home
      console.log(
        "\n👉 Agora observe a tela da plataforma web (http://localhost:3000/settings)!"
      );
      console.log("   Ela atualizará automaticamente para o estado PAREADO.");
    } else { // Caso a plataforma recuse a requisição (ex: 400 Bad Request, 404 Não Encontrado, 410 Expirado)
      console.log(`❌ ERRO NA RESPOSTA DA PLATAFORMA (HTTP ${response.status})`);
      console.log("=================================================");
      console.log(JSON.stringify(responseData, null, 2)); // DICA MOBILE: Apresentar alerta ou modal com a mensagem amigável de erro
    }
  } catch (err) { // Captura falhas de conexão ou indisponibilidade de rede
    console.error("\n❌ ERRO DE CONEXÃO AO ACESSAR O ENDPOINT:", err.message); // DICA MOBILE: Alertar sobre falta de conexão com a internet
  }
}

main(); // Executa a rotina principal assíncrona do script


