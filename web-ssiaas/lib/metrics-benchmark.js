const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('perf_hooks');
const crypto = require('node:crypto');
const os = require('node:os');
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');
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

const credentialData = {
  titular: { nome: 'Alice Silva', documento: { tipo: 'CPF', numero: '123.456.789-00' } },
  formacao: { curso: 'Criptografia Pós-Quântica', instituicao: { nome: 'SSI-PQ Academy', cidade: 'São Paulo' } },
  endereco: { rua: 'Rua São José', numero: 42, cidade: 'São Paulo' },
  nivel: 'Avançado'
};

const visiblePaths = [
  'titular.nome', 'titular.documento.tipo', 'titular.documento.numero',
  'formacao.curso', 'formacao.instituicao.nome', 'endereco.cidade', 'nivel'
];

const pdfLabels = {
  endereco: 'Endereço', 'endereco.cidade': 'Cidade', formacao: 'Formação',
  'formacao.curso': 'Curso', 'formacao.instituicao': 'Instituição',
  'formacao.instituicao.nome': 'Nome', nivel: 'Nível', titular: 'Titular',
  'titular.documento': 'Documento', 'titular.documento.tipo': 'Tipo', 'titular.nome': 'Nome'
};

const credentialJsonStr = JSON.stringify(credentialData);
const credentialSize = Buffer.byteLength(credentialJsonStr);

