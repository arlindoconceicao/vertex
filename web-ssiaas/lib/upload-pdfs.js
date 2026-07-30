const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const core = require("./ssi_pq_core.node");

async function main() {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const pendingEndpoint = `${baseUrl}/api/signer/requests/pending`;
  const callbackEndpoint = `${baseUrl}/api/signer/callback`;

  const keysFilePath = path.join(__dirname, "keys.txt");
  const walletPath = path.join(__dirname, "mobile_wallet.db");

  console.log("=================================================");
  console.log("📤 ENVIANDO PDFs CRIPTOGRAFADOS PARA A PLATAFORMA");
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
  console.log(`🔑 Autenticando com DID: ${activeDidData.did}`);

  // Autenticação (PoP)
  const authPayload = { action: "pending_requests_auth", timestamp: new Date().toISOString() };
  const authSchema = core.createSchemaFromAttributes(authPayload, { version: "1", createdAt: authPayload.timestamp });
  
  const authCredential = core.walletIssueCredentialFromSchema(
    walletPath,
    walletPassword,
    activeDidData.did,
    authSchema,
    authPayload,
    {
      credentialId: `auth-${Date.now()}`,
      issuedAt: authPayload.timestamp,
      visiblePaths: ["action", "timestamp"]
    }
  );

  const authCredentialBase64 = Buffer.from(JSON.stringify(authCredential)).toString("base64");

  console.log("📡 Buscando requisições pendentes para obter os IDs e DIDs...");
  let pendingRequests = [];
  try {
    const response = await fetch(pendingEndpoint, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "x-signer-auth-credential": authCredentialBase64,
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    pendingRequests = await response.json();
  } catch (err) {
    console.error("❌ [ERRO] Falha ao consultar plataforma:", err.message);
    process.exit(1);
  }

  if (pendingRequests.length === 0) {
    console.log("✅ Nenhuma credencial pendente encontrada. Nada para fazer upload.");
    return;
  }

  for (const request of pendingRequests) {
    const requestId = request.requestId;
    const pdfPath = path.join(__dirname, `credential_${requestId}.pdf`);

    if (!fs.existsSync(pdfPath)) {
      console.log(`⚠️ Arquivo ${pdfPath} não encontrado. Pule (talvez não gerado ainda).`);
      continue;
    }

    console.log(`\n📄 Processando upload para requisição: ${requestId}`);

    const recipientDid = request.unsignedPayload.credentialSubject.id;
    if (!recipientDid) {
       console.log(`⚠️ Destinatário não possui DID (credentialSubject.id). Pulando.`);
       continue;
    }

    // 1. Buscar Chave Pública do Destinatário
    console.log(`🔍 Buscando chave pública do destinatário: ${recipientDid}`);
    const keyResponse = await fetch(`${baseUrl}/api/signer/recipient-key/${recipientDid}`, {
       method: "GET",
       headers: { "x-signer-auth-credential": authCredentialBase64 }
    });

    if (!keyResponse.ok) {
       console.log(`❌ [ERRO] Falha ao obter chave do destinatário HTTP ${keyResponse.status}`);
       continue;
    }
    const recipientDidDoc = await keyResponse.json();
    
    // 2. Extrair ML-KEM
    const keysArray = recipientDidDoc.keys || recipientDidDoc.verificationMethod || [];
    const mlkemKey = keysArray.find(k => k.id.includes('#mlkem') || k.type === 'ML-KEM-768' || k.type === 'JsonWebKey2020');
    let recipientPubKeyBase64url = "";
    if (mlkemKey && (mlkemKey.public_key_multibase || mlkemKey.publicKeyMultibase)) {
        // Descodifica o Multibase
        const multibaseStr = mlkemKey.public_key_multibase || mlkemKey.publicKeyMultibase;
        const decodeBase58Btc = (str) => {
            const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
            if (str.length === 0) return Buffer.alloc(0);
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
            
            // Tratamento de zeros iniciais
            let leaderZeros = 0;
            for (let i = 1; i < str.length && str[i] === '1'; i++) leaderZeros++;
            return Buffer.concat([Buffer.alloc(leaderZeros, 0), res]);
        };
        const pubKeyBytes = decodeBase58Btc(multibaseStr);
        recipientPubKeyBase64url = core.base64urlEncode(pubKeyBytes);
    } else {
        console.log(`❌ [ERRO] Material ML-KEM não encontrado no DID do destinatário: ${JSON.stringify(keysArray)}`);
        continue;
    }

    // 3. Encapsular a chave secreta ML-KEM
    const encapsulation = core.mlkemEncapsulate('ML-KEM-768', recipientPubKeyBase64url);
    const sharedSecretSender = core.base64urlDecode(encapsulation.sharedSecret);

    // 4. Criptografar o PDF original (AES-256-GCM)
    const pdfBytes = fs.readFileSync(pdfPath);
    
    // Calculando hash do PDF em claro (para comprovação)
    const pdfHash = crypto.createHash("sha256").update(pdfBytes).digest("hex");

    console.log("🔒 Criptografando o PDF...");
    const encrypted = core.aes256GcmEncrypt(sharedSecretSender, pdfBytes);
    
    // Anexamos as metainformações da criptografia no final do buffer cifrado 
    // ou deixamos o App móvel empacotar. Como o backend não lida com isso, 
    // a forma mais limpa de mandar o PDF criptografado para a plataforma armazenar
    // é gravar ciphertext, nonce e authtag num arquivo envelope JSON ou Buffer composto.
    // Aqui para simplificar e garantir que não quebre a API de uploads multipartes da NextJS
    // Montaremos um payload Buffer simples estruturado:
    // [tamanhoCapsula 4 bytes][capsula][nonce 12 bytes][authTag 16 bytes][ciphertext]
    const capsulaBytes = Buffer.from(encapsulation.ciphertext, 'base64'); // dependendo do retorno
    // Como core retorna ciphertext em base64url:
    const capsulaRaw = core.base64urlDecode(encapsulation.ciphertext);
    
    const combinedBuffer = Buffer.concat([
       Buffer.alloc(4), // Espaço pro length da capsula
       capsulaRaw,
       Buffer.from(encrypted.nonce),
       Buffer.from(encrypted.authTag),
       Buffer.from(encrypted.ciphertext)
    ]);
    combinedBuffer.writeUInt32BE(capsulaRaw.length, 0);

    // 5. Montar metadados
    const metadata = {
        requestId: requestId,
        issuerDid: activeDidData.did,
        recipientDid: recipientDid,
        timestamp: new Date().toISOString(),
        pdfHash: pdfHash,
        schemaId: request.unsignedPayload.credentialSchema?.id || "N/A"
    };

    // 6. Enviar via form-data
    console.log("🚀 Fazendo upload via POST multipart/form-data...");
    const formData = new FormData();
    formData.append("metadata", JSON.stringify(metadata));
    formData.append("file", new Blob([combinedBuffer], { type: "application/octet-stream" }), `credential_enc_${requestId}.bin`);

    try {
        const uploadResponse = await fetch(callbackEndpoint, {
            method: "POST",
            headers: {
                "authorization": `Bearer mobile-signer-secret-token` // Token estático do .env (ajuste conforme necessario)
            },
            body: formData
        });

        if (!uploadResponse.ok) {
           const errText = await uploadResponse.text();
           console.log(`❌ [ERRO] Upload falhou HTTP ${uploadResponse.status}: ${errText}`);
        } else {
           console.log(`✅ Upload da credencial ${requestId} concluído com sucesso!`);
           fs.unlinkSync(pdfPath); // apagar o arquivo em claro local apos upload
        }
    } catch(err) {
        console.log(`❌ [ERRO] Requisição de upload: ${err.message}`);
    }
  }
}

main().catch(console.error);
