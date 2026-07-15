/**
 * Este teste simula o fluxo de plataforma com remetente e
 * destinatário: emite uma credencial grande, gera um PDF com a
 * credencial, usa ML-KEM-768 para encapsular um segredo ao
 * destinatário, cifra o PDF com AES-256-GCM, decifra pela wallet
 * do destinatário e verifica a credencial extraída.
 *
 * Comando para rodar:
 *   npm run build && \
 *   node --test test-node/core/wallet-pdf-mlkem-flow.test.js
 */

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const core = require('../../npm/ssi_pq_core.node');

const outputDir = path.join(__dirname, '..', '..', 'test-output', 'platform-flow');
fs.mkdirSync(outputDir, { recursive: true });

// Utilitário para decodificar a chave pública multibase (base58btc) do DID Document para buffer binário
function decodeBase58Btc(str) {
  if (str[0] !== 'z') throw new Error('Not base58btc multibase');
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let d = 0n;
  let strData = str.slice(1);
  for (let i = 0; i < strData.length; i++) {
    d = d * 58n + BigInt(alphabet.indexOf(strData[i]));
  }
  let hex = d.toString(16);
  if (hex.length % 2 !== 0) hex = '0' + hex;
  const buf = Buffer.from(hex, 'hex');
  let leadingZeros = 0;
  while (strData[leadingZeros] === '1') leadingZeros++;
  return Buffer.concat([Buffer.alloc(leadingZeros), buf]);
}