if (isMainThread) {
  const ITERATIONS = parseInt(process.env.ITERATIONS || '10', 10);
  const THREADS = parseInt(process.env.THREADS || '1', 10);
  const WARMUP = parseInt(process.env.WARMUP_ITERATIONS || '0', 10);

  // Informações da máquina
  const cpuModel = os.cpus()[0]?.model || 'Desconhecido';
  const cpuSpeed = os.cpus()[0]?.speed || 0;
  const cpuCores = os.cpus().length;
  const totalRAM = Math.round(os.totalmem() / (1024 ** 3));
  const osInfo = `${os.type()} ${os.release()} (${os.arch()})`;
  
  const sysInfo = {
    cpu: `${cpuModel} (${cpuCores} cores, ${cpuSpeed}MHz)`,
    ram: `${totalRAM} GB`,
    os: osInfo
  };

  console.log(`=================================================`);
  console.log(`🚀 Iniciando Benchmark SSI-PQ (Multi-Thread)`);
  console.log(`🔄 Iterações totais computadas: ${ITERATIONS}`);
  console.log(`🔥 Iterações de WARMUP (por thread): ${WARMUP}`);
  console.log(`🧵 Threads: ${THREADS}`);
  console.log(`💻 CPU: ${sysInfo.cpu}`);
  console.log(`=================================================\n`);

  const outputDir = path.join(__dirname, 'metrics_output');
  fs.mkdirSync(outputDir, { recursive: true });

  const workers = [];
  const itersPerThread = Math.floor(ITERATIONS / THREADS);
  let remainingIters = ITERATIONS % THREADS;

  console.log('Executando operações criptográficas...');

  for (let i = 0; i < THREADS; i++) {
    const iters = itersPerThread + (remainingIters > 0 ? 1 : 0);
    remainingIters--;
    
    if (iters > 0 || WARMUP > 0) {
      workers.push(new Promise((resolve, reject) => {
        const worker = new Worker(__filename, { workerData: { iters, warmupIters: WARMUP, threadId: i, outputDir } });
        worker.on('message', resolve);
        worker.on('error', reject);
        worker.on('exit', (code) => {
          if (code !== 0) reject(new Error(`Worker stopped with exit code ${code}`));
        });
      }));
    }
  }

  Promise.all(workers).then((workerResults) => {
    const combined = {};
    for (const params of PARAMETER_SETS) {
      combined[params.id] = {
        t_schema: [], t_issue: [], size_signedJson: [], size_schemaJson: [],
        t_basePdf: [], size_basePdf: [], t_embedPdf: [], size_finalPdf: [],
        t_kemEncap: [], t_aesEncrypt: [], size_encPdf: [], t_kemDecap: [],
        t_aesDecrypt: [], t_verifyPdf: [], t_extractManifest: [], t_verifyJson: []
      };
      
      for (const res of workerResults) {
        if (!res) continue; // no data (e.g. 0 iters)
        const paramStats = res[params.id];
        if (!paramStats) continue;
        for (const key in paramStats) {
          combined[params.id][key].push(...paramStats[key]);
        }
      }
    }

    const finalResults = {};
    for (const params of PARAMETER_SETS) {
      finalResults[params.id] = {
        t_schema: getStats(combined[params.id].t_schema),
        t_issue: getStats(combined[params.id].t_issue),
        t_verifyJson: getStats(combined[params.id].t_verifyJson),
        t_basePdf: getStats(combined[params.id].t_basePdf),
        t_embedPdf: getStats(combined[params.id].t_embedPdf),
        t_kemEncap: getStats(combined[params.id].t_kemEncap),
        t_aesEncrypt: getStats(combined[params.id].t_aesEncrypt),
        t_kemDecap: getStats(combined[params.id].t_kemDecap),
        t_aesDecrypt: getStats(combined[params.id].t_aesDecrypt),
        t_verifyPdf: getStats(combined[params.id].t_verifyPdf),
        t_extractManifest: getStats(combined[params.id].t_extractManifest),
        sizes: {
          initialJson: credentialSize,
          schemaJson: getStats(combined[params.id].size_schemaJson).avg,
          signedJson: getStats(combined[params.id].size_signedJson).avg,
          basePdf: getStats(combined[params.id].size_basePdf).avg,
          finalPdf: getStats(combined[params.id].size_finalPdf).avg,
          encPdf: getStats(combined[params.id].size_encPdf).avg
        }
      };
    }
    generateHtmlReport(finalResults, ITERATIONS, THREADS, WARMUP, sysInfo);
  }).catch(console.error);

  function getStats(arr) {
    if (arr.length === 0) return { avg: 0, stdDev: 0 };
    const sum = arr.reduce((a, b) => a + b, 0);
    const avg = sum / arr.length;
    const sqDiffs = arr.map(val => Math.pow(val - avg, 2));
    const avgSqDiff = sqDiffs.reduce((a, b) => a + b, 0) / arr.length;
    const stdDev = Math.sqrt(avgSqDiff);
    return { avg, stdDev };
  }
} else {
  // WORKER THREAD LOGIC
  const { iters, warmupIters, threadId, outputDir } = workerData;
  const runId = crypto.randomUUID();
  const workerResults = {};

  for (const params of PARAMETER_SETS) {
    let stats = {
      t_schema: [], t_issue: [], size_signedJson: [], size_schemaJson: [],
      t_basePdf: [], size_basePdf: [],
      t_embedPdf: [], size_finalPdf: [],
      t_kemEncap: [], t_aesEncrypt: [], size_encPdf: [],
      t_kemDecap: [], t_aesDecrypt: [],
      t_verifyPdf: [], t_extractManifest: [], t_verifyJson: []
    };

    const totalIters = warmupIters + iters;
    for (let iter = 0; iter < totalIters; iter++) {
      const isWarmup = iter < warmupIters;

      const senderWallet = path.join(outputDir, `sender-${params.mldsa}-${threadId}-${iter}-${runId}.db`);
      const senderPassword = 'senha-remetente';
      core.walletCreate(senderWallet, senderPassword, { createdAt: '2026-05-27T00:00:00Z' });
      const senderDidInfo = core.walletCreateDid(senderWallet, senderPassword, {
        label: 'Remetente', mldsa: params.mldsa, mlkem: params.mlkem, createdAt: '2026-05-27T00:00:00Z'
      });
      const senderDidDocument = core.walletGetDidDocument(senderWallet, senderPassword, senderDidInfo.did);

      const recipientWallet = path.join(outputDir, `recipient-${params.mldsa}-${threadId}-${iter}-${runId}.db`);
      const recipientPassword = 'senha-destinatario';
      core.walletCreate(recipientWallet, recipientPassword, { createdAt: '2026-05-27T00:00:00Z' });
      const recipientDidInfo = core.walletCreateDid(recipientWallet, recipientPassword, {
        label: 'Destinatario', mldsa: params.mldsa, mlkem: params.mlkem, createdAt: '2026-05-27T00:00:00Z'
      });
      const recipientDidDocument = core.walletGetDidDocument(recipientWallet, recipientPassword, recipientDidInfo.did);

      // 1
      let start = performance.now();
      const schema = core.createSchemaFromAttributes(credentialData, { version: '1', createdAt: '2026-05-27T00:00:00Z' });
      const tSchema = performance.now() - start;
      const schemaJsonStr = JSON.stringify(schema);
      if (!isWarmup) {
        stats.t_schema.push(tSchema);
        stats.size_schemaJson.push(Buffer.byteLength(schemaJsonStr));
      }

      // 2
      start = performance.now();
      const signedCredential = core.walletIssueCredentialFromSchema(
        senderWallet, senderPassword, senderDidInfo.did,
        schema, credentialData,
        { credentialId: `cred-${iter}`, issuedAt: '2026-05-27T00:00:00Z', visiblePaths }
      );
      const tIssue = performance.now() - start;
      const signedJsonStr = JSON.stringify(signedCredential);
      if (!isWarmup) {
        stats.t_issue.push(tIssue);
        stats.size_signedJson.push(Buffer.byteLength(signedJsonStr));
      }

      // 3
      start = performance.now();
      core.verifySignedCredential(signedCredential, senderDidDocument);
      const tVerifyJson = performance.now() - start;
      if (!isWarmup) stats.t_verifyJson.push(tVerifyJson);

      // 4
      start = performance.now();
      const pdfBase = Buffer.from(core.signedCredentialToPdf(signedCredential, { labels: pdfLabels }));
      const tBasePdf = performance.now() - start;
      if (!isWarmup) {
        stats.t_basePdf.push(tBasePdf);
        stats.size_basePdf.push(pdfBase.length);
      }

      // 5
      start = performance.now();
      const finalPdf = Buffer.from(
        core.walletEmbedSignedCredentialInPdf(senderWallet, senderPassword, senderDidInfo.did, pdfBase, signedCredential, { createdAt: '2026-05-27T00:00:00Z' })
      );
      const tEmbedPdf = performance.now() - start;
      if (!isWarmup) {
        stats.t_embedPdf.push(tEmbedPdf);
        stats.size_finalPdf.push(finalPdf.length);
      }

      // 6
      const mlkemKey = recipientDidDocument.keys.find((key) => key.id === '#mlkem-1');
      const recipientPubKeyBytes = decodeBase58Btc(mlkemKey.public_key_multibase);
      const recipientPubKeyBase64url = core.base64urlEncode(recipientPubKeyBytes);
      start = performance.now();
      const encapsulation = core.mlkemEncapsulate(params.mlkem, recipientPubKeyBase64url);
      const tKemEncap = performance.now() - start;
      const sharedSecretSender = core.base64urlDecode(encapsulation.sharedSecret);
      if (!isWarmup) stats.t_kemEncap.push(tKemEncap);

      // 7
      start = performance.now();
      const encrypted = core.aes256GcmEncrypt(sharedSecretSender, finalPdf);
      const tAesEncrypt = performance.now() - start;
      const encryptedPdf = Buffer.from(encrypted.ciphertext);
      const iv = Buffer.from(encrypted.nonce);
      const authTag = Buffer.from(encrypted.authTag);
      if (!isWarmup) {
        stats.t_aesEncrypt.push(tAesEncrypt);
        stats.size_encPdf.push(encryptedPdf.length);
      }

      // 8
      start = performance.now();
      const recoveredSecretBase64url = core.walletMlkemDecapsulate(
        recipientWallet, recipientPassword, recipientDidInfo.did, encapsulation.ciphertext
      );
      const tKemDecap = performance.now() - start;
      const sharedSecretRecipient = core.base64urlDecode(recoveredSecretBase64url);
      if (!isWarmup) stats.t_kemDecap.push(tKemDecap);

      // 9
      start = performance.now();
      const decryptedPdf = Buffer.from(
        core.aes256GcmDecrypt(sharedSecretRecipient, encryptedPdf, iv, authTag)
      );
      const tAesDecrypt = performance.now() - start;
      if (!isWarmup) stats.t_aesDecrypt.push(tAesDecrypt);

      // 10
      start = performance.now();
      core.verifySignedCredentialPdf(decryptedPdf, senderDidDocument);
      const tVerifyPdf = performance.now() - start;
      if (!isWarmup) stats.t_verifyPdf.push(tVerifyPdf);

      // 11
      start = performance.now();
      core.extractCredentialManifestFromPdf(decryptedPdf);
      const tExtractManifest = performance.now() - start;
      if (!isWarmup) stats.t_extractManifest.push(tExtractManifest);

      try {
        fs.unlinkSync(senderWallet);
        fs.unlinkSync(recipientWallet);
      } catch (e) {}
    }
    workerResults[params.id] = stats;
  }
  parentPort.postMessage(workerResults);
}

