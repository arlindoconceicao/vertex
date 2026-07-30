const fs = require("fs");
const path = require("path");
const core = require("./ssi_pq_core.node");

async function main() {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const availableEndpoint = `${baseUrl}/api/signer/credentials/available`;

  const keysFilePath = path.join(__dirname, "keys.txt");
  const walletPath = path.join(__dirname, "mobile_wallet.db");

  console.log("=================================================");
  console.log("📥 SIMULANDO DOWNLOAD PELO APP MOBILE");
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
  console.log(`🔑 Autenticando com DID do titular: ${activeDidData.did}`);

  // Autenticação (PoP)
  const authPayload = { action: "available_credentials_auth", timestamp: new Date().toISOString() };
  const authSchema = core.createSchemaFromAttributes(authPayload, { version: "1", createdAt: authPayload.timestamp });
  
  const authCredential = core.walletIssueCredentialFromSchema(
    walletPath,
    walletPassword,
    activeDidData.did,
    authSchema,
    authPayload,
    {
      credentialId: `auth-download-${Date.now()}`,
      issuedAt: authPayload.timestamp,
      visiblePaths: ["action", "timestamp"]
    }
  );

  const authCredentialBase64 = Buffer.from(JSON.stringify(authCredential)).toString("base64");

  console.log("📡 Consultando credenciais cifradas disponíveis para download...");
  let availableCredentials = [];
  try {
    const response = await fetch(availableEndpoint, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "x-signer-auth-credential": authCredentialBase64,
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    availableCredentials = await response.json();
  } catch (err) {
    console.error("❌ [ERRO] Falha ao consultar plataforma:", err.message);
    process.exit(1);
  }

  if (availableCredentials.length === 0) {
    console.log("✅ Nenhuma credencial aguardando download.");
    return;
  }

  for (const cred of availableCredentials) {
    console.log(`\n📄 Iniciando download da credencial: ${cred.credentialId}`);
    const downloadUrl = `${baseUrl}/api/signer/download-pdf/${cred.credentialId}`;
    
    let encryptedPdfBuffer;
    try {
      const downloadResponse = await fetch(downloadUrl, {
        method: "GET",
        headers: {
          "authorization": `Bearer mobile-signer-secret-token`
        }
      });
      if (!downloadResponse.ok) throw new Error(`HTTP ${downloadResponse.status}`);
      const arrayBuffer = await downloadResponse.arrayBuffer();
      encryptedPdfBuffer = Buffer.from(arrayBuffer);
    } catch (err) {
       console.error(`❌ [ERRO] Falha ao baixar PDF: ${err.message}`);
       continue;
    }

    // A estrutura do Buffer gerado em upload-pdfs.js é:
    // [tamanhoCapsula 4 bytes][capsula][nonce 12 bytes][authTag 16 bytes][ciphertext]
    if (encryptedPdfBuffer.length < 4) {
       console.error(`❌ [ERRO] Arquivo baixado muito pequeno.`);
       continue;
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
       console.error(`❌ [ERRO] Falha ao decapsular. A chave pertence a outro DID? ${err.message}`);
       continue;
    }

    console.log("🔓 Decifrando PDF com AES-256-GCM...");
    try {
       const decryptedBytes = core.aes256GcmDecrypt(sharedSecret, ciphertext, nonce, authTag);
       const outPath = path.join(__dirname, `decrypted_${cred.credentialId}.pdf`);
       fs.writeFileSync(outPath, decryptedBytes);
       console.log(`✅ Sucesso! Arquivo decifrado salvo em: ${outPath}`);
    } catch(err) {
       console.error(`❌ [ERRO] Falha ao decifrar o PDF: ${err.message}`);
    }
  }
}

main().catch(console.error);
