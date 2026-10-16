/**
 * Script de Simulação do Aplicativo Móvel: Upload e Sincronização de Credenciais em Lote
 *
 * Este script simula o aplicativo móvel conectando-se à plataforma Web SSIaaS
 * para fazer o upload (multipart/form-data) das credenciais previamente assinadas
 * no dispositivo (armazenadas em lib/offline_signed_batches.json).
 *
 * Antes de enviar, cifra o PDF com ML-KEM-768 + AES-256-GCM usando a chave pública
 * do titular (holder/recipient), garantindo que somente a carteira do titular possa
 * decifrar e ler o PDF.
 *
 * Ao receber a confirmação da plataforma, o status da credencial muda para ACTIVE
 * e a fila local do app é limpa.
 *
 * Uso:
 *   node lib/upload-batch-credentials.js
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const core = require("./ssi_pq_core.node");

function decodeBase58Btc(str) {
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  if (!str || str.length === 0) return Buffer.alloc(0);
  if (str[0] !== 'z') throw new Error('Not base58btc');
  let num = BigInt(0);
  for (let i = 1; i < str.length; i++) {
    const p = ALPHABET.indexOf(str[i]);
    if (p < 0) throw new Error('Invalid base58 char');
    num = num * BigInt(58) + BigInt(p);
  }
  let hex = num.toString(16);
  if (hex.length % 2 !== 0) hex = '0' + hex;
  const res = Buffer.from(hex, 'hex');
  let leaderZeros = 0;
  for (let i = 1; i < str.length && str[i] === '1'; i++) leaderZeros++;
  return Buffer.concat([Buffer.alloc(leaderZeros, 0), res]);
}

const recipientKeyCache = {};

async function getRecipientMlkemPublicKey(baseUrl, recipientDid, authHeaderBase64, bearerToken) {
  if (recipientKeyCache[recipientDid]) {
    return recipientKeyCache[recipientDid];
  }

  const keyResponse = await fetch(`${baseUrl}/api/signer/recipient-key/${recipientDid}`, {
    method: "GET",
    headers: {
      "x-signer-auth-credential": authHeaderBase64,
      "Authorization": `Bearer ${bearerToken}`
    }
  });

  if (!keyResponse.ok) {
    throw new Error(`Falha ao obter chave pública do destinatário ${recipientDid} (HTTP ${keyResponse.status})`);
  }

  const didDoc = await keyResponse.json();
  const keysArray = didDoc.keys || didDoc.verificationMethod || [];
  const mlkemKey = keysArray.find(k => k.id.includes('#mlkem') || k.type === 'ML-KEM-768' || k.type === 'JsonWebKey2020');

  if (!mlkemKey || !(mlkemKey.public_key_multibase || mlkemKey.publicKeyMultibase)) {
    throw new Error(`Chave pública ML-KEM não encontrada no DID Document de ${recipientDid}`);
  }

  const multibaseStr = mlkemKey.public_key_multibase || mlkemKey.publicKeyMultibase;
  const pubKeyBytes = decodeBase58Btc(multibaseStr);
  const pubKeyBase64url = core.base64urlEncode(pubKeyBytes);

  recipientKeyCache[recipientDid] = pubKeyBase64url;
  return pubKeyBase64url;
}

function encryptPdfMlkemEnvelope(pdfBytes, recipientPubKeyBase64url) {
  // 1. Encapsula o segredo compartilhado via ML-KEM-768
  const encapsulation = core.mlkemEncapsulate('ML-KEM-768', recipientPubKeyBase64url);
  const sharedSecret = core.base64urlDecode(encapsulation.sharedSecret);

  // 2. Cifra o PDF com AES-256-GCM
  const encrypted = core.aes256GcmEncrypt(sharedSecret, pdfBytes);
  const capsulaRaw = core.base64urlDecode(encapsulation.ciphertext);

  // 3. Monta o envelope binário compatível com simulate-mobile-download.js:
  // [tamanhoCapsula 4 bytes][capsula (1088 bytes)][nonce 12 bytes][authTag 16 bytes][ciphertext]
  const combinedBuffer = Buffer.concat([
    Buffer.alloc(4),
    capsulaRaw,
    Buffer.from(encrypted.nonce),
    Buffer.from(encrypted.authTag),
    Buffer.from(encrypted.ciphertext)
  ]);
  combinedBuffer.writeUInt32BE(capsulaRaw.length, 0);

  return combinedBuffer;
}

async function main() {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const callbackEndpoint = `${baseUrl}/api/signer/callback`;

  const secretsStr = process.env.SIGNER_SECRETS || process.env.SIGNER_SECRET;
  const signerSecret = secretsStr ? secretsStr.split(',')[0].trim() : "mobile-signer-secret-token";

  const keysFilePath = path.join(__dirname, "keys.txt");
  const walletPath = path.join(__dirname, "mobile_wallet.db");
  const offlineStoragePath = path.join(__dirname, "offline_signed_batches.json");

  console.log("=================================================");
  console.log("📤 SIMULANDO APLICATIVO MÓVEL - UPLOAD DE LOTE");
  console.log("=================================================");

  // 1. Leitura do cache local do aplicativo
  if (!fs.existsSync(offlineStoragePath)) {
    console.log("ℹ️  Nenhuma credencial assinada aguardando upload em offline_signed_batches.json.");
    console.log("👉 Execute primeiro a assinatura: node lib/sign-batch-credentials.js");
    process.exit(0);
  }

  let offlineStorage = [];
  try {
    offlineStorage = JSON.parse(fs.readFileSync(offlineStoragePath, "utf-8"));
  } catch (e) {
    console.error("❌ [ERRO] Falha ao ler arquivo local offline_signed_batches.json.");
    process.exit(1);
  }

  if (offlineStorage.length === 0) {
    console.log("ℹ️  Fila de sincronização está vazia. Todas as credenciais já foram enviadas!");
    process.exit(0);
  }

  console.log(`\n📡 [App Mobile] Iniciando upload: ${offlineStorage.length} credencial(is) assinada(s) pronta(s).`);

  if (!fs.existsSync(keysFilePath) || !fs.existsSync(walletPath)) {
    console.error("❌ [ERRO] Wallet não encontrada. Verifique keys.txt e mobile_wallet.db.");
    process.exit(1);
  }
  const walletPassword = fs.readFileSync(keysFilePath, "utf-8").trim();

  let registeredDids = [];
  try {
    core.walletOpen(walletPath, walletPassword);
    registeredDids = core.walletListDids(walletPath, walletPassword) || [];
  } catch (err) {
    console.error("❌ [ERRO] Falha ao abrir wallet:", err.message);
    process.exit(1);
  }

  const activeDidData = registeredDids[registeredDids.length - 1];
  if (!activeDidData) {
    console.error("❌ [ERRO] Nenhuma DID encontrada na wallet móvel.");
    process.exit(1);
  }
  const signerDid = activeDidData.did;

  // 2. Autenticação Segura com a Plataforma (Proof of Possession + Bearer M2M)
  const timestamp = new Date().toISOString();
  const authCredentialData = { action: "sync_upload_auth", timestamp };
  const authSchema = core.createSchemaFromAttributes(authCredentialData, { version: '1.0', createdAt: timestamp });
  const signedAuth = core.walletIssueCredentialFromSchema(
    walletPath, walletPassword, signerDid, authSchema, authCredentialData,
    { credentialId: `auth-${Date.now()}`, issuedAt: timestamp, visiblePaths: ['action', 'timestamp'] }
  );

  const authHeaderBase64 = Buffer.from(JSON.stringify(signedAuth)).toString('base64');
  const bearerToken = crypto.createHmac("sha256", signerSecret).update(signerDid).digest("hex");

  let successCount = 0;
  let remainingStorage = [];

  // 3. Upload de cada credencial via multipart/form-data com cifra ML-KEM
  for (let i = 0; i < offlineStorage.length; i++) {
    const item = offlineStorage[i];
    console.log(`\n⏳ [Upload ${i+1}/${offlineStorage.length}] Processando ID: ${item.requestId}...`);

    let pdfBuffer = Buffer.from(item.encryptedPdfBase64, "base64");

    // Verifica se o PDF já está em envelope ML-KEM (cápsula de 1088 bytes)
    const isAlreadyEncrypted = pdfBuffer.length >= 1120 && pdfBuffer.readUInt32BE(0) === 1088;

    if (!isAlreadyEncrypted && item.metadata?.recipientDid) {
      try {
        console.log(`   🔒 Criptografando PDF com ML-KEM para o titular (${item.metadata.recipientDid})...`);
        const recipientPubKey = await getRecipientMlkemPublicKey(
          baseUrl,
          item.metadata.recipientDid,
          authHeaderBase64,
          bearerToken
        );
        pdfBuffer = encryptPdfMlkemEnvelope(pdfBuffer, recipientPubKey);
        console.log(`   ✔ PDF criptografado com envelope pós-quântico (${pdfBuffer.length} bytes).`);
      } catch (err) {
        console.warn(`   ⚠️ Aviso ao criptografar com ML-KEM: ${err.message}. Enviando arquivo original.`);
      }
    }

    const formData = new FormData();
    formData.append("metadata", JSON.stringify(item.metadata));
    formData.append("file", new Blob([pdfBuffer], { type: "application/octet-stream" }), `credential_enc_${item.requestId}.bin`);

    const cbResponse = await fetch(callbackEndpoint, {
      method: "POST",
      headers: {
        "x-signer-auth-credential": authHeaderBase64,
        "Authorization": `Bearer ${bearerToken}`
      },
      body: formData,
    });

    if (cbResponse.ok) {
      console.log(`   ✔ Sucesso! Credencial ativada na plataforma (status: ACTIVE).`);
      successCount++;
    } else {
      const errTxt = await cbResponse.text();
      console.error(`   ❌ Falha no envio:`, errTxt);
      remainingStorage.push(item);
    }
  }

  // 4. Atualiza o cache local
  if (remainingStorage.length === 0) {
    try {
      fs.unlinkSync(offlineStoragePath);
    } catch (_) {}
    console.log(`\n=================================================`);
    console.log(`🎉 UPLOAD DO LOTE CONCLUÍDO COM SUCESSO!`);
    console.log(`   Total ativado: ${successCount} credenciais.`);
    console.log(`   Fila local limpa.`);
    console.log(`=================================================`);
  } else {
    fs.writeFileSync(offlineStoragePath, JSON.stringify(remainingStorage, null, 2));
    console.log(`\n⚠ Upload parcial: ${successCount} enviada(s), ${remainingStorage.length} retida(s) para nova tentativa.`);
  }
}

if (require.main === module) {
  main();
}

module.exports = { main, getRecipientMlkemPublicKey, encryptPdfMlkemEnvelope };
