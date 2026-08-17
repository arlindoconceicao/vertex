const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const core = require('./ssi_pq_core.node');

function decodeBase58Btc(str) {
  if (str[0] !== 'z') throw new Error('Not base58btc multibase');
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let d = 0n;
  const strData = str.slice(1);
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

const PARAMETER_SETS = [
  { id: 'Level 1 (128-bit)', mldsa: 'ML-DSA-44', mlkem: 'ML-KEM-512' },
  { id: 'Level 3 (192-bit)', mldsa: 'ML-DSA-65', mlkem: 'ML-KEM-768' },
  { id: 'Level 5 (256-bit)', mldsa: 'ML-DSA-87', mlkem: 'ML-KEM-1024' }
];

// 1 KB, 2KB, 3KB, 4KB, 5KB, 10KB, 25KB, 50KB, 100KB, 250KB, 500KB and 1 MB
const PAYLOAD_SIZES_KB = [1, 2, 3, 4, 5, 10, 25, 50, 100, 250, 500, 1024];

function generatePayload(sizeKb) {
  const numBytes = sizeKb * 512; // generates sizeKb * 1024 hex chars
  const hexStr = crypto.randomBytes(numBytes).toString('hex');
  return { conteudo: hexStr };
}

console.log(`=================================================`);
console.log(`🚀 Iniciando Benchmark de Tamanho de Payloads (SSI-PQ)`);
console.log(`=================================================\n`);

const outputDir = path.join(__dirname, 'metrics_output');
fs.mkdirSync(outputDir, { recursive: true });

const results = {};
for (const params of PARAMETER_SETS) {
  results[params.id] = {};
}

// Prepare wallet once per level to save time
const wallets = {};
const runId = crypto.randomUUID();

for (const params of PARAMETER_SETS) {
  console.log(`⏳ Gerando chaves para ${params.id}...`);
  const senderWallet = path.join(outputDir, `sender-size-${params.mldsa}-${runId}.db`);
  const recipientWallet = path.join(outputDir, `recipient-size-${params.mldsa}-${runId}.db`);
  const password = 'senha';

  core.walletCreate(senderWallet, password, { createdAt: '2026-05-27T00:00:00Z' });
  const senderDidInfo = core.walletCreateDid(senderWallet, password, {
    label: 'Remetente', mldsa: params.mldsa, mlkem: params.mlkem, createdAt: '2026-05-27T00:00:00Z'
  });
  const senderDidDocument = core.walletGetDidDocument(senderWallet, password, senderDidInfo.did);

  core.walletCreate(recipientWallet, password, { createdAt: '2026-05-27T00:00:00Z' });
  const recipientDidInfo = core.walletCreateDid(recipientWallet, password, {
    label: 'Destinatario', mldsa: params.mldsa, mlkem: params.mlkem, createdAt: '2026-05-27T00:00:00Z'
  });
  const recipientDidDocument = core.walletGetDidDocument(recipientWallet, password, recipientDidInfo.did);

  const mlkemKey = recipientDidDocument.keys.find((key) => key.id === '#mlkem-1');
  const recipientPubKeyBytes = decodeBase58Btc(mlkemKey.public_key_multibase);
  const recipientPubKeyBase64url = core.base64urlEncode(recipientPubKeyBytes);

  wallets[params.id] = {
    senderWallet, recipientWallet, password, senderDidInfo, senderDidDocument, recipientDidInfo, recipientPubKeyBase64url
  };
}

for (const sizeKb of PAYLOAD_SIZES_KB) {
  console.log(`\n📦 Processando payload de ${sizeKb} KB...`);
  const credentialData = generatePayload(sizeKb);
  const credentialJsonStr = JSON.stringify(credentialData);
  const sizeOriginal = Buffer.byteLength(credentialJsonStr);

  const visiblePaths = ['conteudo'];
  const pdfLabels = { conteudo: 'Conteúdo' };

  for (const params of PARAMETER_SETS) {
    console.log(`  -> Nível: ${params.mldsa} / ${params.mlkem}`);
    const w = wallets[params.id];

    // 1. Schema
    const schema = core.createSchemaFromAttributes(credentialData, { version: '1', createdAt: '2026-05-27T00:00:00Z' });
    const sizeSchema = Buffer.byteLength(JSON.stringify(schema));

    // 2. Issue Credential
    const signedCredential = core.walletIssueCredentialFromSchema(
      w.senderWallet, w.password, w.senderDidInfo.did,
      schema, credentialData,
      { credentialId: `cred-size-${sizeKb}`, issuedAt: '2026-05-27T00:00:00Z', visiblePaths }
    );
    const sizeSigned = Buffer.byteLength(JSON.stringify(signedCredential));

    // 3. Base PDF
    const pdfBase = Buffer.from(core.signedCredentialToPdf(signedCredential, { labels: pdfLabels }));
    const sizeBasePdf = pdfBase.length;

    // 4. Embedded PDF
    const finalPdf = Buffer.from(
      core.walletEmbedSignedCredentialInPdf(w.senderWallet, w.password, w.senderDidInfo.did, pdfBase, signedCredential, { createdAt: '2026-05-27T00:00:00Z' })
    );
    const sizeEmbeddedPdf = finalPdf.length;

    // 5. Encrypted PDF
    const encapsulation = core.mlkemEncapsulate(params.mlkem, w.recipientPubKeyBase64url);
    const sharedSecretSender = core.base64urlDecode(encapsulation.sharedSecret);
    const encrypted = core.aes256GcmEncrypt(sharedSecretSender, finalPdf);
    const sizeEncryptedPdf = Buffer.from(encrypted.ciphertext).length;

    results[params.id][sizeKb] = {
      sizeOriginal,
      sizeSchema,
      sizeSigned,
      sizeBasePdf,
      sizeEmbeddedPdf,
      sizeEncryptedPdf
    };
  }
}

// Cleanup
for (const params of PARAMETER_SETS) {
  try {
    fs.unlinkSync(wallets[params.id].senderWallet);
    fs.unlinkSync(wallets[params.id].recipientWallet);
  } catch (e) {}
}

function fb(val) { return (val / 1024).toFixed(2); }

function generateHtmlReport(res, sizes) {
  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SSI-PQ Benchmark de Tamanhos (Payload Escalável)</title>
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f7f6; margin: 0; padding: 20px; color: #333; }
    h1, h2 { text-align: center; color: #2c3e50; }
    .container { max-width: 1400px; margin: 0 auto; background: #fff; padding: 30px; border-radius: 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
    table { width: 100%; border-collapse: collapse; margin-bottom: 40px; }
    th, td { padding: 10px; text-align: center; border-bottom: 1px solid #ddd; font-size: 14px; }
    th { background-color: #34495e; color: #fff; }
    tr:hover { background-color: #f1f1f1; }
    .col-header { text-align: left; font-weight: bold; background-color: #e8f4f8; }
    .desc { font-size: 0.85em; color: #777; display: block; }
    .header-level { background-color: #2980b9 !important; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Benchmark de Tamanho de Payloads</h1>
    <p style="text-align:center;">Impacto no tamanho das assinaturas e PDFs gerados à medida que o conteúdo original cresce de 1KB até 1MB.</p>
    
    ${PARAMETER_SETS.map(params => `
    <h2>${params.id} <br><span style="font-size: 16px; font-weight: normal; color: #555;">(${params.mldsa} / ${params.mlkem})</span></h2>
    <table>
      <thead>
        <tr>
          <th class="header-level">Payload Alvo</th>
          <th class="header-level">JSON Original</th>
          <th class="header-level">Schema JSON</th>
          <th class="header-level">JSON Assinado</th>
          <th class="header-level">PDF Base (Visual)</th>
          <th class="header-level">PDF Embutido (Final)</th>
          <th class="header-level">PDF Cifrado (AES-GCM)</th>
        </tr>
      </thead>
      <tbody>
        ${sizes.map(sizeKb => `
        <tr>
          <td class="col-header">${sizeKb >= 1024 ? (sizeKb/1024).toFixed(1) + ' MB' : sizeKb + ' KB'}</td>
          <td>${fb(res[params.id][sizeKb].sizeOriginal)} KB</td>
          <td>${fb(res[params.id][sizeKb].sizeSchema)} KB<br><span class="desc">vs Original: ${((res[params.id][sizeKb].sizeSchema / res[params.id][sizeKb].sizeOriginal)*100).toFixed(0)}%</span></td>
          <td>${fb(res[params.id][sizeKb].sizeSigned)} KB<br><span class="desc">vs Original: ${((res[params.id][sizeKb].sizeSigned / res[params.id][sizeKb].sizeOriginal)*100).toFixed(0)}%</span></td>
          <td>${fb(res[params.id][sizeKb].sizeBasePdf)} KB<br><span class="desc">vs Schema: ${((res[params.id][sizeKb].sizeBasePdf / res[params.id][sizeKb].sizeSchema)*100).toFixed(0)}%</span></td>
          <td>${fb(res[params.id][sizeKb].sizeEmbeddedPdf)} KB<br><span class="desc">vs JSON Ass: ${((res[params.id][sizeKb].sizeEmbeddedPdf / res[params.id][sizeKb].sizeSigned)*100).toFixed(0)}%</span></td>
          <td>${fb(res[params.id][sizeKb].sizeEncryptedPdf)} KB<br><span class="desc">vs Embutido: ${((res[params.id][sizeKb].sizeEncryptedPdf / res[params.id][sizeKb].sizeEmbeddedPdf)*100).toFixed(1)}%</span></td>
        </tr>
        `).join('')}
      </tbody>
    </table>
    `).join('')}
  </div>
</body>
</html>`;
  
  const reportPath = path.join(__dirname, 'metrics_output', 'size-benchmark-report.html');
  fs.writeFileSync(reportPath, html, 'utf8');
  console.log(`\n✅ Relatório gerado em: ${reportPath}`);
}

generateHtmlReport(results, PAYLOAD_SIZES_KB);