test('Fluxo Plataforma: Remetente cria PDF, cifra via ML-KEM e AES-GCM, Destinatário decifra e verifica', () => {
  // Configuração das Wallets
  const senderWallet = path.join(outputDir, `sender-${crypto.randomUUID()}.db`);
  const senderPassword = 'senha-remetente-123';
  
  const recipientWallet = path.join(outputDir, `recipient-${crypto.randomUUID()}.db`);
  const recipientPassword = 'senha-destinatario-456';

  console.log('1. Criando as Wallets (Remetente e Destinatário)...');
  core.walletCreate(senderWallet, senderPassword);
  const senderDid = core.walletCreateDid(senderWallet, senderPassword, {
    label: 'Remetente', mldsa: 'ML-DSA-65', mlkem: 'ML-KEM-768'
  });
  const senderDidDocument = core.walletGetDidDocument(senderWallet, senderPassword, senderDid.did);

  core.walletCreate(recipientWallet, recipientPassword);
  const recipientDid = core.walletCreateDid(recipientWallet, recipientPassword, {
    label: 'Destinatário', mldsa: 'ML-DSA-65', mlkem: 'ML-KEM-768'
  });
  // O remetente precisa acessar o documento público do destinatário (simulando a busca na plataforma)
  const recipientDidDocument = core.walletGetDidDocument(recipientWallet, recipientPassword, recipientDid.did);

  console.log('2. Remetente emitindo a Credencial e embutindo no PDF (com 50 atributos adicionais para testar paginação)...');
  
  const credentialData = {
    nome: 'Alice',
    cargo: 'Engenheira'
  };
  // Adicionando mais 50 atributos longos para garantir que o PDF tenha mais de uma página
  for (let i = 1; i <= 50; i++) {
    const num = i.toString().padStart(2, '0');
    credentialData[`certificacao_extra_${num}`] = `Certificado de Proficiência Nível ${num} em Tecnologias Pós-Quânticas e Segurança da Informação`;
  }
  const visiblePaths = Object.keys(credentialData);

  const schema = core.createSchemaFromAttributes(credentialData, { version: '1' });
  const signedCredential = core.walletIssueCredentialFromSchema(
    senderWallet, senderPassword, senderDid.did, schema,
    credentialData,
    { visiblePaths }
  );

  const pdfBase = Buffer.from(core.signedCredentialToPdf(signedCredential));
  const finalPdf = Buffer.from(
    core.walletEmbedSignedCredentialInPdf(senderWallet, senderPassword, senderDid.did, pdfBase, signedCredential)
  );
  // Verificação de segurança: PDF normal pode ser lido (começa com marcador PDF padrão)
  assert.equal(finalPdf.subarray(0, 5).toString(), '%PDF-');

  console.log('3. Remetente encapsulando segredo (ML-KEM) usando a chave pública do Destinatário...');
  // Pega a chave pública de encapsulamento ML-KEM-768 do destinatário
  const mlkemKey = recipientDidDocument.keys.find(k => k.type === 'ML-KEM-768');
  const recipientPubKeyBytes = decodeBase58Btc(mlkemKey.public_key_multibase);
  const recipientPubKeyBase64url = core.base64urlEncode(recipientPubKeyBytes);

  // O Motor N-API do Rust faz o encapsulamento KEM e devolve o ciphertext público e o segredo de 32 bytes
  const encapsulation = core.mlkemEncapsulate('ML-KEM-768', recipientPubKeyBase64url);
  const sharedSecretSender = core.base64urlDecode(encapsulation.sharedSecret);

  console.log('4. Remetente cifrando o PDF usando AES-256-GCM e gravando em disco...');
  // Com o segredo na mão, usamos a API Rust para cifrar o PDF volumoso
  const encrypted = core.aes256GcmEncrypt(sharedSecretSender, finalPdf);
  const encryptedPdf = Buffer.from(encrypted.ciphertext);
  const iv = Buffer.from(encrypted.nonce);
  const authTag = Buffer.from(encrypted.authTag);

  const encryptedPdfPath = path.join(outputDir, 'credencial-cifrada.pdf.enc');
  fs.writeFileSync(encryptedPdfPath, encryptedPdf);
  console.log(`   [Arquivo] PDF Cifrado salvo em: ${encryptedPdfPath}\n`);

  // Comprova que o arquivo gravado é ruído ininteligível (não começa com o marcador PDF)
  const diskEncryptedBytes = fs.readFileSync(encryptedPdfPath);
  assert.notEqual(diskEncryptedBytes.subarray(0, 5).toString(), '%PDF-');

  console.log('5. Destinatário abre sua Wallet para decapsular o segredo ML-KEM enviado na plataforma...');
  // Destinatário usa a sua Wallet segura e a chave privada do banco para extrair o segredo através do ciphertext recebido
  const recoveredSecretBase64url = core.walletMlkemDecapsulate(
    recipientWallet, recipientPassword, recipientDid.did, encapsulation.ciphertext
  );
  const sharedSecretRecipient = core.base64urlDecode(recoveredSecretBase64url);

  // Assegura que ambos chegaram ao MESMO segredo de 32 bytes em lados opostos!
  assert.deepEqual(sharedSecretSender, sharedSecretRecipient);

  console.log('6. Destinatário decifrando o arquivo PDF AES-256-GCM e verificando a credencial...');
  const decryptedPdf = Buffer.from(
    core.aes256GcmDecrypt(sharedSecretRecipient, diskEncryptedBytes, iv, authTag)
  );

  const decryptedPdfPath = path.join(outputDir, 'credencial-decifrada.pdf');
  fs.writeFileSync(decryptedPdfPath, decryptedPdf);
  console.log(`   [Arquivo] PDF Decifrado salvo em: ${decryptedPdfPath}\n`);

  const verification = core.verifySignedCredentialPdf(decryptedPdf, senderDidDocument);
  console.log(`   Válida? ${verification.valid ? 'SIM (Aberto, decifrado e validado com sucesso!)' : 'NÃO'}`);
  console.log(`   Status: ${verification.status}`);

  assert.equal(verification.valid, true);

  console.log('7. Extraindo a credencial do PDF decifrado para formato JSON...');
  const extractedManifest = core.extractCredentialManifestFromPdf(decryptedPdf);
  const extractedCredential = extractedManifest.signed_credential;
  const extractedDisclosures = extractedCredential.attribute_disclosures;

  assert.equal(extractedCredential.type, 'ssi_signed_credential_v2');
  assert.equal(extractedDisclosures.length, visiblePaths.length);
  assert.equal(extractedCredential.attribute_multiproof.alg, 'Merkle-SHA3-256-Multiproof-V1');
  assert.equal(extractedCredential.attribute_multiproof.leaf_count, visiblePaths.length);
  assert.equal(extractedCredential.attribute_multiproof.proof_nodes.length, 0);
  assert.equal(
    extractedDisclosures.every(
      (disclosure) => disclosure.proof === undefined && disclosure.leaf_hash === undefined
    ),
    true
  );

  const manifestPath = path.join(outputDir, 'credencial-decifrada-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(extractedManifest, null, 2));
  console.log(`   [Arquivo] Manifesto JSON extraído salvo em: ${manifestPath}\n`);

  assert.equal(fs.existsSync(manifestPath), true);
});