function f(val) { return val.toFixed(3); }
function fb(val) { return (val / 1024).toFixed(2); }

function generateHtmlReport(res, iters, threads, warmup, sysInfo) {
  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SSI-PQ Benchmark Metrics</title>
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f7f6; margin: 0; padding: 20px; color: #333; }
    h1, h2 { text-align: center; color: #2c3e50; }
    .container { max-width: 1200px; margin: 0 auto; background: #fff; padding: 30px; border-radius: 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
    table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
    th, td { padding: 12px 15px; text-align: center; border-bottom: 1px solid #ddd; }
    th { background-color: #34495e; color: #fff; text-transform: uppercase; font-size: 14px; }
    tr:hover { background-color: #f1f1f1; }
    .col-header { text-align: left; font-weight: bold; }
    .desc { font-size: 0.85em; color: #666; display: block; }
    .size-col { background-color: #e8f4f8; }
    .size-head { background-color: #2980b9 !important; }
    .info-bar { background-color: #eef; padding: 15px; border-radius: 8px; margin-bottom: 20px; text-align: left; }
    .info-bar ul { list-style: none; padding-left: 0; margin: 5px 0 0; }
    .info-bar li { margin-bottom: 5px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Resultados de Benchmark: Criptografia Pós-Quântica (SSI-PQ)</h1>
    <div class="info-bar">
      <strong>💻 Informações da Máquina:</strong>
      <ul>
        <li><strong>Sistema Operacional:</strong> ${sysInfo.os}</li>
        <li><strong>Processador:</strong> ${sysInfo.cpu}</li>
        <li><strong>Memória RAM:</strong> ${sysInfo.ram}</li>
      </ul>
      <hr style="border: 0; border-top: 1px solid #ccc; margin: 15px 0;">
      <strong>⚙️ Parâmetros do Teste:</strong>
      <ul>
        <li><strong>Iterações (Computadas):</strong> ${iters}</li>
        <li><strong>Iterações de Warmup (Ignoradas por thread):</strong> ${warmup}</li>
        <li><strong>Threads simultâneas:</strong> ${threads}</li>
      </ul>
      <p style="font-size: 0.85em; color: #555;"><i>* Todos os tempos estão listados em milissegundos (ms). As estatísticas representam a Média ± Desvio Padrão.</i></p>
    </div>
    
    <h2>Tabela 1: Tempos de Execução (em ms)</h2>
    <table>
      <thead>
        <tr>
          <th>Métrica (Operação)</th>
          ${PARAMETER_SETS.map(p => `<th>${p.id}<br><span class="desc">${p.mldsa} / ${p.mlkem}</span></th>`).join('')}
        </tr>
      </thead>
      <tbody>
        <tr>
          <td class="col-header">1. Construir Esquema (createSchemaFromAttributes)</td>
          ${PARAMETER_SETS.map(p => `<td>${f(res[p.id].t_schema.avg)} ± ${f(res[p.id].t_schema.stdDev)}</td>`).join('')}
        </tr>
        <tr>
          <td class="col-header">2. Emitir Credencial (walletIssueCredentialFromSchema)</td>
          ${PARAMETER_SETS.map(p => `<td>${f(res[p.id].t_issue.avg)} ± ${f(res[p.id].t_issue.stdDev)}</td>`).join('')}
        </tr>
        <tr>
          <td class="col-header">3. Verificar Credencial JSON (verifySignedCredential)</td>
          ${PARAMETER_SETS.map(p => `<td>${f(res[p.id].t_verifyJson.avg)} ± ${f(res[p.id].t_verifyJson.stdDev)}</td>`).join('')}
        </tr>
        <tr>
          <td class="col-header">4. Construir PDF Base (signedCredentialToPdf)</td>
          ${PARAMETER_SETS.map(p => `<td>${f(res[p.id].t_basePdf.avg)} ± ${f(res[p.id].t_basePdf.stdDev)}</td>`).join('')}
        </tr>
        <tr>
          <td class="col-header">5. Embutir & Assinar PDF (walletEmbedSignedCredentialInPdf)</td>
          ${PARAMETER_SETS.map(p => `<td>${f(res[p.id].t_embedPdf.avg)} ± ${f(res[p.id].t_embedPdf.stdDev)}</td>`).join('')}
        </tr>
        <tr>
          <td class="col-header">6. Encapsular Segredo (mlkemEncapsulate)</td>
          ${PARAMETER_SETS.map(p => `<td>${f(res[p.id].t_kemEncap.avg)} ± ${f(res[p.id].t_kemEncap.stdDev)}</td>`).join('')}
        </tr>
        <tr>
          <td class="col-header">7. Cifrar PDF (aes256GcmEncrypt)</td>
          ${PARAMETER_SETS.map(p => `<td>${f(res[p.id].t_aesEncrypt.avg)} ± ${f(res[p.id].t_aesEncrypt.stdDev)}</td>`).join('')}
        </tr>
        <tr>
          <td class="col-header">8. Decapsular Segredo (walletMlkemDecapsulate)</td>
          ${PARAMETER_SETS.map(p => `<td>${f(res[p.id].t_kemDecap.avg)} ± ${f(res[p.id].t_kemDecap.stdDev)}</td>`).join('')}
        </tr>
        <tr>
          <td class="col-header">9. Decifrar Arquivo (aes256GcmDecrypt)</td>
          ${PARAMETER_SETS.map(p => `<td>${f(res[p.id].t_aesDecrypt.avg)} ± ${f(res[p.id].t_aesDecrypt.stdDev)}</td>`).join('')}
        </tr>
        <tr>
          <td class="col-header">10. Verificar PDF Assinado (verifySignedCredentialPdf)</td>
          ${PARAMETER_SETS.map(p => `<td>${f(res[p.id].t_verifyPdf.avg)} ± ${f(res[p.id].t_verifyPdf.stdDev)}</td>`).join('')}
        </tr>
        <tr>
          <td class="col-header">11. Extrair Manifesto do PDF (extractCredentialManifestFromPdf)</td>
          ${PARAMETER_SETS.map(p => `<td>${f(res[p.id].t_extractManifest.avg)} ± ${f(res[p.id].t_extractManifest.stdDev)}</td>`).join('')}
        </tr>
      </tbody>
    </table>

    <h2>Tabela 2: Comparativo de Tamanhos (em KB)</h2>
    <table>
      <thead>
        <tr>
          <th class="size-head">Métrica de Tamanho</th>
          ${PARAMETER_SETS.map(p => `<th class="size-head">${p.id}</th>`).join('')}
        </tr>
      </thead>
      <tbody>
        <tr>
          <td class="col-header size-col">JSON Original (Referência)</td>
          ${PARAMETER_SETS.map(p => `<td class="size-col">${fb(res[p.id].sizes.initialJson)} KB</td>`).join('')}
        </tr>
        <tr>
          <td class="col-header size-col">12. Schema JSON</td>
          ${PARAMETER_SETS.map(p => `<td class="size-col">${fb(res[p.id].sizes.schemaJson)} KB<br><span class="desc">vs Original: ${((res[p.id].sizes.schemaJson / res[p.id].sizes.initialJson)*100).toFixed(0)}%</span></td>`).join('')}
        </tr>
        <tr>
          <td class="col-header size-col">13. JSON Assinado</td>
          ${PARAMETER_SETS.map(p => `<td class="size-col">${fb(res[p.id].sizes.signedJson)} KB<br><span class="desc">vs Original: ${((res[p.id].sizes.signedJson / res[p.id].sizes.initialJson)*100).toFixed(0)}%</span></td>`).join('')}
        </tr>
        <tr>
          <td class="col-header size-col">14. PDF Base Visual</td>
          ${PARAMETER_SETS.map(p => `<td class="size-col">${fb(res[p.id].sizes.basePdf)} KB<br><span class="desc">vs Schema: ${((res[p.id].sizes.basePdf / res[p.id].sizes.schemaJson)*100).toFixed(0)}%</span></td>`).join('')}
        </tr>
        <tr>
          <td class="col-header size-col">15. PDF Embutido/Final</td>
          ${PARAMETER_SETS.map(p => `<td class="size-col">${fb(res[p.id].sizes.finalPdf)} KB<br><span class="desc">vs JSON Assinado: ${((res[p.id].sizes.finalPdf / res[p.id].sizes.signedJson)*100).toFixed(0)}%</span></td>`).join('')}
        </tr>
        <tr>
          <td class="col-header size-col">-  PDF Cifrado</td>
          ${PARAMETER_SETS.map(p => `<td class="size-col">${fb(res[p.id].sizes.encPdf)} KB<br><span class="desc">vs Final PDF: ${((res[p.id].sizes.encPdf / res[p.id].sizes.finalPdf)*100).toFixed(1)}%</span></td>`).join('')}
        </tr>
      </tbody>
    </table>
  </div>
</body>
</html>`;
  
  const reportPath = path.join(__dirname, 'metrics-report.html');
  fs.writeFileSync(reportPath, html, 'utf8');
  console.log(`✅ Relatório gerado em: ${reportPath}`);
}
