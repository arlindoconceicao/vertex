const fs = require("fs");
const path = require("path");
const core = require("./ssi_pq_core.node");

function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error("Uso: node lib/decrypt-local-pdf.js <caminho-para-pdf.enc>");
    process.exit(1);
  }

  const inputFilePath = path.resolve(args[0]);
  if (!fs.existsSync(inputFilePath)) {
    console.error(`❌ [ERRO] Arquivo não encontrado: ${inputFilePath}`);
    process.exit(1);
  }

  const keysFilePath = path.join(__dirname, "keys.txt");
  const walletPath = path.join(__dirname, "mobile_wallet.db");

  console.log("=================================================");
  console.log("🔓 DECIFRANDO PDF LOCALMENTE COM A WALLET");
  console.log("=================================================");

  if (!fs.existsSync(keysFilePath) || !fs.existsSync(walletPath)) {
    console.error("❌ [ERRO] Banco SQLite da wallet ou keys.txt não encontrados.");
    process.exit(1);
  }

  const walletPassword = fs.readFileSync(keysFilePath, "utf-8").trim();

  let registeredDids = [];
  try {
    core.walletOpen(walletPath, walletPassword);
    registeredDids = core.walletListDids(walletPath, walletPassword);
  } catch (err) {
    console.error("❌ [ERRO] Falha ao abrir a wallet SQLite:", err.message);
    process.exit(1);
  }

  if (registeredDids.length === 0) {
    console.error("❌ [ERRO] Nenhuma DID registrada na wallet.");
    process.exit(1);
  }

  const activeDidData = registeredDids[registeredDids.length - 1];
  console.log(`🔑 Usando carteira do DID do titular: ${activeDidData.did}`);

  let encryptedPdfBuffer;
  try {
    encryptedPdfBuffer = fs.readFileSync(inputFilePath);
  } catch (err) {
    console.error(`❌ [ERRO] Falha ao ler o arquivo: ${err.message}`);
    process.exit(1);
  }

  // A estrutura do Buffer gerado no upload é:
  // [tamanhoCapsula 4 bytes][capsula][nonce 12 bytes][authTag 16 bytes][ciphertext]
  if (encryptedPdfBuffer.length < 4) {
    console.error(`❌ [ERRO] Arquivo muito pequeno ou corrompido.`);
    process.exit(1);
  }

  const capsulaLength = encryptedPdfBuffer.readUInt32BE(0);
  const capsula = encryptedPdfBuffer.subarray(4, 4 + capsulaLength);
  const nonce = encryptedPdfBuffer.subarray(4 + capsulaLength, 4 + capsulaLength + 12);
  const authTag = encryptedPdfBuffer.subarray(4 + capsulaLength + 12, 4 + capsulaLength + 28);
  const ciphertext = encryptedPdfBuffer.subarray(4 + capsulaLength + 28);

  console.log("🔑 Decapsulando o segredo compartilhado via ML-KEM...");
  const capsulaBase64url = core.base64urlEncode(capsula);
  let sharedSecret;
  try {
    const recoveredSecretBase64url = core.walletMlkemDecapsulate(walletPath, walletPassword, activeDidData.did, capsulaBase64url);
    sharedSecret = core.base64urlDecode(recoveredSecretBase64url);
  } catch(err) {
    console.error(`❌ [ERRO] Falha ao decapsular. Você é o real destinatário (Holder) deste PDF? O erro foi: ${err.message}`);
    process.exit(1);
  }

  console.log("🔓 Decifrando PDF com AES-256-GCM...");
  try {
    const decryptedBytes = core.aes256GcmDecrypt(sharedSecret, ciphertext, nonce, authTag);
    
    // Pega o nome do arquivo original e substitui a extensão para gerar o novo arquivo
    const parsedPath = path.parse(inputFilePath);
    // Se o arquivo for .enc, removemos, senao apenas adicionamos _decrypted
    const newName = parsedPath.name.endsWith('.pdf') 
      ? `${parsedPath.name}_decifrado.pdf` 
      : `${parsedPath.name}_decifrado.pdf`;
      
    const outPath = path.join(process.cwd(), newName);
    
    fs.writeFileSync(outPath, decryptedBytes);
    console.log(`✅ Sucesso! Arquivo decifrado salvo na pasta atual como: ${newName}`);
  } catch(err) {
    console.error(`❌ [ERRO] Falha ao decifrar o PDF: ${err.message}`);
    process.exit(1);
  }
}

main();
